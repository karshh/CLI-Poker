import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer, type PokerServerInstance } from '../src/gui/server.js';
import type { SerializedGameState } from '../src/gui/engine.js';

const REQUIRE_PLAYWRIGHT = process.env['REQUIRE_PLAYWRIGHT'] === '1';

function hasChromiumBinary(): boolean {
  try {
    const execPath = chromium.executablePath();
    return Boolean(execPath && fs.existsSync(execPath));
  } catch {
    return false;
  }
}

async function apiGetState(baseUrl: string): Promise<SerializedGameState> {
  const res = await fetch(`${baseUrl}/api/state`);
  assert.equal(res.status, 200);
  return (await res.json()) as SerializedGameState;
}

async function apiAct(baseUrl: string, action: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ action }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function sendRawHttpRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  chunks?: string[];
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.chunks) {
      for (const chunk of options.chunks) {
        req.write(chunk);
      }
    }
    req.end();
  });
}

// ============================================================================
// PART 1: LIVE HTTP SERVER SECURITY, PACKAGING, PORT RETRY & API E2E TESTS
// ============================================================================

test('e2e (HTTP): loopback bind, same-origin enforcement, built dist assets, port exhaustion failure, and full game API', async () => {
  // 1. Verify built static assets exist under dist/src/gui/public and work standalone
  const distPublicDir = path.resolve(process.cwd(), 'dist', 'src', 'gui', 'public');
  assert.ok(fs.existsSync(path.join(distPublicDir, 'index.html')), 'dist/src/gui/public/index.html missing');
  assert.ok(fs.existsSync(path.join(distPublicDir, 'game.js')), 'dist/src/gui/public/game.js missing');
  assert.ok(fs.existsSync(path.join(distPublicDir, 'style.css')), 'dist/src/gui/public/style.css missing');

  const instance = await startServer(0, distPublicDir);
  assert.equal(instance.host, '127.0.0.1');
  assert.ok(instance.port > 0, 'startServer(0) must report actual OS-assigned port');
  const baseUrl = `http://127.0.0.1:${instance.port}`;

  try {
    // 2. Verify only bundled static assets serve directly from built dist directory, with CSP frame-ancestors 'none'
    for (const assetPath of ['/', '/index.html', '/game.js', '/style.css']) {
      const res = await fetch(`${baseUrl}${assetPath}`);
      assert.equal(res.status, 200, `Expected 200 for ${assetPath}`);
      if (assetPath === '/' || assetPath === '/index.html') {
        assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'");
      }
    }
    assert.equal((await fetch(`${baseUrl}/not-a-bundled-asset.txt`)).status, 404);

    // 3. Security hardening: Host validation (DNS rebinding), exact Origin + JSON Content-Type, malformed URLs, & 413 body cap
    const stateRes = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    assert.equal(stateRes.headers.get('access-control-allow-origin'), null);

    // DNS rebinding / invalid Host blocked on BOTH HTML and API
    const evilHostHtml = await sendRawHttpRequest({
      port: instance.port,
      method: 'GET',
      path: '/',
      headers: { Host: `attacker.example:${instance.port}` },
    });
    assert.equal(evilHostHtml.statusCode, 403);

    const wrongPortHostApi = await sendRawHttpRequest({
      port: instance.port,
      method: 'GET',
      path: '/api/state',
      headers: { Host: '127.0.0.1:9999' },
    });
    assert.equal(wrongPortHostApi.statusCode, 403);

    // Malformed request target returns 400 without crashing the server
    const malformedTarget = await sendRawHttpRequest({
      port: instance.port,
      method: 'GET',
      path: '//evil.example/path',
      headers: { Host: `127.0.0.1:${instance.port}` },
    });
    assert.equal(malformedTarget.statusCode, 400);

    // Cross-origin & missing-Origin & wrong-Content-Type enforcement
    const evilOriginGet = await fetch(`${baseUrl}/api/state`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(evilOriginGet.status, 403);

    const missingOriginPost = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'random_opponents' }),
    });
    assert.equal(missingOriginPost.status, 403);

    const evilOriginPost = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ action: 'random_opponents' }),
    });
    assert.equal(evilOriginPost.status, 403);

    const wrongContentTypePost = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: baseUrl },
      body: JSON.stringify({ action: 'random_opponents' }),
    });
    assert.equal(wrongContentTypePost.status, 415);

    const crossSiteSecFetch = await fetch(`${baseUrl}/api/state`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(crossSiteSecFetch.status, 403);

    // Oversized POST body rejected with 413 (both with Content-Length and chunked with no Content-Length)
    const oversizedPayload = JSON.stringify({ action: 'x'.repeat(2048) });
    const oversizedWithLen = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: oversizedPayload,
    });
    assert.equal(oversizedWithLen.status, 413);

    const oversizedChunked = await sendRawHttpRequest({
      port: instance.port,
      method: 'POST',
      path: '/api/action',
      headers: {
        Host: `127.0.0.1:${instance.port}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
      chunks: ['{"action":"', 'a'.repeat(600), 'b'.repeat(600), '"}'],
    });
    assert.equal(oversizedChunked.statusCode, 413);

    // Same-origin loopback Origin header IS allowed and server is still healthy after malformed/oversized requests
    const sameOriginGet = await fetch(`${baseUrl}/api/state`, {
      headers: { Origin: baseUrl },
    });
    assert.equal(sameOriginGet.status, 200);

    // 4. Opponent selection validation edge cases
    const initial = await apiGetState(baseUrl);
    assert.equal(initial.stage, 'select_opponents');
    assert.equal(initial.availableOpponents.length, 8);

    assert.equal((await apiAct(baseUrl, 'select_opponents:reginald,elon')).status, 400);
    assert.equal((await apiAct(baseUrl, 'select_opponents:elon,elon,tony,tariq')).status, 400);
    assert.equal((await apiAct(baseUrl, 'select_opponents:elon,tony,tariq,ghost')).status, 400);

    const missingBodyRes = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({}),
    });
    assert.equal(missingBodyRes.status, 400);

    // 5. Select 4 opponents & start game
    const selectRes = await apiAct(baseUrl, 'select_opponents:reginald,elon,tony,tariq');
    assert.equal(selectRes.status, 200);
    assert.equal((selectRes.body as unknown as SerializedGameState).stage, 'select_mode');

    assert.equal((await apiAct(baseUrl, 'impossible')).status, 400);

    const startRes = await apiAct(baseUrl, 'medium');
    assert.equal(startRes.status, 200);
    const startState = startRes.body as unknown as SerializedGameState;
    assert.ok(startState.stage === 'player_action' || startState.stage === 'player_response');
    assert.equal(startState.playerPosition, 'BTN');
    assert.deepEqual(
      startState.opponents.map((o) => o.position),
      ['SB', 'BB', 'UTG', 'CO'],
    );
    for (const opp of startState.opponents) {
      if (opp.folded) {
        assert.equal(opp.cardsHidden, false);
        assert.notEqual(opp.cards[0]?.str, '??');
      } else {
        assert.equal(opp.cardsHidden, true);
        assert.equal(opp.cards[0]?.str, '??');
      }
    }

    // Mid-hand roster change is blocked with 400
    assert.equal((await apiAct(baseUrl, 'open_opponent_select')).status, 400);
    assert.equal((await apiAct(baseUrl, 'select_opponents:buck,bruce,viktor,meiling')).status, 400);

    // 6. Fold plays out multiway hand to a winner and reveals all players' cards!
    const foldRes = await apiAct(baseUrl, 'fold');
    assert.equal(foldRes.status, 200);
    const foldState = foldRes.body as unknown as SerializedGameState;
    assert.equal(foldState.stage, 'hand_over');
    assert.equal(foldState.playerFolded, true);
    for (const opp of foldState.opponents) {
      assert.equal(opp.cardsHidden, false);
      assert.notEqual(opp.cards[0]?.str, '??');
    }

    // 7. Hand #2: play through to showdown and verify chip conservation & clean restart
    const nextRes = await apiAct(baseUrl, 'yes');
    let state = nextRes.body as unknown as SerializedGameState;
    assert.equal(state.handCount, 2);

    let guard = 0;
    while (state.stage !== 'hand_over' && guard < 20) {
      guard += 1;
      if (state.stage === 'player_action') {
        const res = await apiAct(baseUrl, 'bet');
        assert.equal(res.status, 200);
        state = res.body as unknown as SerializedGameState;
      } else if (state.stage === 'player_response') {
        const res = await apiAct(baseUrl, 'call');
        assert.equal(res.status, 200);
        state = res.body as unknown as SerializedGameState;
      }
      assert.ok(state.playerChips >= 0);
      for (const opp of state.opponents) {
        assert.ok(opp.chips >= 0);
      }
      if (state.stage === 'player_action' || state.stage === 'player_response') {
        for (const opp of state.opponents) {
          if (opp.folded) {
            assert.equal(opp.cardsHidden, false);
            assert.notEqual(opp.cards[0]?.str, '??');
          } else {
            assert.equal(opp.cardsHidden, true);
            assert.equal(opp.cards[0]?.str, '??');
          }
        }
        const sumContrib =
          state.playerHandContribution + state.opponents.reduce((acc, o) => acc + o.handContribution, 0);
        assert.equal(sumContrib, state.pot);
      }
    }

    assert.equal(state.stage, 'hand_over');
    const totalChips = state.playerChips + state.opponents.reduce((acc, o) => acc + o.chips, 0);
    assert.equal(totalChips, 2500);

    // Cash out -> restart clears pot, board, opponent totals, and log completely
    await apiAct(baseUrl, 'no');
    const restartRes = await apiAct(baseUrl, 'restart');
    const restartState = restartRes.body as unknown as SerializedGameState;
    assert.equal(restartState.stage, 'select_opponents');
    assert.equal(restartState.pot, 0);
    assert.equal(restartState.board.length, 0);
    assert.equal(restartState.playerChips, 500);
    assert.equal(restartState.playerTotalPotWon, 0);
    assert.equal(restartState.narrative.length, 1);
    for (const opp of restartState.opponents) {
      assert.equal(opp.chips, 500);
      assert.equal(opp.totalPotWon, 0);
      assert.equal(opp.cards.length, 0);
    }
  } finally {
    await instance.close();
  }
});

test('e2e (HTTP): startServer rejects cleanly when all 10 candidate ports are occupied', async () => {
  const blockers: http.Server[] = [];
  // Pick a high ephemeral base port range and reserve 10 consecutive ports on 127.0.0.1
  let basePort = 43100;
  try {
    for (let offset = 0; offset < 10; offset += 1) {
      const s = http.createServer();
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.listen(basePort + offset, '127.0.0.1', () => resolve());
      });
      blockers.push(s);
    }

    await assert.rejects(() => startServer(basePort), /Failed to bind poker GUI server/);
  } finally {
    await Promise.all(
      blockers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve());
          }),
      ),
    );
  }
});

test('e2e (HTTP): static asset handler rejects symlinked files pointing outside publicDir', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-poker-symlink-test-'));
  const fakePublic = path.join(tempRoot, 'public');
  const outsideSecret = path.join(tempRoot, 'secret.txt');
  fs.mkdirSync(fakePublic);
  fs.writeFileSync(outsideSecret, 'TOP_SECRET_DATA', 'utf8');
  fs.symlinkSync(outsideSecret, path.join(fakePublic, 'index.html'));
  fs.writeFileSync(path.join(fakePublic, 'style.css'), 'body{}', 'utf8');

  const instance = await startServer(0, fakePublic);
  const baseUrl = `http://127.0.0.1:${instance.port}`;
  try {
    const symlinkRes = await fetch(`${baseUrl}/`);
    assert.equal(symlinkRes.status, 404, 'Symlinked asset must be rejected with 404');
    const body = await symlinkRes.text();
    assert.equal(body.includes('TOP_SECRET_DATA'), false);

    const realFileRes = await fetch(`${baseUrl}/style.css`);
    assert.equal(realFileRes.status, 200);
  } finally {
    await instance.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ============================================================================
// PART 2: HEADLESS PLAYWRIGHT CHROMIUM BROWSER E2E TESTS
// ============================================================================

const CHROMIUM_AVAILABLE = hasChromiumBinary();

test(
  'e2e (Playwright headless): full GUI suite covering all 8 VIP opponents, focus trap, double-click lock, seating, privacy, turns, pots window, diamonds, and phone viewport',
  { skip: !CHROMIUM_AVAILABLE && !REQUIRE_PLAYWRIGHT ? 'Playwright Chromium binary not installed in this environment' : false },
  async (t) => {
    assert.ok(
      CHROMIUM_AVAILABLE,
      'Playwright Chromium binary is required for browser E2E tests. Run: npx playwright install chromium',
    );

    const browser: Browser = await chromium.launch({ headless: true });

    async function withGamePage(
      fn: (ctx: { page: Page; baseUrl: string; instance: PokerServerInstance; consoleErrors: string[]; pageErrors: string[] }) => Promise<void>,
      options: { turnSpeed?: number; viewport?: { width: number; height: number } } = {},
    ): Promise<void> {
      const instance = await startServer(0);
      const baseUrl = `http://127.0.0.1:${instance.port}`;
      const context = await browser.newContext({
        viewport: options.viewport ?? { width: 1366, height: 860 },
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => {
        pageErrors.push(err.message);
      });

      if (typeof options.turnSpeed === 'number') {
        await page.addInitScript((speed: number) => {
          (window as unknown as { __POKER_TURN_SPEED__?: number }).__POKER_TURN_SPEED__ = speed;
        }, options.turnSpeed);
      }

      try {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await fn({ page, baseUrl, instance, consoleErrors, pageErrors });
        assert.deepEqual(pageErrors, [], `Unexpected uncaught page errors: ${pageErrors.join('; ')}`);
        assert.deepEqual(consoleErrors, [], `Unexpected console errors: ${consoleErrors.join('; ')}`);
      } finally {
        await context.close();
        await instance.close();
      }
    }

    async function waitForPromptReady(page: Page, expectedSubstring?: string): Promise<string> {
      await page.waitForFunction(
        (substr: string) => {
          const title = document.getElementById('action-prompt-title')?.textContent || '';
          const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
          const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
          if (!ready) return false;
          return substr ? title.includes(substr) : true;
        },
        expectedSubstring ?? '',
        { timeout: 10000 },
      );
      return (await page.locator('#action-prompt-title').textContent()) || '';
    }

    try {
      // ----------------------------------------------------------------------
      // TEST 1: Native <dialog> Focus Trap, Opponent Selection, Cancel Preservation & All 8 VIP SVGs
      // ----------------------------------------------------------------------
      await t.test('native opponent picker traps keyboard focus, validates 4 picks, preserves active hand, and renders all 8 VIP characters', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            assert.equal(await page.locator('.opponent-pick-card').count(), 8);

            // Focus trap check: pressing Tab with native modal dialog open MUST stay inside #opponent-modal-overlay (never hit background Table Pots!)
            for (let i = 0; i < 6; i += 1) {
              await page.keyboard.press('Tab');
              const focusInsideDialog = await page.evaluate(() => {
                const dialog = document.getElementById('opponent-modal-overlay');
                return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
              });
              assert.equal(focusInsideDialog, true, 'Keyboard focus escaped open opponent picker dialog');
            }

            // Confirm disabled at 0/4
            const confirmBtn = page.locator('#btn-confirm-opponents');
            assert.equal(await confirmBtn.isDisabled(), true);

            // Select 3 -> deselect 1 -> select 2 more -> 4/4 enabled
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            assert.equal(await page.locator('#opponent-select-count').textContent(), '3 / 4 Selected');
            assert.equal(await confirmBtn.isDisabled(), true);

            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            assert.equal(await page.locator('#opponent-select-count').textContent(), '2 / 4 Selected');

            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tariq"]').click();
            assert.equal(await page.locator('#opponent-select-count').textContent(), '4 / 4 Selected');
            assert.equal(await confirmBtn.isDisabled(), false);

            // 5th click replaces oldest pick (reginald -> buck)
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            assert.equal(await page.locator('#opponent-select-count').textContent(), '4 / 4 Selected');
            assert.equal(
              await page.locator('.opponent-pick-card[data-opp-id="reginald"]').evaluate((el) => el.classList.contains('selected')),
              false,
            );

            await confirmBtn.click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });

            // After closing dialog, closed picker buttons must NOT be reachable via Tab
            await page.keyboard.press('Tab');
            const focusedClosedDialog = await page.evaluate(() => {
              const dialog = document.getElementById('opponent-modal-overlay');
              return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
            });
            assert.equal(focusedClosedDialog, false, 'Closed opponent picker buttons must not be in tab order');

            // Verify exact 4 seated characters + Elon's upgraded likeness markers
            assert.equal(await page.locator('#seat-far-left').getAttribute('data-opp-id'), 'tony');
            assert.equal(await page.locator('#seat-top-left').getAttribute('data-opp-id'), 'elon');
            assert.equal(await page.locator('#seat-top-right').getAttribute('data-opp-id'), 'tariq');
            assert.equal(await page.locator('#seat-far-right').getAttribute('data-opp-id'), 'buck');
            const elonHtml = await page.locator('#opp-avatar-elon').innerHTML();
            assert.ok(elonHtml.includes('MARS') && elonHtml.includes('𝕏'));

            // Start hand on Easy -> Select Opponents button MUST be disabled during active hand to preserve pot
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');
            assert.equal(await page.locator('#pick-opponents-btn').isDisabled(), true);

            // Fold to finish hand -> Select Opponents becomes enabled between hands, with working Cancel button
            await page.locator('#action-buttons-group button', { hasText: 'Fold' }).click();
            await waitForPromptReady(page, 'Play another hand?');
            assert.equal(await page.locator('#pick-opponents-btn').isDisabled(), false);

            await page.locator('#pick-opponents-btn').click();
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            await page.locator('#btn-cancel-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            // Prompt still intact after cancel
            assert.ok(((await page.locator('#action-prompt-title').textContent()) || '').includes('Play another hand?'));

            // Re-open picker and seat the other 4 characters (reginald, bruce, viktor, meiling)
            await page.locator('#pick-opponents-btn').click();
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="bruce"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="viktor"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="meiling"]').click();
            await confirmBtn.click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await waitForPromptReady(page, 'Pre-flop');

            for (const id of ['reginald', 'bruce', 'viktor', 'meiling']) {
              const avatarBox = await page.locator(`#opp-avatar-${id}`).boundingBox();
              assert.ok(avatarBox && avatarBox.width > 50 && avatarBox.height > 50, `Avatar ${id} missing box`);
            }
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 2: Seating Layers, Game Viewport Below Nav, Overhead Name+Stack Cards & Bubble Placement
      // ----------------------------------------------------------------------
      await t.test('game viewport sits below top nav, seats stay behind table rail, name+stack cards sit above seats, and speech bubbles sit between card and seat without nav clipping', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Medium' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            const layout = await page.evaluate(() => {
              const z = (sel: string): number => {
                const el = document.querySelector(sel);
                return el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : -999;
              };
              const navRect = document.querySelector('.top-nav')!.getBoundingClientRect();
              const vpRect = document.querySelector('.pov-viewport')!.getBoundingClientRect();
              const tableRect = document.querySelector('.poker-table-surface')!.getBoundingClientRect();
              const dealerPlate = document.querySelector('.dealer-nameplate')!.getBoundingClientRect();
              const dealerBubble = document.getElementById('dealer-speech-bubble')!.getBoundingClientRect();
              const dealerAvatar = document.getElementById('dealer-avatar')!.getBoundingClientRect();
              const oppChecks = Array.from(document.querySelectorAll('.character-container[data-opp-id]')).map((seat) => {
                const id = seat.getAttribute('data-opp-id') || '';
                const plate = seat.querySelector('.character-nameplate')!.getBoundingClientRect();
                const avatar = seat.querySelector('.opponent-avatar')!.getBoundingClientRect();
                const bubbleEl = seat.querySelector('.opponent-bubble')!;
                const bubbleActive = bubbleEl.classList.contains('active');
                const bubble = bubbleEl.getBoundingClientRect();
                return {
                  id,
                  plateTop: plate.top,
                  plateBottom: plate.bottom,
                  avatarTop: avatar.top,
                  bubbleActive,
                  bubbleTop: bubble.top,
                  bubbleBottom: bubble.bottom,
                };
              });
              return {
                navBottom: navRect.bottom,
                vpTop: vpRect.top,
                tableTop: tableRect.top,
                dealerPlateTop: dealerPlate.top,
                dealerPlateBottom: dealerPlate.bottom,
                dealerBubbleTop: dealerBubble.top,
                dealerBubbleBottom: dealerBubble.bottom,
                dealerAvatarTop: dealerAvatar.top,
                oppChecks,
                table: z('.poker-table-surface'),
                dealer: z('.dealer-slot'),
                farLeft: z('.seat-far-left'),
                topLeft: z('.seat-top-left'),
                topRight: z('.seat-top-right'),
                farRight: z('.seat-far-right'),
                chairCount: document.querySelectorAll('.casino-chair svg').length,
                feltCardContainers: document.querySelectorAll('.table-felt .opp-table-items').length,
              };
            });

            // 1. Game viewport starts strictly below the top nav bar (never behind it!)
            assert.ok(layout.vpTop >= layout.navBottom - 1, `pov-viewport overlaps top-nav: vpTop=${layout.vpTop}, navBottom=${layout.navBottom}`);

            // 2. Chairs & avatars sit layered strictly behind the poker table rail
            assert.ok(layout.table > layout.dealer);
            assert.ok(layout.table > layout.farLeft);
            assert.ok(layout.table > layout.topLeft);
            assert.ok(layout.table > layout.topRight);
            assert.ok(layout.table > layout.farRight);
            assert.equal(layout.chairCount, 5);
            assert.equal(layout.feltCardContainers, 4);

            // 3. Dealer nameplate & active speech bubble sit strictly below nav, with bubble between nameplate and dealer avatar!
            assert.ok(layout.dealerPlateTop >= layout.navBottom - 1, `Dealer nameplate clipped by nav: ${layout.dealerPlateTop} < ${layout.navBottom}`);
            assert.ok(layout.dealerBubbleTop >= layout.dealerPlateBottom - 2, `Dealer bubble must sit below nameplate`);
            assert.ok(layout.dealerBubbleBottom <= layout.dealerAvatarTop + 8, `Dealer bubble must sit above dealer seat`);

            // 4. Every opponent's name+stack card sits above their seat (not hovering over poker board), below nav,
            //    and any active speech bubble sits strictly between the name+stack card and the seat!
            assert.equal(layout.oppChecks.length, 4);
            for (const o of layout.oppChecks) {
              assert.ok(o.plateTop >= layout.navBottom - 1, `Nameplate for ${o.id} clipped by nav: ${o.plateTop} < ${layout.navBottom}`);
              assert.ok(o.plateBottom <= o.avatarTop + 4, `Nameplate for ${o.id} must sit above seat, not over poker board`);
              if (o.bubbleActive) {
                assert.ok(o.bubbleTop >= o.plateBottom - 2, `Bubble for ${o.id} must sit below nameplate`);
                assert.ok(o.bubbleBottom <= o.avatarTop + 8, `Bubble for ${o.id} must sit above seat`);
              }
            }
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 3: Lock Actions Before POST Starts (Double-Click Under 250ms Network Delay)
      // ----------------------------------------------------------------------
      await t.test('action buttons lock synchronously before POST starts preventing double-wager on rapid double-click', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            let actionPostCount = 0;
            await page.route('**/api/action', async (route) => {
              actionPostCount += 1;
              await new Promise((r) => setTimeout(r, 250));
              await route.continue();
            });

            const callBtn = page.locator('#action-buttons-group button[data-choice-id="call"]');
            const postDone = page.waitForResponse((r) => r.url().includes('/api/action'));
            // Fire two rapid clicks + a hotkey press during the 250ms network delay
            await callBtn.click();
            await callBtn.click({ force: true }).catch(() => {});
            await page.keyboard.press('c');
            await postDone;

            // Wait for playback & next prompt to become ready
            await page.waitForFunction(
              () => {
                const title = document.getElementById('action-prompt-title')?.textContent || '';
                const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
                const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
                return ready && !title.includes('Submitting') && !title.includes('making their decisions');
              },
              { timeout: 10000 },
            );

            assert.equal(actionPostCount, 1, `Expected exactly 1 POST for rapid double-click, saw ${actionPostCount}`);
            // Must NEVER have skipped straight to TURN!
            const banner = (await page.locator('#street-banner').textContent())?.trim();
            assert.notEqual(banner, 'TURN', 'Double-click must never skip Flop straight to Turn');
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 4: Real-Time 1–2s Sequential Opponent Thinking, Bubble Updates & Clearing on New Round
      // ----------------------------------------------------------------------
      await t.test('opponents think one-by-one for 1-2s with thinking chat bubbles, update bubbles, and clear bubbles on next round', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();

            // Start sampling before clicking Easy so we observe UTG (elon) -> CO (tony) before BTN (You),
            // followed by SB (reginald) -> BB (buck) after You call!
            await page.evaluate(() => {
              const log: Array<{ ts: number; thinkingIds: string[]; bubbleTexts: Record<string, string> }> = [];
              (window as unknown as { __TURN_LOG__: typeof log }).__TURN_LOG__ = log;
              let lastSig = '';
              const sample = () => {
                const thinkingEls = Array.from(document.querySelectorAll('.character-container.is-thinking'));
                const thinkingIds = thinkingEls.map((el) => el.getAttribute('data-opp-id') || '');
                const bubbleTexts: Record<string, string> = {};
                for (const id of ['reginald', 'buck', 'elon', 'tony']) {
                  const b = document.getElementById(`opp-bubble-${id}`);
                  const t = document.getElementById(`opp-bubble-text-${id}`);
                  if (b?.classList.contains('active') && t?.textContent) {
                    bubbleTexts[id] = t.textContent;
                  }
                }
                const sig = JSON.stringify({ thinkingIds, bubbleTexts });
                if (sig !== lastSig) {
                  lastSig = sig;
                  log.push({ ts: performance.now(), thinkingIds, bubbleTexts });
                }
              };
              const timer = setInterval(sample, 60);
              (window as unknown as { __TURN_TIMER__: ReturnType<typeof setInterval> }).__TURN_TIMER__ = timer;
            });

            const startTs = Date.now();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();

            await page.waitForSelector('.character-container.is-thinking', { timeout: 3000 });
            const disabledCount = await page.locator('#action-buttons-group button:disabled').count();
            assert.ok(disabledCount >= 2, 'Action buttons must be disabled while opponents are thinking');

            // Hotkeys during thinking must be ignored
            await page.keyboard.press('f');
            await page.keyboard.press('c');

            // Wait for UTG & CO to finish and prompt BTN (You)
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();

            // Wait for SB & BB to finish Pre-flop (and advance to Flop or hand_over)
            await page.waitForFunction(
              () => {
                const banner = document.getElementById('street-banner')?.textContent?.trim();
                const title = document.getElementById('action-prompt-title')?.textContent || '';
                const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
                const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
                return ready && (banner === 'FLOP' || title.includes('Play another hand?'));
              },
              { timeout: 25000 },
            );
            const elapsedMs = Date.now() - startTs;

            const turnLog = await page.evaluate(() => {
              clearInterval((window as unknown as { __TURN_TIMER__: ReturnType<typeof setInterval> }).__TURN_TIMER__);
              return (
                window as unknown as {
                  __TURN_LOG__: Array<{ ts: number; thinkingIds: string[]; bubbleTexts: Record<string, string> }>;
                }
              ).__TURN_LOG__;
            });

            assert.ok(elapsedMs >= 4500, `Expected real sequential 1-2s turns (>= 4500ms), got ${elapsedMs}ms`);

            for (const entry of turnLog) {
              assert.ok(entry.thinkingIds.length <= 1, `Multiple opponents thought simultaneously: ${entry.thinkingIds.join(', ')}`);
            }

            const thinkingOrder: string[] = [];
            for (const entry of turnLog) {
              const id = entry.thinkingIds[0];
              if (id && thinkingOrder[thinkingOrder.length - 1] !== id) {
                thinkingOrder.push(id);
              }
            }
            // First two thinkers on Pre-flop must be UTG (elon) then CO (tony), followed by SB (reginald)
            assert.deepEqual(thinkingOrder.slice(0, 3), ['elon', 'tony', 'reginald']);

            for (const id of ['elon', 'tony', 'reginald']) {
              const seenTexts = new Set<string>();
              for (const entry of turnLog) {
                if (entry.bubbleTexts[id]) seenTexts.add(entry.bubbleTexts[id]!);
              }
              assert.ok(seenTexts.size >= 2, `Expected ${id} bubble to update from thinking -> decision`);
            }
          },
          { turnSpeed: 1 }, // REAL 1-2 second timing!
        );
      });

      // ----------------------------------------------------------------------
      // TEST 5: Card Privacy During Play, Reveal on Fold & End-of-Hand, Re-Hide on Next Hand
      // ----------------------------------------------------------------------
      await t.test('active opponents stay hidden during play, folded opponents reveal immediately, player fold reveals all hands at hand end, and next hand re-hides active cards', async () => {
        await withGamePage(
          async ({ page }) => {
            const leakedCards: string[] = [];
            page.on('response', async (res) => {
              if (res.url().includes('/api/state') || res.url().includes('/api/action')) {
                try {
                  const data = (await res.json()) as SerializedGameState;
                  for (const opp of data.opponents || []) {
                    if (opp.cardsHidden) {
                      for (const c of opp.cards || []) {
                        if (c.str !== '??') leakedCards.push(`${opp.id}:${c.str}`);
                      }
                    }
                  }
                } catch {
                  // ignore non-json
                }
              }
            });

            await page.locator('#btn-random-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Hard' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            // During active play: folded opponents reveal face-up, non-folded active opponents stay face-down!
            const checkActiveVsFoldedCards = async () => {
              const states = await page.evaluate(() =>
                Array.from(document.querySelectorAll('.opp-cards-on-table')).map((el) => ({
                  folded: el.classList.contains('folded'),
                  faceDown: el.querySelectorAll('.card-back').length,
                  faceUp: el.querySelectorAll('.card:not(.card-back)').length,
                })),
              );
              for (const s of states) {
                if (s.folded) {
                  assert.equal(s.faceUp, 2, 'Folded opponent cards must be revealed face-up');
                  assert.equal(s.faceDown, 0);
                } else {
                  assert.equal(s.faceDown, 2, 'Active non-folded opponent cards must stay face-down during play');
                  assert.equal(s.faceUp, 0);
                }
              }
            };
            await checkActiveVsFoldedCards();

            // Fold on Hand 1 -> hand finishes with a winner AND reveals all 8 opponent cards!
            await page.locator('#action-buttons-group button', { hasText: 'Fold' }).click();
            await waitForPromptReady(page, 'Play another hand?');
            assert.equal(await page.locator('.opp-cards-on-table .card:not(.card-back)').count(), 8);
            assert.equal(await page.locator('.opp-cards-on-table .card-back').count(), 0);

            // Play Again via Space -> Hand #2: active opponents are re-hidden!
            await page.keyboard.press('Space');
            await page.waitForFunction(() => document.getElementById('stat-hand-count')?.textContent === '2');
            await waitForPromptReady(page, 'Pre-flop');
            await checkActiveVsFoldedCards();

            // Play Hand #2 all the way to Showdown
            for (let step = 0; step < 12; step += 1) {
              const prevTitle = (await page.locator('#action-prompt-title').textContent()) || '';
              if (prevTitle.includes('Play another hand?')) break;

              const callBtn = page.locator('#action-buttons-group button[data-choice-id="call"]');
              const checkBtn = page.locator('#action-buttons-group button[data-choice-id="check"]');
              const targetBtn = (await callBtn.count()) > 0 ? callBtn : checkBtn;
              await targetBtn.waitFor({ state: 'visible', timeout: 5000 });
              const responsePromise = page.waitForResponse((r) => r.url().includes('/api/action'));
              await targetBtn.click();
              await responsePromise;
              await page.waitForFunction(
                () => {
                  const title = document.getElementById('action-prompt-title')?.textContent || '';
                  const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
                  const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
                  return ready && !title.includes('Submitting') && !title.includes('making their decisions');
                },
                { timeout: 8000 },
              );
            }

            const finalPrompt = (await page.locator('#action-prompt-title').textContent()) || '';
            assert.ok(finalPrompt.includes('Play another hand?'), `Expected hand_over, got: ${finalPrompt}`);

            const hudStatus = (await page.locator('#hud-street-status').textContent()) || '';
            assert.ok(hudStatus.startsWith('Result:'), `Expected Result status, got: ${hudStatus}`);

            // At end of hand, all 8 opponent cards (both folded and showdown contenders) are revealed face-up!
            assert.equal(await page.locator('.opp-cards-on-table .card:not(.card-back)').count(), 8);
            assert.equal(await page.locator('.opp-cards-on-table .card-back').count(), 0);

            // Clicking Play Again after Showdown -> Hand #3 (You = UTG, act first) MUST re-hide all 8 opponent cards!
            await page.locator('#action-buttons-group button', { hasText: 'Play Again' }).click();
            await page.waitForFunction(() => document.getElementById('stat-hand-count')?.textContent === '3');
            await waitForPromptReady(page, 'Pre-flop');
            assert.equal(await page.locator('.opp-cards-on-table .card-back').count(), 8);
            assert.equal(await page.locator('.opp-cards-on-table .card:not(.card-back)').count(), 0);
            assert.equal(await page.locator('.opponent-bubble.active').count(), 0); // Hand #3: You are UTG (act first!) -> zero opponent bubbles!

            assert.deepEqual(leakedCards, [], `Hidden opponent cards leaked over API: ${leakedCards.join(', ')}`);
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 6: Hidable Table Pots Window, Vector SVG Diamonds, Hotkeys, Log Drawer & Cash Out -> Restart
      // ----------------------------------------------------------------------
      await t.test('hidable Table Pots window updates live & toggles via button/close/hotkey P, diamonds render as SVG, and Cash Out -> Restart resets cleanly', async () => {
        await withGamePage(
          async ({ page }) => {
            // Select opponents first so the native modal dialog closes before interacting with background controls
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            // Top brand diamond uses crisp vector SVG
            assert.equal(await page.locator('.brand .suit-icon-svg').count(), 1);

            // Hidable Table Pots window starts open with 5 rows
            const potsWin = page.locator('#pots-window');
            assert.equal(await potsWin.evaluate((el) => el.classList.contains('open')), true);
            assert.equal(await page.locator('#pots-window-body .pots-row').count(), 5);

            // Hide via window × button, reopen via top-bar button, toggle via hotkey 'P'
            await page.locator('#pots-window-close').click();
            assert.equal(await potsWin.evaluate((el) => el.classList.contains('open')), false);
            await page.locator('#pots-toggle-btn').click();
            assert.equal(await potsWin.evaluate((el) => el.classList.contains('open')), true);
            await page.keyboard.press('p');
            assert.equal(await potsWin.evaluate((el) => el.classList.contains('open')), false);
            await page.keyboard.press('p');
            assert.equal(await potsWin.evaluate((el) => el.classList.contains('open')), true);

            // Call the Pre-flop Big Blind and verify Table Pots window reflects updated pot >= $15
            const callResp = page.waitForResponse((r) => r.url().includes('/api/action'));
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await callResp;
            await page.waitForFunction(
              () => {
                const title = document.getElementById('action-prompt-title')?.textContent || '';
                const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
                return btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled) && !title.includes('making their decisions');
              },
              { timeout: 8000 },
            );

            const potsText = (await page.locator('#pots-window-total').textContent()) || '';
            const potAmountNum = parseInt(potsText.replace(/[^0-9]/g, ''), 10);
            assert.ok(potAmountNum >= 15, `Expected Table Pots window >= $15, got: ${potsText}`);

            // Deal hands until a diamond card appears and verify crisp SVG diamond (no raw Unicode ♦ inside cards)
            let foundDiamondSvg = false;
            for (let attempt = 0; attempt < 10; attempt += 1) {
              if ((await page.locator('.card .suit-icon-svg.diamond-svg').count()) > 0) {
                foundDiamondSvg = true;
                const rawDiamondChars = await page.evaluate(() =>
                  Array.from(document.querySelectorAll('.card .card-suit, .card .card-center-suit')).filter((el) =>
                    el.textContent?.includes('♦'),
                  ).length,
                );
                assert.equal(rawDiamondChars, 0);
                break;
              }
              const foldBtn = page.locator('#action-buttons-group button', { hasText: 'Fold' });
              if ((await foldBtn.count()) > 0) {
                await foldBtn.click();
                await waitForPromptReady(page, 'Play another hand?');
                if ((await page.locator('.card .suit-icon-svg.diamond-svg').count()) > 0) {
                  foundDiamondSvg = true;
                  break;
                }
              }
              await page.locator('#action-buttons-group button', { hasText: 'Play Again' }).click();
              await waitForPromptReady(page, 'Pre-flop');
            }
            assert.equal(foundDiamondSvg, true, 'Expected at least one diamond card rendered as vector SVG');

            // Sound mute toggle via button and 'M' hotkey
            assert.equal((await page.locator('#sound-icon').textContent())?.trim(), '🔊');
            await page.locator('#sound-toggle').click();
            assert.equal((await page.locator('#sound-icon').textContent())?.trim(), '🔇');
            await page.keyboard.press('m');
            assert.equal((await page.locator('#sound-icon').textContent())?.trim(), '🔊');

            // Log drawer opens & closes cleanly
            await page.locator('#log-toggle-btn').click();
            assert.equal(await page.locator('#history-drawer').evaluate((el) => el.classList.contains('open')), true);
            await page.locator('#drawer-close').click();
            assert.equal(await page.locator('#history-drawer').evaluate((el) => el.classList.contains('open')), false);

            // Cash Out -> Start New Session -> modal reopens AND pot/table/log reset cleanly to $0
            const foldBtn = page.locator('#action-buttons-group button', { hasText: 'Fold' });
            if ((await foldBtn.count()) > 0) {
              await foldBtn.click();
              await waitForPromptReady(page, 'Play another hand?');
            }
            await page.locator('#action-buttons-group button', { hasText: 'Cash Out' }).click();
            await waitForPromptReady(page, 'Session complete');
            await page.locator('#action-buttons-group button', { hasText: 'Start New Session' }).click();
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            assert.equal((await page.locator('#pot-amount').textContent())?.trim(), '$0');
            assert.equal((await page.locator('#pots-window-total').textContent())?.trim(), 'Pot: $0');
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 7: Phone-Width Viewport (390 × 844) Layout & Zero Offscreen Clipping
      // ----------------------------------------------------------------------
      await t.test('phone viewport (390x844) fits entire table, all 4 opponents, header Sound button, and Fold button onscreen', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            // Hide Table Pots window so we inspect unobstructed table + controls
            await page.locator('#pots-window-close').click();

            const bounds = await page.evaluate(() => {
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const rectOf = (sel: string) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
              };
              const actionBtns = Array.from(document.querySelectorAll('#action-buttons-group button')).map((b) => {
                const r = b.getBoundingClientRect();
                return { text: b.textContent?.trim() || '', left: r.left, right: r.right, bottom: r.bottom };
              });
              return {
                vw,
                vh,
                sound: rectOf('#sound-toggle'),
                table: rectOf('.poker-table-surface'),
                farLeftSeat: rectOf('.seat-far-left'),
                farRightSeat: rectOf('.seat-far-right'),
                actionBtns,
              };
            });

            assert.equal(bounds.vw, 390);
            assert.ok(bounds.sound && bounds.sound.left >= 0 && bounds.sound.right <= bounds.vw + 1, `Sound button offscreen: ${JSON.stringify(bounds.sound)}`);
            assert.ok(bounds.table && bounds.table.left >= -2 && bounds.table.right <= bounds.vw + 2, `Table wider than phone viewport: ${JSON.stringify(bounds.table)}`);
            assert.ok(bounds.farLeftSeat && bounds.farLeftSeat.left >= -4, `Far-left opponent offscreen: ${JSON.stringify(bounds.farLeftSeat)}`);
            assert.ok(bounds.farRightSeat && bounds.farRightSeat.right <= bounds.vw + 4, `Far-right opponent offscreen: ${JSON.stringify(bounds.farRightSeat)}`);
            assert.ok(bounds.actionBtns.length >= 2);
            for (const btn of bounds.actionBtns) {
              assert.ok(btn.left >= 0 && btn.right <= bounds.vw + 1 && btn.bottom <= bounds.vh + 1, `Action button clipped on phone: ${JSON.stringify(btn)}`);
            }
          },
          { turnSpeed: 0.02, viewport: { width: 390, height: 844 } },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 8: Short Landscape Viewport (844 × 390) Fits Dealer, Table & Player Cards Without Clipping
      // ----------------------------------------------------------------------
      await t.test('short landscape viewport (844x390) fits dealer avatar, table, player cards, and controls without clipping', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#pots-window-close').click();

            const bounds = await page.evaluate(() => {
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const vp = document.querySelector('.pov-viewport')!.getBoundingClientRect();
              const rectOf = (sel: string) => {
                const el = document.querySelector(sel);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
              };
              const playerCards = Array.from(document.querySelectorAll('#player-cards-container .card')).map((c) => {
                const r = c.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
              });
              const actionBtns = Array.from(document.querySelectorAll('#action-buttons-group button')).map((b) => {
                const r = b.getBoundingClientRect();
                return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
              });
              return {
                vw,
                vh,
                vp: { top: vp.top, bottom: vp.bottom, left: vp.left, right: vp.right, height: vp.height },
                dealerAvatar: rectOf('.dealer-slot .avatar'),
                table: rectOf('.poker-table-surface'),
                playerCards,
                actionBtns,
              };
            });

            assert.equal(bounds.vw, 844);
            assert.equal(bounds.vh, 390);
            assert.ok(
              bounds.dealerAvatar && bounds.dealerAvatar.top >= bounds.vp.top - 2,
              `Dealer avatar clipped at top on 844x390: dealer=${JSON.stringify(bounds.dealerAvatar)}, vp=${JSON.stringify(bounds.vp)}`,
            );
            assert.ok(
              bounds.table && bounds.table.left >= 0 && bounds.table.right <= bounds.vw + 2,
              `Table clipped horizontally on 844x390: ${JSON.stringify(bounds.table)}`,
            );
            assert.equal(bounds.playerCards.length, 2);
            for (const card of bounds.playerCards) {
              assert.ok(
                card.top >= bounds.vp.top - 1 && card.bottom <= bounds.vp.bottom + 2,
                `Player card clipped on 844x390: card=${JSON.stringify(card)}, vp=${JSON.stringify(bounds.vp)}`,
              );
            }
            for (const btn of bounds.actionBtns) {
              assert.ok(btn.bottom <= bounds.vh + 1 && btn.right <= bounds.vw + 1, `Action button clipped on 844x390: ${JSON.stringify(btn)}`);
            }
          },
          { turnSpeed: 0.02, viewport: { width: 844, height: 390 } },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 9: Multi-Tab Stale Prompt Rejection (409 Conflict + Auto-Refresh)
      // ----------------------------------------------------------------------
      await t.test('two open tabs reject stale betting submission with 409 and refresh without applying a second wager', async () => {
        const instance = await startServer(0);
        const baseUrl = `http://127.0.0.1:${instance.port}`;
        const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();
        await pageA.addInitScript(() => {
          (window as unknown as { __POKER_TURN_SPEED__: number }).__POKER_TURN_SPEED__ = 0.02;
        });
        await pageB.addInitScript(() => {
          (window as unknown as { __POKER_TURN_SPEED__: number }).__POKER_TURN_SPEED__ = 0.02;
        });

        try {
          await pageA.goto(baseUrl, { waitUntil: 'networkidle' });
          await pageA.locator('#btn-random-opponents').click();
          await pageA.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
          await pageA.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
          await waitForPromptReady(pageA, 'Pre-flop');

          // Open Tab B while Tab A is showing Pre-flop prompt — both tabs now display the same prompt
          await pageB.goto(baseUrl, { waitUntil: 'networkidle' });
          await waitForPromptReady(pageB, 'Pre-flop');

          // Click Call in Tab A and wait for the action response & Tab A to reach its next ready prompt
          const tabAResp = pageA.waitForResponse((r) => r.url().includes('/api/action'));
          await pageA.locator('#action-buttons-group button[data-choice-id="call"]').click();
          await tabAResp;
          await pageA.waitForFunction(
            () => {
              const title = document.getElementById('action-prompt-title')?.textContent || '';
              const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
              const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
              return ready && !title.includes('Submitting') && !title.includes('making their decisions');
            },
            { timeout: 10000 },
          );

          const stateAfterTabA = await apiGetState(baseUrl);
          const revAfterTabA = stateAfterTabA.stateRevision;
          const contribAfterTabA = stateAfterTabA.playerHandContribution;

          // Now click the still-visible stale Call button in Tab B!
          const staleRespPromise = pageB.waitForResponse((r) => r.url().includes('/api/action'));
          await pageB.locator('#action-buttons-group button[data-choice-id="call"]').click();
          const staleResp = await staleRespPromise;
          assert.equal(staleResp.status(), 409, 'Stale tab submission must return HTTP 409 Conflict');

          // Server state MUST NOT have changed (no second wager applied!)
          const stateAfterTabB = await apiGetState(baseUrl);
          assert.equal(stateAfterTabB.stateRevision, revAfterTabA);
          assert.equal(stateAfterTabB.playerHandContribution, contribAfterTabA);
          assert.equal(stateAfterTabB.streetIndex, stateAfterTabA.streetIndex);

          // Tab B must have refreshed to match Tab A's latest street!
          const bannerB = (await pageB.locator('#street-banner').textContent())?.trim();
          assert.equal(bannerB, stateAfterTabA.streetName.toUpperCase());
        } finally {
          await ctxA.close();
          await ctxB.close();
          await instance.close();
        }
      });

      // ----------------------------------------------------------------------
      // TEST 10: Keyboard Shortcuts — 'R' Inside Picker Dialog & Native Space on Focused Cash Out
      // ----------------------------------------------------------------------
      await t.test('R shortcut triggers Random 4 inside open picker dialog and Space on focused Cash Out triggers Cash Out (not Play Again)', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            // Press 'r' while picker dialog is open -> triggers Random 4 Opponents and closes dialog!
            await page.keyboard.press('r');
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await waitForPromptReady(page, 'Choose table difficulty');

            // Start hand and fold so we reach Play Again / Cash Out prompt
            await page.keyboard.press('1');
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="fold"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            // Focus Cash Out / Quit button and press Space -> MUST trigger Cash Out (Session complete.), NOT Play Again!
            const cashOutBtn = page.locator('#action-buttons-group button[data-choice-id="no"]');
            await cashOutBtn.focus();
            await page.keyboard.press('Space');
            await waitForPromptReady(page, 'Session complete');
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 11: Server Restart on Same Port Rejects Old Tab With Same Revision (409 + Refresh)
      // ----------------------------------------------------------------------
      await t.test('old browser tab gets 409 and refreshes when server restarts on same port at identical revision', async () => {
        const instance1 = await startServer(0);
        const port = instance1.port;
        const baseUrl = `http://127.0.0.1:${port}`;
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const oldTab = await ctx.newPage();
        await oldTab.addInitScript(() => {
          (window as unknown as { __POKER_TURN_SPEED__: number }).__POKER_TURN_SPEED__ = 0.02;
        });

        let instance2: PokerServerInstance | null = null;
        try {
          // Server #1: seat roster A (reginald, buck, elon, tony) and reach Pre-flop at stateRevision === 3
          await oldTab.goto(baseUrl, { waitUntil: 'networkidle' });
          for (const id of ['reginald', 'buck', 'elon', 'tony']) {
            await oldTab.locator(`.opponent-pick-card[data-opp-id="${id}"]`).click();
          }
          await oldTab.locator('#btn-confirm-opponents').click();
          await oldTab.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
          await waitForPromptReady(oldTab, 'Pre-flop');
          const state1 = await apiGetState(baseUrl);
          assert.equal(state1.stateRevision, 3);

          // Shut down Server #1 and restart Server #2 on the EXACT SAME PORT!
          await instance1.close();
          instance2 = await startServer(port);
          assert.equal(instance2.port, port);

          // Advance Server #2 to the EXACT SAME stateRevision === 3 with a DIFFERENT roster (bruce, viktor, meiling, tariq)
          await apiAct(baseUrl, 'select_opponents:bruce,viktor,meiling,tariq');
          await apiAct(baseUrl, 'easy');
          const state2Before = await apiGetState(baseUrl);
          assert.equal(state2Before.stateRevision, 3, 'Server #2 should be at identical numeric revision 3');
          assert.notEqual(state2Before.tableInstanceId, state1.tableInstanceId);

          // Clicking the still-visible Call button in the old tab MUST be rejected with 409 (instance mismatch!)
          const staleRespPromise = oldTab.waitForResponse((r) => r.url().includes('/api/action'));
          await oldTab.locator('#action-buttons-group button[data-choice-id="call"]').click();
          const staleResp = await staleRespPromise;
          assert.equal(staleResp.status(), 409, 'Old tab from previous server instance must receive HTTP 409');

          // Server #2 hand must NOT have advanced (still Pre-flop, same pot & revision === 3)
          const state2After = await apiGetState(baseUrl);
          assert.equal(state2After.stateRevision, 3);
          assert.equal(state2After.streetIndex, 0);
          assert.equal(state2After.pot, state2Before.pot);

          // Old tab must have refreshed to Server #2's new roster!
          const seatedIds = await oldTab.evaluate(() =>
            Array.from(document.querySelectorAll('.character-container[data-opp-id]')).map((el) =>
              el.getAttribute('data-opp-id'),
            ),
          );
          assert.deepEqual(seatedIds, ['bruce', 'viktor', 'meiling', 'tariq']);
        } finally {
          await ctx.close();
          if (instance2) {
            await instance2.close();
          } else {
            try {
              await instance1.close();
            } catch {
              // already closed
            }
          }
        }
      });

      // ----------------------------------------------------------------------
      // TEST 12: Rotating Table Positions (BTN, SB, BB, UTG, CO) & Moving Dealer Button (D)
      // ----------------------------------------------------------------------
      await t.test('table positions (BTN, SB, BB, UTG, CO) and Dealer Button puck rotate clockwise across every new hand', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();

            const expectedPlayerPos = ['BTN', 'CO', 'UTG', 'BB', 'SB', 'BTN'];
            const expectedBtnClasses = [
              'btn-at-player',
              'btn-at-far-left',
              'btn-at-top-left',
              'btn-at-top-right',
              'btn-at-far-right',
              'btn-at-player',
            ];

            for (let handIdx = 0; handIdx < 6; handIdx += 1) {
              // Wait until either Pre-flop prompt or hand_over (if everyone folded to BB)
              await page.waitForFunction(
                () => {
                  const title = document.getElementById('action-prompt-title')?.textContent || '';
                  const btns = Array.from(document.querySelectorAll('#action-buttons-group button'));
                  const ready = btns.length > 0 && btns.every((b) => !(b as HTMLButtonElement).disabled);
                  return ready && (title.includes('Pre-flop') || title.includes('Play another hand?'));
                },
                { timeout: 10000 },
              );

              const uiPositions = await page.evaluate(() => {
                const statPos = document.getElementById('stat-position')?.textContent?.trim() || '';
                const playerBadge = document.getElementById('player-position-badge')?.textContent?.trim() || '';
                const btnClasses = Array.from(document.getElementById('dealer-button')?.classList || []);
                const oppBadges = ['reginald', 'buck', 'elon', 'tony'].map(
                  (id) => document.getElementById(`opp-pos-${id}`)?.textContent?.trim() || '',
                );
                const potsBadges = Array.from(document.querySelectorAll('#pots-window-body .pos-badge')).map(
                  (el) => el.textContent?.trim() || '',
                );
                return { statPos, playerBadge, btnClasses, oppBadges, potsBadges };
              });

              assert.equal(uiPositions.statPos, expectedPlayerPos[handIdx]);
              assert.ok(uiPositions.playerBadge.startsWith(expectedPlayerPos[handIdx]!));
              assert.ok(
                uiPositions.btnClasses.includes(expectedBtnClasses[handIdx]!),
                `Hand ${handIdx + 1}: expected dealer button ${expectedBtnClasses[handIdx]}, got ${uiPositions.btnClasses.join(' ')}`,
              );
              const allFive = [uiPositions.statPos, ...uiPositions.oppBadges].sort();
              assert.deepEqual(allFive, ['BB', 'BTN', 'CO', 'SB', 'UTG']);
              assert.deepEqual([...uiPositions.potsBadges].sort(), ['BB', 'BTN', 'CO', 'SB', 'UTG']);

              if (handIdx < 5) {
                const foldBtn = page.locator('#action-buttons-group button[data-choice-id="fold"]');
                if ((await foldBtn.count()) > 0) {
                  await foldBtn.click();
                  await waitForPromptReady(page, 'Play another hand?');
                }
                await page.locator('#action-buttons-group button[data-choice-id="yes"]').click();
                await page.waitForFunction(
                  (expectedHand: string) => document.getElementById('stat-hand-count')?.textContent === expectedHand,
                  String(handIdx + 2),
                );
              }
            }
          },
          { turnSpeed: 0.02 },
        );
      });
    } finally {
      await browser.close();
    }
  },
);
