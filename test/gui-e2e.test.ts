import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { Card } from '../src/card.js';
import { startServer, type PokerServerInstance } from '../src/gui/server.js';
import type { PokerGameEngineOptions, SerializedGameState } from '../src/gui/engine.js';

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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'high-roller-holdem-symlink-test-'));
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
      options: {
        turnSpeed?: number;
        viewport?: { width: number; height: number };
        engineOptions?: PokerGameEngineOptions;
      } = {},
    ): Promise<void> {
      const instance = await startServer(0, undefined, options.engineOptions);
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
            // First four thinkers across Pre-flop must be UTG (elon) -> CO (tony) -> SB (reginald) -> BB (buck)
            assert.deepEqual(thinkingOrder.slice(0, 4), ['elon', 'tony', 'reginald', 'buck']);

            for (const id of ['elon', 'tony', 'reginald', 'buck']) {
              const seenTexts = new Set<string>();
              for (const entry of turnLog) {
                if (entry.bubbleTexts[id]) seenTexts.add(entry.bubbleTexts[id]!);
              }
              assert.ok(seenTexts.size >= 2, `Expected ${id} bubble to update from thinking -> decision`);
            }
          },
          { turnSpeed: 1, engineOptions: { random: () => 0.5 } }, // REAL 1-2s timing, deterministic call/check branch!
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

            // Cash Out -> Session Summary Panel appears with Hands Played, Final Stack, Rebuys, and Net Gain/Loss,
            // then Start New Session hides the panel, reopens the modal, and resets pot/table/log cleanly to $0
            assert.equal(await page.locator('#session-summary-panel').isHidden(), true);
            const foldBtn = page.locator('#action-buttons-group button', { hasText: 'Fold' });
            if ((await foldBtn.count()) > 0) {
              await foldBtn.click();
              await waitForPromptReady(page, 'Play another hand?');
            }
            assert.equal(await page.locator('#session-summary-panel').isHidden(), true);
            await page.locator('#action-buttons-group button', { hasText: 'Cash Out' }).click();
            await waitForPromptReady(page, 'Session complete');
            assert.equal(await page.locator('#session-summary-panel').isVisible(), true);
            const summaryHandsText = (await page.locator('#summary-hands-played').textContent())?.trim() || '';
            const summaryStackText = (await page.locator('#summary-final-stack').textContent())?.trim() || '';
            const summaryRebuysText = (await page.locator('#summary-rebuys').textContent())?.trim() || '';
            const summaryNetText = (await page.locator('#summary-net-profit').textContent())?.trim() || '';
            assert.ok(Number(summaryHandsText) >= 1, `Expected handsPlayed >= 1, got ${summaryHandsText}`);
            assert.match(summaryStackText, /^\$\d+$/);
            assert.equal(summaryRebuysText, '0 ($0)');
            assert.match(summaryNetText, /^(\+\$\d+|-\$\d+|\$0)$/);

            await page.locator('#action-buttons-group button', { hasText: 'Start New Session' }).click();
            await page.waitForSelector('dialog#opponent-modal-overlay[open]');
            assert.equal(await page.locator('#session-summary-panel').isHidden(), true);
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
      // TEST 8b: Wall Sign & Ceiling Decor Clear Overhead Seat Labels/Bubbles on Short Landscape & Stay Visible on Desktop
      // ----------------------------------------------------------------------
      await t.test('wall sign hides cleanly on short landscape viewports (844x390, 932x430) with zero overhead overlap and stays visible above table on desktop (1280x800)', async () => {
        for (const vp of [
          { width: 844, height: 390 },
          { width: 932, height: 430 },
        ]) {
          await withGamePage(
            async ({ page }) => {
              await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
              await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
              await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
              await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
              await page.locator('#btn-confirm-opponents').click();
              await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
              await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
              await waitForPromptReady(page, 'Pre-flop');
              await page.locator('#pots-window-close').click();

              const check = await page.evaluate(() => {
                type Box = { display: string; top: number; bottom: number; left: number; right: number; width: number; height: number };
                const boxOf = (el: Element | null): Box | null => {
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return {
                    display: getComputedStyle(el).display,
                    top: r.top,
                    bottom: r.bottom,
                    left: r.left,
                    right: r.right,
                    width: r.width,
                    height: r.height,
                  };
                };
                const overlaps = (a: Box | null, b: Box | null): boolean => {
                  if (!a || !b) return false;
                  if (a.display === 'none' || b.display === 'none') return false;
                  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
                  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                };

                const painting = boxOf(document.querySelector('.casino-painting'));
                const chandelier = boxOf(document.querySelector('.chandelier'));
                const sconces = Array.from(document.querySelectorAll('.sconce')).map((el) => boxOf(el));
                const targets: Array<{ name: string; box: Box | null }> = [
                  { name: 'dealer-nameplate', box: boxOf(document.querySelector('#dealer-container .character-nameplate')) },
                  { name: 'dealer-speech-bubble', box: boxOf(document.getElementById('dealer-speech-bubble')) },
                ];
                for (const seat of Array.from(document.querySelectorAll('.character-container[data-opp-id]'))) {
                  const id = seat.getAttribute('data-opp-id') || 'unknown';
                  targets.push({ name: `${id}:overhead-stack`, box: boxOf(seat.querySelector('.seat-overhead-stack')) });
                  targets.push({ name: `${id}:nameplate`, box: boxOf(seat.querySelector('.character-nameplate')) });
                  targets.push({ name: `${id}:speech-bubble`, box: boxOf(seat.querySelector('.speech-bubble')) });
                }

                const zOf = (sel: string) => parseInt(getComputedStyle(document.querySelector(sel)!).zIndex || '0', 10);
                return {
                  paintingDisplay: painting?.display ?? 'missing',
                  paintingOverlaps: targets.filter((t) => overlaps(painting, t.box)).map((t) => t.name),
                  chandelierOverlaps: targets.filter((t) => overlaps(chandelier, t.box)).map((t) => t.name),
                  sconceOverlaps: sconces.flatMap((sc, i) =>
                    targets.filter((t) => overlaps(sc, t.box)).map((t) => `sconce-${i}:${t.name}`),
                  ),
                  activeBubbleCount: document.querySelectorAll('.speech-bubble.active').length,
                  zPerspective: zOf('.pov-perspective-container'),
                  zWall: zOf('.wall-bg'),
                  zCeiling: zOf('.ceiling'),
                };
              });

              assert.ok(check.activeBubbleCount >= 2, `Expected active speech bubbles on ${vp.width}x${vp.height}`);
              assert.equal(check.paintingDisplay, 'none', `.casino-painting should be hidden on ${vp.width}x${vp.height}`);
              assert.deepEqual(check.paintingOverlaps, [], `Wall sign overlaps overhead UI on ${vp.width}x${vp.height}`);
              assert.deepEqual(check.chandelierOverlaps, [], `Chandelier overlaps overhead UI on ${vp.width}x${vp.height}`);
              assert.deepEqual(check.sconceOverlaps, [], `Sconce overlaps overhead UI on ${vp.width}x${vp.height}`);
              assert.ok(check.zPerspective > check.zWall && check.zPerspective > check.zCeiling);
            },
            { turnSpeed: 0.02, viewport: vp, engineOptions: { random: () => 0.5 } },
          );
        }

        // Standard desktop (1280x800): .casino-painting remains visible above the table and dealer nameplate
        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#pots-window-close').click();

            const desktop = await page.evaluate(() => {
              const paintingEl = document.querySelector('.casino-painting')!;
              const painting = paintingEl.getBoundingClientRect();
              const dealerPlate = document.querySelector('#dealer-container .character-nameplate')!.getBoundingClientRect();
              const table = document.querySelector('.poker-table-surface')!.getBoundingClientRect();
              return {
                display: getComputedStyle(paintingEl).display,
                width: painting.width,
                height: painting.height,
                top: painting.top,
                bottom: painting.bottom,
                dealerPlateTop: dealerPlate.top,
                tableTop: table.top,
              };
            });

            assert.notEqual(desktop.display, 'none', '.casino-painting must remain visible on 1280x800 desktop');
            assert.ok(desktop.width > 100 && desktop.height > 20, `Expected visible wall sign box: ${JSON.stringify(desktop)}`);
            assert.ok(
              desktop.bottom <= desktop.dealerPlateTop + 1,
              `Desktop wall sign overlaps dealer nameplate: ${JSON.stringify(desktop)}`,
            );
            assert.ok(desktop.bottom < desktop.tableTop, `Desktop wall sign should sit above table: ${JSON.stringify(desktop)}`);
          },
          { turnSpeed: 0.02, viewport: { width: 1280, height: 800 }, engineOptions: { random: () => 0.5 } },
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

      // ----------------------------------------------------------------------
      // TEST 13: Checking as BB Renders Flop Banner & Community Cards BEFORE First Flop Opponent Thinks
      // ----------------------------------------------------------------------
      await t.test('checking as Big Blind paints FLOP banner and 3 community cards before the first Flop opponent starts thinking', async () => {
        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            // With initialButtonSeatIndex: 3, You are BB! Wait for Check option on Pre-flop.
            await waitForPromptReady(page, 'Pre-flop • BB');

            // Observe DOM the instant the first Flop opponent enters .is-thinking
            await page.evaluate(() => {
              const snapshots: Array<{ banner: string; boardCardCount: number; thinkingId: string }> = [];
              (window as unknown as { __FLOP_SNAPS__: typeof snapshots }).__FLOP_SNAPS__ = snapshots;
              const timer = setInterval(() => {
                const thinking = document.querySelector('.character-container.is-thinking');
                if (thinking) {
                  const banner = document.getElementById('street-banner')?.textContent?.trim() || '';
                  const boardCardCount = document.querySelectorAll('#community-cards-container .card').length;
                  const thinkingId = thinking.getAttribute('data-opp-id') || '';
                  snapshots.push({ banner, boardCardCount, thinkingId });
                }
              }, 30);
              (window as unknown as { __FLOP_TIMER__: ReturnType<typeof setInterval> }).__FLOP_TIMER__ = timer;
            });

            // Click Check as BB to close Pre-flop -> triggers Flop deal + SB (tony) thinking first!
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await page.waitForSelector('.character-container.is-thinking', { timeout: 5000 });
            await waitForPromptReady(page, 'Flop • BB');

            const snaps = await page.evaluate(() => {
              clearInterval((window as unknown as { __FLOP_TIMER__: ReturnType<typeof setInterval> }).__FLOP_TIMER__);
              return (
                window as unknown as {
                  __FLOP_SNAPS__: Array<{ banner: string; boardCardCount: number; thinkingId: string }>;
                }
              ).__FLOP_SNAPS__;
            });

            assert.ok(snaps.length > 0, 'Expected to observe at least one Flop opponent thinking snapshot');
            const firstSnap = snaps[0]!;
            assert.equal(firstSnap.banner, 'FLOP', `Banner must already say FLOP when first Flop opponent thinks, saw: ${firstSnap.banner}`);
            assert.equal(firstSnap.boardCardCount, 3, `All 3 Flop community cards must be painted before first Flop opponent thinks, saw: ${firstSnap.boardCardCount}`);
            assert.equal(firstSnap.thinkingId, 'tony', 'SB (tony) must act first on Flop when BTN is seat 3');
          },
          { turnSpeed: 0.25, engineOptions: { initialButtonSeatIndex: 3, random: () => 0.5 } },
        );
      });

      await t.test('mixed side-pot win renders gold mixed HUD status and separate main/side pot awards', async () => {
        let handIdx = 0;
        const deckFactory = () => {
          handIdx += 1;
          if (handIdx === 1) {
            const cards = [
              new Card('♠', '3'), new Card('♥', '7'),
              new Card('♦', 'J'), new Card('♥', '8'),
              new Card('♣', '10'), new Card('♦', '4'),
              new Card('♥', '10'), new Card('♣', '5'),
              new Card('♠', 'A'), new Card('♥', 'A'),
              new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
              new Card('♣', 'Q'),
              new Card('♥', '4'),
            ];
            return { draw: () => cards.shift()! };
          }
          const cards = [
            new Card('♠', 'K'), new Card('♥', 'K'), // Player wins $30 side pot
            new Card('♠', 'A'), new Card('♥', 'A'), // Reginald wins $75 main pot
            new Card('♣', '7'), new Card('♦', '8'),
            new Card('♥', '7'), new Card('♠', '8'),
            new Card('♠', 'Q'), new Card('♥', 'Q'), // Tony loses side pot
            new Card('♣', '2'), new Card('♦', '4'), new Card('♠', '6'),
            new Card('♣', '9'),
            new Card('♥', 'J'),
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page, baseUrl }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            // Hand 1 -> Tony reaches $65, Reg/Buck/Elon drop to $15
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await waitForPromptReady(page, 'Flop');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Turn');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'River');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            // Hand 2 -> Flop bet $20 creates $75 main pot (Reginald) + $30 side pot (You)
            await page.locator('#action-buttons-group button[data-choice-id="yes"]').click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await waitForPromptReady(page, 'Flop');
            await page.locator('#action-buttons-group button[data-choice-id="bet"]').click();
            await waitForPromptReady(page, 'Turn');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'River');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Mixed result');

            const hud = await page.evaluate(() => {
              const statusEl = document.getElementById('hud-street-status')!;
              return {
                statusText: statusEl.textContent?.trim() || '',
                statusColor: getComputedStyle(statusEl).color,
                promptTitle: document.getElementById('action-prompt-title')?.textContent?.trim() || '',
              };
            });

            const state = await apiGetState(baseUrl);
            assert.equal(state.outcome?.result, 'mixed');
            assert.equal(hud.statusText, 'Result: Mixed Pot Split (You Won $30)');
            assert.equal(hud.statusColor, 'rgb(251, 191, 36)', 'Mixed side-pot win must render in gold/amber, not red');
            assert.match(hud.promptTitle, /Main pot \(\$75\): Lord Reginald; Side pot \(\$30\): You/);
          },
          {
            turnSpeed: 0.02,
            engineOptions: {
              initialPlayerChips: 500,
              initialOpponentChips: 25,
              initialButtonSeatIndex: 0,
              random: () => 0.5,
              deckFactory,
            },
          },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 15: Issue #3 — Closed Table Pots & Log Panels Are Inert, Skipped by Tab & Return Focus on Close
      // ----------------------------------------------------------------------
      await t.test('closed Table Pots and Log panels are inert/hidden, skipped by Tab, return focus on close, and restore reachability on reopen', async () => {
        await withGamePage(
          async ({ page }) => {
            // Check initial DOM state on load before starting hand: #history-drawer starts closed and inert
            const initialPanelState = await page.evaluate(() => {
              const drawer = document.getElementById('history-drawer') as HTMLElement;
              const pots = document.getElementById('pots-window') as HTMLElement;
              const logBtn = document.getElementById('log-toggle-btn') as HTMLButtonElement;
              const potsBtn = document.getElementById('pots-toggle-btn') as HTMLButtonElement;
              return {
                drawerInert: drawer.inert,
                drawerAriaHidden: drawer.getAttribute('aria-hidden'),
                drawerVisibility: getComputedStyle(drawer).visibility,
                logExpanded: logBtn.getAttribute('aria-expanded'),
                logControls: logBtn.getAttribute('aria-controls'),
                potsInert: pots.inert,
                potsAriaHidden: pots.getAttribute('aria-hidden'),
                potsVisibility: getComputedStyle(pots).visibility,
                potsExpanded: potsBtn.getAttribute('aria-expanded'),
                potsControls: potsBtn.getAttribute('aria-controls'),
              };
            });

            assert.equal(initialPanelState.drawerInert, true);
            assert.equal(initialPanelState.drawerAriaHidden, 'true');
            assert.equal(initialPanelState.drawerVisibility, 'hidden');
            assert.equal(initialPanelState.logExpanded, 'false');
            assert.equal(initialPanelState.logControls, 'history-drawer');
            assert.equal(initialPanelState.potsInert, false);
            assert.equal(initialPanelState.potsAriaHidden, 'false');
            assert.equal(initialPanelState.potsVisibility, 'visible');
            assert.equal(initialPanelState.potsExpanded, 'true');
            assert.equal(initialPanelState.potsControls, 'pots-window');

            // Start a hand
            await page.locator('#btn-random-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            const collectTabOrder = async (steps = 20): Promise<Array<{ id: string; inPots: boolean; inDrawer: boolean }>> => {
              await page.evaluate(() => {
                (document.activeElement as HTMLElement | null)?.blur?.();
              });
              const visited: Array<{ id: string; inPots: boolean; inDrawer: boolean }> = [];
              for (let i = 0; i < steps; i += 1) {
                await page.keyboard.press('Tab');
                const info = await page.evaluate(() => {
                  const active = document.activeElement;
                  const pots = document.getElementById('pots-window');
                  const drawer = document.getElementById('history-drawer');
                  return {
                    id: active?.id || active?.tagName || '',
                    inPots: Boolean(pots && active && pots.contains(active)),
                    inDrawer: Boolean(drawer && active && drawer.contains(active)),
                  };
                });
                visited.push(info);
              }
              return visited;
            };

            // 1. With #pots-window open and #history-drawer closed: Tab reaches #pots-window-close, NEVER #drawer-close
            const openPotsTabOrder = await collectTabOrder(18);
            assert.ok(
              openPotsTabOrder.some((entry) => entry.id === 'pots-window-close'),
              `Expected open Table Pots close button to be reachable via Tab, visited: ${openPotsTabOrder.map((v) => v.id).join(', ')}`,
            );
            assert.equal(
              openPotsTabOrder.some((entry) => entry.inDrawer || entry.id === 'drawer-close'),
              false,
              'Closed #history-drawer must be skipped by Tab on initial load',
            );

            // 2. Closing #pots-window via #pots-window-close returns focus to #pots-toggle-btn and makes panel inert/hidden
            await page.locator('#pots-window-close').click();
            const afterPotsClose = await page.evaluate(() => {
              const pots = document.getElementById('pots-window') as HTMLElement;
              const potsBtn = document.getElementById('pots-toggle-btn') as HTMLButtonElement;
              return {
                activeId: document.activeElement?.id || '',
                potsOpen: pots.classList.contains('open'),
                potsInert: pots.inert,
                potsAriaHidden: pots.getAttribute('aria-hidden'),
                potsVisibility: getComputedStyle(pots).visibility,
                potsExpanded: potsBtn.getAttribute('aria-expanded'),
              };
            });
            assert.equal(afterPotsClose.activeId, 'pots-toggle-btn');
            assert.equal(afterPotsClose.potsOpen, false);
            assert.equal(afterPotsClose.potsInert, true);
            assert.equal(afterPotsClose.potsAriaHidden, 'true');
            assert.equal(afterPotsClose.potsVisibility, 'hidden');
            assert.equal(afterPotsClose.potsExpanded, 'false');

            // 3. With BOTH panels closed: Tab across the entire document NEVER enters #pots-window or #history-drawer
            const bothClosedTabOrder = await collectTabOrder(24);
            assert.equal(
              bothClosedTabOrder.some((entry) => entry.inPots || entry.id === 'pots-window-close'),
              false,
              `Closed #pots-window must never receive Tab focus, visited: ${bothClosedTabOrder.map((v) => v.id).join(', ')}`,
            );
            assert.equal(
              bothClosedTabOrder.some((entry) => entry.inDrawer || entry.id === 'drawer-close'),
              false,
              `Closed #history-drawer must never receive Tab focus, visited: ${bothClosedTabOrder.map((v) => v.id).join(', ')}`,
            );

            // 4. Re-open #pots-window via toggle button -> restores reachability; closing via Escape from inside returns focus to #pots-toggle-btn
            await page.locator('#pots-toggle-btn').click();
            assert.equal(await page.locator('#pots-toggle-btn').getAttribute('aria-expanded'), 'true');
            assert.equal(await page.locator('#pots-window').evaluate((el) => (el as HTMLElement).inert), false);
            await page.locator('#pots-window-close').focus();
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'pots-window-close');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#pots-window').evaluate((el) => (el as HTMLElement).inert), true);
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'pots-toggle-btn');

            // 5. Re-open #pots-window via 'P' hotkey, then close via 'P' hotkey -> returns focus to #pots-toggle-btn
            await page.keyboard.press('p');
            assert.equal(await page.locator('#pots-window').evaluate((el) => el.classList.contains('open')), true);
            await page.locator('#sound-toggle').focus();
            await page.keyboard.press('p');
            assert.equal(await page.locator('#pots-window').evaluate((el) => el.classList.contains('open')), false);
            assert.equal(await page.locator('#pots-window').evaluate((el) => (el as HTMLElement).inert), true);
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'pots-toggle-btn');

            // 6. Open #history-drawer -> restores keyboard reachability to #drawer-close; closing via #drawer-close returns focus to #log-toggle-btn
            await page.locator('#log-toggle-btn').click();
            const openDrawerState = await page.evaluate(() => {
              const drawer = document.getElementById('history-drawer') as HTMLElement;
              const logBtn = document.getElementById('log-toggle-btn') as HTMLButtonElement;
              return {
                open: drawer.classList.contains('open'),
                inert: drawer.inert,
                ariaHidden: drawer.getAttribute('aria-hidden'),
                visibility: getComputedStyle(drawer).visibility,
                expanded: logBtn.getAttribute('aria-expanded'),
              };
            });
            assert.equal(openDrawerState.open, true);
            assert.equal(openDrawerState.inert, false);
            assert.equal(openDrawerState.ariaHidden, 'false');
            assert.equal(openDrawerState.visibility, 'visible');
            assert.equal(openDrawerState.expanded, 'true');

            const openDrawerTabOrder = await collectTabOrder(24);
            assert.ok(
              openDrawerTabOrder.some((entry) => entry.id === 'drawer-close'),
              `Expected open Log drawer close button to be reachable via Tab, visited: ${openDrawerTabOrder.map((v) => v.id).join(', ')}`,
            );

            await page.locator('#drawer-close').click();
            const closedDrawerState = await page.evaluate(() => {
              const drawer = document.getElementById('history-drawer') as HTMLElement;
              const logBtn = document.getElementById('log-toggle-btn') as HTMLButtonElement;
              return {
                activeId: document.activeElement?.id || '',
                open: drawer.classList.contains('open'),
                inert: drawer.inert,
                ariaHidden: drawer.getAttribute('aria-hidden'),
                visibility: getComputedStyle(drawer).visibility,
                expanded: logBtn.getAttribute('aria-expanded'),
              };
            });
            assert.equal(closedDrawerState.activeId, 'log-toggle-btn');
            assert.equal(closedDrawerState.open, false);
            assert.equal(closedDrawerState.inert, true);
            assert.equal(closedDrawerState.ariaHidden, 'true');
            assert.equal(closedDrawerState.visibility, 'hidden');
            assert.equal(closedDrawerState.expanded, 'false');

            // 7. Open #history-drawer again, focus #drawer-close, press Escape -> closes and returns focus to #log-toggle-btn
            await page.locator('#log-toggle-btn').click();
            await page.locator('#drawer-close').focus();
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'drawer-close');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#history-drawer').evaluate((el) => (el as HTMLElement).inert), true);
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'log-toggle-btn');

            // 8. Toggle #history-drawer open then closed via #log-toggle-btn -> keeps focus on #log-toggle-btn and re-inerts drawer
            await page.locator('#log-toggle-btn').click();
            assert.equal(await page.locator('#history-drawer').evaluate((el) => (el as HTMLElement).inert), false);
            await page.locator('#log-toggle-btn').click();
            assert.equal(await page.locator('#history-drawer').evaluate((el) => (el as HTMLElement).inert), true);
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'log-toggle-btn');
          },
          { turnSpeed: 0.02 },
        );
      });
      // TEST 15: Phone Viewports (390×844 & 360×740) Table Pots Position Badges Never Clip
      // ----------------------------------------------------------------------
      for (const vp of [
        { width: 390, height: 844 },
        { width: 360, height: 740 },
      ]) {
        await t.test(
          `phone viewport (${vp.width}x${vp.height}) keeps all 5 Table Pots position badges and numeric columns completely unclipped with long opponent names`,
          async () => {
            await withGamePage(
              async ({ page }) => {
                // Seat Mei-Ling (SB), Viktor (BB), Tariq (UTG), and Reginald (CO) alongside You (BTN)
                await page.locator('.opponent-pick-card[data-opp-id="meiling"]').click();
                await page.locator('.opponent-pick-card[data-opp-id="viktor"]').click();
                await page.locator('.opponent-pick-card[data-opp-id="tariq"]').click();
                await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
                await page.locator('#btn-confirm-opponents').click();
                await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
                await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
                await waitForPromptReady(page, 'Pre-flop');

                // Ensure Table Pots window is open
                const isOpen = await page.locator('#pots-window').evaluate((el) => el.classList.contains('open'));
                if (!isOpen) {
                  await page.locator('#pots-toggle-btn').click();
                }
                await page.waitForSelector('#pots-window.open #pots-window-body .pots-row');

                const metrics = await page.evaluate(() => {
                  const vw = window.innerWidth;
                  const win = document.getElementById('pots-window')!;
                  const winRect = win.getBoundingClientRect();
                  const rows = Array.from(document.querySelectorAll('#pots-window-body .pots-row')).map((row) => {
                    const cell = row.querySelector('.pots-player-cell') as HTMLElement | null;
                    const pill = row.querySelector('.pots-pos-pill') as HTMLElement | null;
                    const label = row.querySelector('.pots-player-label') as HTMLElement | null;
                    const vals = Array.from(row.querySelectorAll('.pots-val')).map((el) => {
                      const vEl = el as HTMLElement;
                      const r = vEl.getBoundingClientRect();
                      return {
                        text: vEl.textContent?.trim() || '',
                        left: r.left,
                        right: r.right,
                        width: r.width,
                        scrollWidth: vEl.scrollWidth,
                        clientWidth: vEl.clientWidth,
                      };
                    });
                    const cellRect = cell?.getBoundingClientRect();
                    const pillRect = pill?.getBoundingClientRect();
                    return {
                      labelText: label?.textContent?.trim() || '',
                      pillText: pill?.textContent?.trim() || '',
                      cellScrollWidth: cell?.scrollWidth ?? -1,
                      cellClientWidth: cell?.clientWidth ?? -1,
                      pillScrollWidth: pill?.scrollWidth ?? -1,
                      pillClientWidth: pill?.clientWidth ?? -1,
                      cellRect: cellRect
                        ? { left: cellRect.left, right: cellRect.right, width: cellRect.width }
                        : null,
                      pillRect: pillRect
                        ? { left: pillRect.left, right: pillRect.right, width: pillRect.width }
                        : null,
                      vals,
                    };
                  });
                  return {
                    vw,
                    winRect: { left: winRect.left, right: winRect.right, width: winRect.width },
                    winScrollWidth: win.scrollWidth,
                    winClientWidth: win.clientWidth,
                    rows,
                  };
                });

                assert.equal(metrics.vw, vp.width);
                assert.ok(
                  metrics.winRect.left >= 0 && metrics.winRect.right <= vp.width + 1,
                  `Table Pots window clipped outside ${vp.width}px viewport: ${JSON.stringify(metrics.winRect)}`,
                );
                assert.ok(
                  metrics.winScrollWidth <= metrics.winClientWidth + 1,
                  `Table Pots window overflows horizontally: scrollWidth=${metrics.winScrollWidth}, clientWidth=${metrics.winClientWidth}`,
                );
                assert.equal(metrics.rows.length, 5);

                const seenPositions: string[] = [];
                for (const row of metrics.rows) {
                  assert.ok(row.cellRect, `Missing .pots-player-cell for ${row.labelText}`);
                  assert.ok(row.pillRect, `Missing .pots-pos-pill for ${row.labelText}`);
                  assert.match(row.pillText, /^(BTN|SB|BB|UTG|CO)$/, `Unexpected position badge text: ${row.pillText}`);
                  seenPositions.push(row.pillText);

                  assert.ok(
                    row.cellScrollWidth <= row.cellClientWidth + 1,
                    `Player cell clipped for ${row.labelText} (${row.pillText}): scrollWidth=${row.cellScrollWidth}, clientWidth=${row.cellClientWidth}`,
                  );
                  assert.ok(
                    row.pillScrollWidth <= row.pillClientWidth + 1,
                    `Position badge clipped internally for ${row.labelText} (${row.pillText}): scrollWidth=${row.pillScrollWidth}, clientWidth=${row.pillClientWidth}`,
                  );
                  assert.ok(
                    row.pillRect.left >= row.cellRect.left - 1 && row.pillRect.right <= row.cellRect.right + 1,
                    `Position badge ${row.pillText} for ${row.labelText} overflows player cell: pill=${JSON.stringify(row.pillRect)}, cell=${JSON.stringify(row.cellRect)}`,
                  );
                  assert.ok(
                    row.pillRect.left >= metrics.winRect.left && row.pillRect.right <= metrics.winRect.right + 1,
                    `Position badge ${row.pillText} for ${row.labelText} overflows #pots-window: pill=${JSON.stringify(row.pillRect)}, win=${JSON.stringify(metrics.winRect)}`,
                  );
                  assert.ok(
                    row.pillRect.width >= 22,
                    `Position badge ${row.pillText} for ${row.labelText} too narrow/clipped: width=${row.pillRect.width}`,
                  );

                  assert.equal(row.vals.length, 3, `Expected 3 numeric columns for ${row.labelText}`);
                  let prevRight = row.cellRect.right;
                  for (const val of row.vals) {
                    assert.ok(
                      val.left >= prevRight - 1,
                      `Numeric column ${val.text} overlaps previous column in row ${row.labelText}: left=${val.left}, prevRight=${prevRight}`,
                    );
                    assert.ok(
                      val.right <= metrics.winRect.right + 1,
                      `Numeric column ${val.text} clips outside #pots-window in row ${row.labelText}: right=${val.right}, winRight=${metrics.winRect.right}`,
                    );
                    assert.ok(
                      val.scrollWidth <= val.clientWidth + 1,
                      `Numeric column ${val.text} overflows its own track in row ${row.labelText}: scrollWidth=${val.scrollWidth}, clientWidth=${val.clientWidth}`,
                    );
                    prevRight = val.right;
                  }
                }
                assert.deepEqual([...seenPositions].sort(), ['BB', 'BTN', 'CO', 'SB', 'UTG']);
              },
              {
                turnSpeed: 0.02,
                viewport: vp,
                engineOptions: { random: () => 0.5 },
              },
            );
          },
        );
      }
      // TEST 15: Big-Blind Pre-flop Raise Button & Log Entry (Issue #6)
      // ----------------------------------------------------------------------
      await t.test('big-blind pre-flop raise button reads Raise to $20 (+$10), logs You raise to $20 (+$10)., and opponents face $10 more', async () => {
        await withGamePage(
          async ({ page, baseUrl }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop • BB');

            const betBtn = page.locator('#action-buttons-group button[data-choice-id="bet"]');
            const betBtnText = (await betBtn.locator('span').first().textContent())?.trim();
            assert.equal(betBtnText, 'Raise to $20 (+$10)');

            const actionRespPromise = page.waitForResponse((r) => r.url().includes('/api/action'));
            await betBtn.click();
            const actionResp = await actionRespPromise;
            const afterRaiseState = (await actionResp.json()) as SerializedGameState;

            const preFlopEvents = afterRaiseState.turnEvents.filter((e) => e.streetName === 'Pre-flop');
            assert.equal(preFlopEvents.length, 4);
            for (const ev of preFlopEvents) {
              assert.equal(ev.action, 'call');
              assert.equal(ev.amount, 10, `Expected opponent ${ev.opponentId} to face $10 more`);
            }

            await waitForPromptReady(page, 'Flop • BB');

            // Open Log drawer and verify "You raise to $20 (+$10)." appears (never "You bet $10.")
            await page.locator('#log-toggle-btn').click();
            await page.waitForSelector('#history-drawer.open');
            const logTexts = await page.locator('#drawer-content .log-entry').allTextContents();
            assert.ok(
              logTexts.some((t) => t.includes('[You]') && t.includes('You raise to $20 (+$10).')),
              `Expected Log to include "You raise to $20 (+$10).", got: ${JSON.stringify(logTexts)}`,
            );
            assert.ok(
              !logTexts.some((t) => t.includes('You bet $10.')),
              `Log must not include "You bet $10.", got: ${JSON.stringify(logTexts)}`,
            );

            // Post-flop opening bet button still reads "Bet $20"
            const flopBetText = (
              await page.locator('#action-buttons-group button[data-choice-id="bet"] span').first().textContent()
            )?.trim();
            assert.equal(flopBetText, 'Bet $20');

            const finalState = await apiGetState(baseUrl);
            assert.equal(finalState.playerHandContribution, 20);
            assert.equal(finalState.pot, 100);
          },
          { turnSpeed: 0.02, engineOptions: { initialButtonSeatIndex: 3, random: () => 0.5 } },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 15: Card Accessibility Tree — Full Rank+Suit Labels (incl. Diamonds), No Mirrored Duplicates, Generic Card Backs
      // ----------------------------------------------------------------------
      await t.test('face-up diamond and suited cards expose single rank+suit accessible names and hidden cards expose Face-down card', async () => {
        const deckFactory = () => {
          const cards = [
            new Card('♦', '10'), new Card('♦', '4'), // Player (BTN): 10 of Diamonds, 4 of Diamonds
            new Card('♠', '4'), new Card('♣', '8'),  // Seat 1: Reginald (SB -> calls & stays active/hidden)
            new Card('♥', '4'), new Card('♠', '8'),  // Seat 2: Buck (BB -> checks & stays active/hidden)
            new Card('♣', '2'), new Card('♦', '5'),  // Seat 3: Elon (UTG -> folds pre-flop, revealed!)
            new Card('♠', '2'), new Card('♥', '5'),  // Seat 4: Tony (CO -> folds pre-flop, revealed!)
            new Card('♦', 'A'), new Card('♦', 'K'), new Card('♦', '7'), // Flop: 3 Diamond community cards
            new Card('♣', 'Q'), // Turn
            new Card('♥', '9'), // River
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Hard' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            // 1. Player's Diamond cards expose exact rank+suit accessible names (never rank-only, never mirrored duplicates)
            const playerCardsLoc = page.locator('#player-cards-container');
            assert.equal(await playerCardsLoc.getByRole('img', { name: '10 of Diamonds', exact: true }).count(), 1);
            assert.equal(await playerCardsLoc.getByRole('img', { name: '4 of Diamonds', exact: true }).count(), 1);
            const playerAria = await playerCardsLoc.ariaSnapshot();
            assert.equal(
              playerAria.trim(),
              ['- img "10 of Diamonds"', '- img "4 of Diamonds"'].join('\n'),
              `Unexpected player cards ARIA snapshot:\n${playerAria}`,
            );

            // 2. Folded opponents' revealed cards expose exact "<Rank> of <Suit>" names (covering all 4 suits)
            const elonCardsLoc = page.locator('#opp-cards-container-elon');
            assert.equal(await elonCardsLoc.getByRole('img', { name: '2 of Clubs', exact: true }).count(), 1);
            assert.equal(await elonCardsLoc.getByRole('img', { name: '5 of Diamonds', exact: true }).count(), 1);
            assert.equal(
              (await elonCardsLoc.ariaSnapshot()).trim(),
              ['- img "2 of Clubs"', '- img "5 of Diamonds"'].join('\n'),
            );

            const tonyCardsLoc = page.locator('#opp-cards-container-tony');
            assert.equal(await tonyCardsLoc.getByRole('img', { name: '2 of Spades', exact: true }).count(), 1);
            assert.equal(await tonyCardsLoc.getByRole('img', { name: '5 of Hearts', exact: true }).count(), 1);
            assert.equal(
              (await tonyCardsLoc.ariaSnapshot()).trim(),
              ['- img "2 of Spades"', '- img "5 of Hearts"'].join('\n'),
            );

            // 3. Active non-folded opponents expose ONLY generic "Face-down card" labels (zero rank/suit leakage)
            const regCardsLoc = page.locator('#opp-cards-container-reginald');
            const buckCardsLoc = page.locator('#opp-cards-container-buck');
            assert.equal(await regCardsLoc.getByRole('img', { name: 'Face-down card', exact: true }).count(), 2);
            assert.equal(await buckCardsLoc.getByRole('img', { name: 'Face-down card', exact: true }).count(), 2);
            assert.equal(await page.getByRole('img', { name: 'Face-down card', exact: true }).count(), 4);
            const regAria = await regCardsLoc.ariaSnapshot();
            const buckAria = await buckCardsLoc.ariaSnapshot();
            assert.equal(regAria.trim(), ['- img "Face-down card"', '- img "Face-down card"'].join('\n'));
            assert.equal(buckAria.trim(), ['- img "Face-down card"', '- img "Face-down card"'].join('\n'));

            // 4. Advance to Flop and verify Diamond community cards expose exact single accessible names
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await waitForPromptReady(page, 'Flop');

            const boardLoc = page.locator('#community-cards-container');
            assert.equal(await boardLoc.getByRole('img', { name: 'Ace of Diamonds', exact: true }).count(), 1);
            assert.equal(await boardLoc.getByRole('img', { name: 'King of Diamonds', exact: true }).count(), 1);
            assert.equal(await boardLoc.getByRole('img', { name: '7 of Diamonds', exact: true }).count(), 1);
            const boardAria = await boardLoc.ariaSnapshot();
            assert.ok(boardAria.includes('- img "Ace of Diamonds"'), `Missing Ace of Diamonds in board ARIA:\n${boardAria}`);
            assert.ok(boardAria.includes('- img "King of Diamonds"'), `Missing King of Diamonds in board ARIA:\n${boardAria}`);
            assert.ok(boardAria.includes('- img "7 of Diamonds"'), `Missing 7 of Diamonds in board ARIA:\n${boardAria}`);
            assert.equal(
              boardAria.includes('text: "A"') || boardAria.includes('text: "K"') || boardAria.includes('text: "7"'),
              false,
              `Board ARIA snapshot must not contain bare rank text nodes:\n${boardAria}`,
            );

            // Active opponents still remain labelled "Face-down card" on Flop
            assert.equal(await page.getByRole('img', { name: 'Face-down card', exact: true }).count(), 4);

            // 5. Check down through Turn & River to Showdown -> remaining opponents reveal exact accessible names
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Turn');
            assert.equal(await boardLoc.getByRole('img', { name: 'Queen of Clubs', exact: true }).count(), 1);

            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'River');
            assert.equal(await boardLoc.getByRole('img', { name: '9 of Hearts', exact: true }).count(), 1);

            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            assert.equal(await page.getByRole('img', { name: 'Face-down card', exact: true }).count(), 0);
            assert.equal(await regCardsLoc.getByRole('img', { name: '4 of Spades', exact: true }).count(), 1);
            assert.equal(await regCardsLoc.getByRole('img', { name: '8 of Clubs', exact: true }).count(), 1);
            assert.equal(await buckCardsLoc.getByRole('img', { name: '4 of Hearts', exact: true }).count(), 1);
            assert.equal(await buckCardsLoc.getByRole('img', { name: '8 of Spades', exact: true }).count(), 1);
          },
          {
            turnSpeed: 0.02,
            engineOptions: {
              initialPlayerChips: 500,
              initialOpponentChips: 500,
              initialButtonSeatIndex: 0,
              random: () => 0.99,
              deckFactory,
            },
          },
        );
      });

      await t.test('Cash Out screen displays session summary panel with hands played, final stack, rebuy credits, and net gain/loss', async () => {
        const makeWinningDeck = () => {
          const cards = [
            new Card('♠', 'A'), new Card('♥', 'A'),
            new Card('♠', 'K'), new Card('♥', 'K'),
            new Card('♠', 'Q'), new Card('♥', 'Q'),
            new Card('♠', 'J'), new Card('♥', 'J'),
            new Card('♠', '10'), new Card('♥', '10'),
            new Card('♣', '2'), new Card('♦', '6'), new Card('♠', '9'),
            new Card('♣', '4'),
            new Card('♥', '7'),
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();

            // Play 4 hands to reach an $820 stack (+$320 net gain with 0 rebuys)
            for (let h = 1; h <= 4; h += 1) {
              await waitForPromptReady(page, 'Pre-flop');
              const preBtn = page.locator('#action-buttons-group button[data-choice-id="call"]');
              if ((await preBtn.count()) > 0) {
                await preBtn.click();
              } else {
                await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
              }
              await waitForPromptReady(page, 'Flop');
              await page.locator(`#action-buttons-group button[data-choice-id="${h <= 2 ? 'bet' : 'check'}"]`).click();
              await waitForPromptReady(page, 'Turn');
              await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
              await waitForPromptReady(page, 'River');
              await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
              await waitForPromptReady(page, 'Play another hand?');
              if (h < 4) {
                await page.locator('#action-buttons-group button[data-choice-id="yes"]').click();
              }
            }

            assert.equal(await page.locator('#session-summary-panel').isHidden(), true);
            await page.locator('#action-buttons-group button[data-choice-id="no"]').click();
            await waitForPromptReady(page, 'Session complete!');

            assert.equal(await page.locator('#session-summary-panel').isVisible(), true);
            assert.equal((await page.locator('#summary-hands-played').textContent())?.trim(), '4');
            assert.equal((await page.locator('#summary-hands-won').textContent())?.trim(), '4 hands won');
            assert.equal((await page.locator('#summary-final-stack').textContent())?.trim(), '$820');
            assert.equal((await page.locator('#summary-rebuys').textContent())?.trim(), '0 ($0)');
            assert.equal((await page.locator('#summary-net-profit').textContent())?.trim(), '+$320');
            assert.equal(
              await page.locator('#summary-net-profit').evaluate((el) => el.classList.contains('net-positive')),
              true,
            );
          },
          {
            turnSpeed: 0.02,
            engineOptions: {
              initialPlayerChips: 500,
              initialOpponentChips: 500,
              initialButtonSeatIndex: 0,
              random: () => 0.5,
              deckFactory: makeWinningDeck,
            },
          },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 15: Mute Preference Persistence Across Page Reload (Issue #11)
      // ----------------------------------------------------------------------
      await t.test('mute preference via button and M hotkey persists in localStorage across reload and suppresses initial load audio', async () => {
        await withGamePage(
          async ({ page }) => {
            // 1. Default unmuted state on fresh load
            const initialSoundState = await page.evaluate(() => {
              const btn = document.getElementById('sound-toggle')!;
              const icon = document.getElementById('sound-icon')!;
              const sfx = (window as unknown as { __POKER_SFX__: { muted: boolean; enabled: boolean; playedCount: number } }).__POKER_SFX__;
              return {
                icon: icon.textContent?.trim(),
                ariaPressed: btn.getAttribute('aria-pressed'),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasMutedClass: btn.classList.contains('is-muted'),
                savedPref: window.localStorage.getItem('high_roller_muted'),
                muted: sfx.muted,
                enabled: sfx.enabled,
                playedCount: sfx.playedCount,
              };
            });
            assert.equal(initialSoundState.icon, '🔊');
            assert.equal(initialSoundState.ariaPressed, 'false');
            assert.equal(initialSoundState.ariaLabel, 'Mute Sound (M)');
            assert.equal(initialSoundState.title, 'Mute Sound (M)');
            assert.equal(initialSoundState.hasMutedClass, false);
            assert.equal(initialSoundState.muted, false);
            assert.equal(initialSoundState.enabled, true);
            assert.ok(initialSoundState.playedCount >= 1, 'Initial unmuted boot should record initial card deal sound');

            // 2. Complete a hand so the table has a restored hand & result on reload
            for (const id of ['reginald', 'buck', 'elon', 'tony']) {
              await page.locator(`.opponent-pick-card[data-opp-id="${id}"]`).click();
            }
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="fold"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            // 3. Mute after the hand by clicking #sound-toggle
            await page.locator('#sound-toggle').click();
            const afterClickMute = await page.evaluate(() => {
              const btn = document.getElementById('sound-toggle')!;
              const icon = document.getElementById('sound-icon')!;
              const sfx = (window as unknown as { __POKER_SFX__: { muted: boolean; enabled: boolean } }).__POKER_SFX__;
              return {
                icon: icon.textContent?.trim(),
                ariaPressed: btn.getAttribute('aria-pressed'),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasMutedClass: btn.classList.contains('is-muted'),
                savedPref: window.localStorage.getItem('high_roller_muted'),
                muted: sfx.muted,
                enabled: sfx.enabled,
              };
            });
            assert.equal(afterClickMute.icon, '🔇');
            assert.equal(afterClickMute.ariaPressed, 'true');
            assert.equal(afterClickMute.ariaLabel, 'Mute Sound (M)');
            assert.equal(afterClickMute.title, 'Unmute Sound (M)');
            assert.equal(afterClickMute.hasMutedClass, true);
            assert.equal(afterClickMute.savedPref, 'true');
            assert.equal(afterClickMute.muted, true);
            assert.equal(afterClickMute.enabled, false);

            // 4. Reload the tab while muted -> must apply BEFORE fetchInitialState() and remain muted after load with 0 sounds played!
            await page.reload({ waitUntil: 'networkidle' });
            await waitForPromptReady(page, 'Play another hand?');

            const afterMutedReload = await page.evaluate(() => {
              const btn = document.getElementById('sound-toggle')!;
              const icon = document.getElementById('sound-icon')!;
              const sfx = (window as unknown as { __POKER_SFX__: { muted: boolean; enabled: boolean; playedCount: number } }).__POKER_SFX__;
              const statusText = document.getElementById('hud-street-status')?.textContent?.trim() || '';
              return {
                icon: icon.textContent?.trim(),
                ariaPressed: btn.getAttribute('aria-pressed'),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasMutedClass: btn.classList.contains('is-muted'),
                savedPref: window.localStorage.getItem('high_roller_muted'),
                muted: sfx.muted,
                enabled: sfx.enabled,
                playedCount: sfx.playedCount,
                statusText,
              };
            });
            assert.equal(afterMutedReload.icon, '🔇');
            assert.equal(afterMutedReload.ariaPressed, 'true');
            assert.equal(afterMutedReload.ariaLabel, 'Mute Sound (M)');
            assert.equal(afterMutedReload.title, 'Unmute Sound (M)');
            assert.equal(afterMutedReload.hasMutedClass, true);
            assert.equal(afterMutedReload.savedPref, 'true');
            assert.equal(afterMutedReload.muted, true);
            assert.equal(afterMutedReload.enabled, false);
            assert.equal(afterMutedReload.playedCount, 0, 'Reloading while muted must play zero sounds during fetchInitialState');
            assert.ok(afterMutedReload.statusText.startsWith('Result:'), 'Completed hand result must return after reload');

            // 5. Press 'M' hotkey to unmute -> updates UI and saves 'false' in localStorage, and persists across reload
            await page.keyboard.press('m');
            const afterHotkeyUnmute = await page.evaluate(() => {
              const btn = document.getElementById('sound-toggle')!;
              const icon = document.getElementById('sound-icon')!;
              return {
                icon: icon.textContent?.trim(),
                ariaPressed: btn.getAttribute('aria-pressed'),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasMutedClass: btn.classList.contains('is-muted'),
                savedPref: window.localStorage.getItem('high_roller_muted'),
              };
            });
            assert.equal(afterHotkeyUnmute.icon, '🔊');
            assert.equal(afterHotkeyUnmute.ariaPressed, 'false');
            assert.equal(afterHotkeyUnmute.ariaLabel, 'Mute Sound (M)');
            assert.equal(afterHotkeyUnmute.title, 'Mute Sound (M)');
            assert.equal(afterHotkeyUnmute.hasMutedClass, false);
            assert.equal(afterHotkeyUnmute.savedPref, 'false');

            // Press 'M' hotkey to mute again, reload, then unmute and reload to verify both directions
            await page.keyboard.press('m');
            assert.equal(await page.evaluate(() => window.localStorage.getItem('high_roller_muted')), 'true');
            await page.keyboard.press('m');
            assert.equal(await page.evaluate(() => window.localStorage.getItem('high_roller_muted')), 'false');

            await page.reload({ waitUntil: 'networkidle' });
            await waitForPromptReady(page, 'Play another hand?');

            const afterUnmutedReload = await page.evaluate(() => {
              const btn = document.getElementById('sound-toggle')!;
              const icon = document.getElementById('sound-icon')!;
              const sfx = (window as unknown as { __POKER_SFX__: { muted: boolean; enabled: boolean; playedCount: number } }).__POKER_SFX__;
              return {
                icon: icon.textContent?.trim(),
                ariaPressed: btn.getAttribute('aria-pressed'),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasMutedClass: btn.classList.contains('is-muted'),
                savedPref: window.localStorage.getItem('high_roller_muted'),
                muted: sfx.muted,
                enabled: sfx.enabled,
                playedCount: sfx.playedCount,
              };
            });
            assert.equal(afterUnmutedReload.icon, '🔊');
            assert.equal(afterUnmutedReload.ariaPressed, 'false');
            assert.equal(afterUnmutedReload.ariaLabel, 'Mute Sound (M)');
            assert.equal(afterUnmutedReload.title, 'Mute Sound (M)');
            assert.equal(afterUnmutedReload.hasMutedClass, false);
            assert.equal(afterUnmutedReload.savedPref, 'false');
            assert.equal(afterUnmutedReload.muted, false);
            assert.equal(afterUnmutedReload.enabled, true);
            assert.ok(afterUnmutedReload.playedCount >= 1, 'Reloading while unmuted must play initial load audio');
          },
          { turnSpeed: 0.02 },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 15: Equal-Category Showdown Explanation & Best-Five Card Highlighting
      // ----------------------------------------------------------------------
      await t.test('equal-category showdown explains deciding rank/kicker in HUD and applies .best-five-highlight to best-five cards', async () => {
        const makeEqualCatDeck = () => {
          const cards = [
            new Card('♠', 'A'), new Card('♦', 'K'), // Player: Pair of Aces, King kicker (A♠ A♥ K♦ J♠ 9♦)
            new Card('♣', 'A'), new Card('♥', 'Q'), // Seat 1: Reginald: Pair of Aces, Queen kicker (A♣ A♥ Q♥ J♠ 9♦)
            new Card('♣', '7'), new Card('♦', '7'), // Seat 2: Buck: Pair of 7s
            new Card('♥', '6'), new Card('♠', '6'), // Seat 3: Elon: Pair of 6s
            new Card('♦', '8'), new Card('♣', '4'), // Seat 4: Tony: High card
            new Card('♥', 'A'), new Card('♠', 'J'), new Card('♦', '9'), // Flop
            new Card('♣', '3'), // Turn
            new Card('♥', '2'), // River
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await waitForPromptReady(page, 'Flop');
            await page.locator('#action-buttons-group button[data-choice-id="bet"]').click();
            await waitForPromptReady(page, 'Turn');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'River');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            // Close Table Pots window so all 4 seated opponents and highlighted cards are clearly visible
            await page.locator('#pots-window-close').click();

            const showdownDom = await page.evaluate(() => {
              const dealerText = document.getElementById('dealer-bubble-text')?.textContent?.trim() || '';
              const dialogueText = document.getElementById('dialogue-main-text')?.textContent?.trim() || '';
              const promptTitle = document.getElementById('action-prompt-title')?.textContent?.trim() || '';
              const handBanner = document.getElementById('player-hand-rank')?.textContent?.trim() || '';
              const playerHighlighted = Array.from(
                document.querySelectorAll('#player-cards-container .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              const boardHighlighted = Array.from(
                document.querySelectorAll('#community-cards-container .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              const regHighlighted = Array.from(
                document.querySelectorAll('#opp-cards-container-reginald .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              return {
                dealerText,
                dialogueText,
                promptTitle,
                handBanner,
                playerHighlighted,
                boardHighlighted,
                regHighlighted,
              };
            });

            assert.match(showdownDom.dealerText, /Pair of Aces, King kicker over Queen kicker/);
            assert.match(showdownDom.dialogueText, /Pair of Aces, King kicker over Queen kicker/);
            assert.match(showdownDom.promptTitle, /Pair of Aces, King kicker over Queen kicker/);
            assert.match(showdownDom.handBanner, /One pair \(Pair of Aces, King kicker over Queen kicker\)/);
            assert.deepEqual(showdownDom.playerHighlighted, ['A♠', 'K♦']);
            assert.deepEqual(showdownDom.boardHighlighted, ['A♥', 'J♠', '9♦']);
            assert.deepEqual(showdownDom.regHighlighted, []);

            const screenshotPath = path.resolve(process.cwd(), 'docs', 'screenshots', 'issue-9-resolved.png');
            fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
            await page.screenshot({ path: screenshotPath });
          },
          {
            turnSpeed: 0.02,
            engineOptions: {
              initialPlayerChips: 500,
              initialOpponentChips: 500,
              initialButtonSeatIndex: 0,
              random: () => 0.5,
              deckFactory: makeEqualCatDeck,
            },
          },
        );

        // Sub-case: Equal-category High card loss where hands use different board cards (A♣ K♦ 8♥ 6♠ 2♣: Player J♣ 10♥ vs Reginald Q♥ 3♦)
        const makeDiffBoardLossDeck = () => {
          const cards = [
            new Card('♣', 'J'), new Card('♥', '10'), // Player: A♣ K♦ J♣ 10♥ 8♥
            new Card('♥', 'Q'), new Card('♦', '3'), // Seat 1: Reginald: A♣ K♦ Q♥ 8♥ 6♠ (winner)
            new Card('♣', '4'), new Card('♦', '5'), // Seat 2: Buck
            new Card('♥', '4'), new Card('♠', '5'), // Seat 3: Elon
            new Card('♦', '4'), new Card('♣', '5'), // Seat 4: Tony
            new Card('♣', 'A'), new Card('♦', 'K'), new Card('♥', '8'), // Flop
            new Card('♠', '6'), // Turn
            new Card('♣', '2'), // River
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page }) => {
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');

            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Flop');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Turn');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'River');
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Play another hand?');

            const lossDom = await page.evaluate(() => {
              const dealerText = document.getElementById('dealer-bubble-text')?.textContent?.trim() || '';
              const promptTitle = document.getElementById('action-prompt-title')?.textContent?.trim() || '';
              const handBanner = document.getElementById('player-hand-rank')?.textContent?.trim() || '';
              const allHighlighted = Array.from(document.querySelectorAll('.card.best-five-highlight')).map((el) =>
                el.getAttribute('data-card'),
              );
              const playerHighlighted = Array.from(
                document.querySelectorAll('#player-cards-container .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              const boardHighlighted = Array.from(
                document.querySelectorAll('#community-cards-container .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              const regHighlighted = Array.from(
                document.querySelectorAll('#opp-cards-container-reginald .card.best-five-highlight'),
              ).map((el) => el.getAttribute('data-card'));
              return {
                dealerText,
                promptTitle,
                handBanner,
                allHighlighted,
                playerHighlighted,
                boardHighlighted,
                regHighlighted,
              };
            });

            // Coherent 5-card winning hand highlighted across board (4 cards) + Reginald (1 card) = 5 cards total, 0 on losing player
            assert.equal(lossDom.allHighlighted.length, 5);
            assert.deepEqual(lossDom.boardHighlighted, ['A♣', 'K♦', '8♥', '6♠']);
            assert.deepEqual(lossDom.regHighlighted, ['Q♥']);
            assert.deepEqual(lossDom.playerHighlighted, []);

            // Player hand banner does NOT claim Reginald's Queen kicker over Jack kicker
            assert.equal(lossDom.handBanner, 'Your Hand: High card');
            assert.doesNotMatch(lossDom.handBanner, /Queen kicker over Jack kicker/);
            assert.match(lossDom.dealerText, /Ace-high, Queen kicker over Jack kicker/);
            assert.match(lossDom.promptTitle, /Ace-high, Queen kicker over Jack kicker/);
          },
          {
            turnSpeed: 0.02,
            engineOptions: {
              initialPlayerChips: 500,
              initialOpponentChips: 500,
              initialButtonSeatIndex: 2,
              smallBlind: 0,
              bigBlind: 0,
              random: () => 0.5,
              deckFactory: makeDiffBoardLossDeck,
            },
          },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 15: Playback Speed Toggle (1x -> 2x -> 4x -> 1x, localStorage Persistence) & Skip Playback Control
      // ----------------------------------------------------------------------
      await t.test('playback speed toggle defaults to 1x, cycles 1x -> 2x -> 4x -> 1x with localStorage persistence, and 2x/4x + Skip Playback preserve clockwise order, folded card reveals, and final state', async () => {
        const turnRngQueue: number[] = [];
        const makePlaybackTestDeck = () => {
          const cards = [
            new Card('♠', 'A'), new Card('♥', 'A'), // Player (BTN)
            new Card('♦', 'J'), new Card('♥', '8'), // Seat 1: Reginald (SB)
            new Card('♠', 'K'), new Card('♥', 'K'), // Seat 2: Buck (BB)
            new Card('♣', '2'), new Card('♦', '5'), // Seat 3: Elon (UTG -> folds on hard mode)
            new Card('♦', '10'), new Card('♠', '9'), // Seat 4: Tony (CO)
            new Card('♣', '3'), new Card('♦', '6'), new Card('♠', '9'), // Flop
            new Card('♣', 'Q'), // Turn
            new Card('♥', '4'), // River
          ];
          return { draw: () => cards.shift()! };
        };

        await withGamePage(
          async ({ page, baseUrl }) => {
            const speedBtn = page.locator('#speed-toggle-btn');
            // 1. Fresh load without ?turnSpeed= defaults to 1x
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 1x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '1x');

            // Seat reginald, buck, elon, tony so the native modal dialog closes and top-nav buttons are interactive
            await page.locator('.opponent-pick-card[data-opp-id="reginald"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="buck"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="elon"]').click();
            await page.locator('.opponent-pick-card[data-opp-id="tony"]').click();
            await page.locator('#btn-confirm-opponents').click();
            await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });

            // 2. Clicking #speed-toggle-btn cycles 1x -> 2x -> 4x -> 1x and persists in localStorage
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 2x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '2x');
            assert.equal(await page.evaluate(() => window.localStorage.getItem('high_roller_turn_speed')), '2x');

            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 4x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '4x');
            assert.equal(await page.evaluate(() => window.localStorage.getItem('high_roller_turn_speed')), '4x');

            // Reload and verify 4x persists
            await page.reload({ waitUntil: 'networkidle' });
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 4x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '4x');

            // Cycle back to 1x -> then 2x -> then 4x for fast turn playback check
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 1x');
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 2x');
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 4x');

            // 3. Verify 2x uses 0.5 (1000ms -> 500ms) and 4x uses 0.25 (1000ms -> 250ms) and 4x playback preserves clockwise decision order ['elon', 'tony', 'reginald', 'buck']
            await page.evaluate(() => {
              const delays: Array<{ ms: number; waitMs: number }> = [];
              (window as unknown as { __DELAY_LOG__: typeof delays }).__DELAY_LOG__ = delays;
              const origSetTimeout = window.setTimeout.bind(window);
              window.setTimeout = ((fn: TimerHandler, timeout?: number, ...args: unknown[]) => {
                if (typeof timeout === 'number' && timeout > 50) {
                  delays.push({ ms: timeout, waitMs: timeout });
                }
                return origSetTimeout(fn, timeout, ...args);
              }) as typeof window.setTimeout;

              const order: string[] = [];
              (window as unknown as { __SPEED_ORDER__: string[] }).__SPEED_ORDER__ = order;
              const obs = new MutationObserver(() => {
                const thinking = document.querySelector('.character-container.is-thinking');
                const id = thinking?.getAttribute('data-opp-id') || '';
                if (id && order[order.length - 1] !== id) {
                  order.push(id);
                }
              });
              obs.observe(document.querySelector('.table-scene')!, {
                attributes: true,
                subtree: true,
                attributeFilter: ['class'],
              });
              (window as unknown as { __SPEED_OBS__: MutationObserver }).__SPEED_OBS__ = obs;
            });

            const start4x = Date.now();
            await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await waitForPromptReady(page, 'Flop');
            const elapsed4x = Date.now() - start4x;

            const { order4x, delays4x } = await page.evaluate(() => {
              (window as unknown as { __SPEED_OBS__: MutationObserver }).__SPEED_OBS__.disconnect();
              return {
                order4x: (window as unknown as { __SPEED_ORDER__: string[] }).__SPEED_ORDER__,
                delays4x: (window as unknown as { __DELAY_LOG__: Array<{ ms: number; waitMs: number }> }).__DELAY_LOG__,
              };
            });

            // At 4x (0.25 multiplier): 350ms -> 88ms, 450ms -> 113ms, 650ms -> 163ms, 1100..1900ms -> 275..475ms
            assert.ok(delays4x.some((d) => d.waitMs === Math.round(350 * 0.25)), 'Expected 4x multiplier (0.25) on 350ms delay -> 88ms');
            assert.ok(delays4x.some((d) => d.waitMs === Math.round(650 * 0.25)), 'Expected 4x multiplier (0.25) on 650ms delay -> 163ms');
            // Pre-flop UTG (elon) -> CO (tony), then after Call: SB (reginald) -> BB (buck), then Flop SB..CO
            assert.deepEqual(order4x.slice(0, 4), ['elon', 'tony', 'reginald', 'buck']);
            assert.ok(elapsed4x < 6500, `Expected 4x playback across Pre-flop + Flop to finish under 6500ms, took ${elapsed4x}ms`);
            assert.equal((await page.locator('#street-banner').textContent())?.trim(), 'FLOP');
            assert.equal(await page.locator('#community-cards-container .card').count(), 3);
            assert.equal((await page.locator('#pot-amount').textContent())?.trim(), '$50');

            // 4. Switch to 1x speed with sound enabled (🔊) and verify clicking #skip-playback-btn during playback fast-forwards remaining turns in order AND suppresses transient oscillator starts for skipped events
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 1x');
            assert.equal((await page.locator('#sound-icon').textContent())?.trim(), '🔊');

            await page.evaluate(() => {
              let oscStartCount = 0;
              (window as unknown as { __OSC_STARTS__: () => number; __RESET_OSC_STARTS__: () => void }).__OSC_STARTS__ =
                () => oscStartCount;
              (
                window as unknown as { __OSC_STARTS__: () => number; __RESET_OSC_STARTS__: () => void }
              ).__RESET_OSC_STARTS__ = () => {
                oscStartCount = 0;
              };
              const origStart = OscillatorNode.prototype.start;
              if (!(OscillatorNode.prototype as unknown as { __hooked__?: boolean }).__hooked__) {
                (OscillatorNode.prototype as unknown as { __hooked__?: boolean }).__hooked__ = true;
                OscillatorNode.prototype.start = function (...args: [number?]) {
                  oscStartCount += 1;
                  return origStart.apply(this, args);
                };
              }

              const decisionBadges: Array<{ id: string; badge: string }> = [];
              (window as unknown as { __SKIP_DECISIONS__: typeof decisionBadges }).__SKIP_DECISIONS__ = decisionBadges;
              const obs = new MutationObserver((mutations) => {
                for (const m of mutations) {
                  const target = m.target as HTMLElement;
                  if (target && target.id && target.id.startsWith('opp-action-')) {
                    const id = target.id.replace('opp-action-', '');
                    const txt = target.textContent?.trim() || '';
                    if (txt && txt !== 'Thinking...') {
                      if (
                        decisionBadges.length === 0 ||
                        decisionBadges[decisionBadges.length - 1]!.id !== id ||
                        decisionBadges[decisionBadges.length - 1]!.badge !== txt
                      ) {
                        decisionBadges.push({ id, badge: txt });
                      }
                    }
                  }
                }
              });
              obs.observe(document.querySelector('.table-scene')!, {
                childList: true,
                characterData: true,
                subtree: true,
              });
              (window as unknown as { __SKIP_OBS__: MutationObserver }).__SKIP_OBS__ = obs;
            });

            // Bet $20 on Flop -> queues all 4 opponents clockwise ['reginald', 'buck', 'elon', 'tony'] and deals Turn
            const skipStart = Date.now();
            await page.locator('#action-buttons-group button[data-choice-id="bet"]').click();
            const skipBtn = page.locator('#skip-playback-btn');
            await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
            // Reset oscillator start counter immediately before clicking Skip Playback
            await page.evaluate(() => {
              (window as unknown as { __RESET_OSC_STARTS__: () => void }).__RESET_OSC_STARTS__();
            });
            await skipBtn.click();
            await waitForPromptReady(page, 'Turn');
            const skipElapsed = Date.now() - skipStart;

            const { skipDecisions, oscStartsDuringFlopSkip } = await page.evaluate(() => {
              (window as unknown as { __SKIP_OBS__: MutationObserver }).__SKIP_OBS__.disconnect();
              return {
                skipDecisions: (window as unknown as { __SKIP_DECISIONS__: Array<{ id: string; badge: string }> })
                  .__SKIP_DECISIONS__,
                oscStartsDuringFlopSkip: (window as unknown as { __OSC_STARTS__: () => number }).__OSC_STARTS__(),
              };
            });

            assert.ok(skipElapsed < 1500, `Expected clicking Skip Playback to complete remaining turns in <1500ms, took ${skipElapsed}ms`);
            assert.equal(
              oscStartsDuringFlopSkip,
              0,
              `Expected zero transient oscillator starts for skipped events after clicking Skip Playback on Flop, got ${oscStartsDuringFlopSkip}`,
            );
            assert.equal(await skipBtn.isHidden(), true, 'Skip Playback button must hide once player prompt is ready');
            // Calling Flop bet in clockwise order ['reginald', 'buck', 'elon', 'tony'] followed by Turn checks ['reginald', 'buck', 'elon', 'tony']
            assert.deepEqual(
              skipDecisions.slice(0, 4).map((d) => d.id),
              ['reginald', 'buck', 'elon', 'tony'],
            );
            assert.equal((await page.locator('#street-banner').textContent())?.trim(), 'TURN');
            assert.equal(await page.locator('#community-cards-container .card').count(), 4);
            assert.equal((await page.locator('#pot-amount').textContent())?.trim(), '$150');

            // 5. Bet $30 on Turn, focus #sound-toggle (another control), and press 's' hotkey during playback while Reginald folds -> leaves focus on #sound-toggle and reveals Reginald's folded cards immediately with zero oscillator starts
            turnRngQueue.push(0.05);
            await page.locator('#action-buttons-group button[data-choice-id="bet"]').click();
            await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
            await page.locator('#sound-toggle').focus();
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'sound-toggle');
            await page.evaluate(() => {
              (window as unknown as { __RESET_OSC_STARTS__: () => void }).__RESET_OSC_STARTS__();
            });
            await page.keyboard.press('s');
            await waitForPromptReady(page, 'River');
            assert.equal(
              await page.evaluate(() => document.activeElement?.id),
              'sound-toggle',
              'Pressing S shortcut from another focused control must leave focus where it was',
            );
            const oscStartsDuringTurnSkip = await page.evaluate(() =>
              (window as unknown as { __OSC_STARTS__: () => number }).__OSC_STARTS__(),
            );
            assert.equal(
              oscStartsDuringTurnSkip,
              0,
              `Expected zero transient oscillator starts during Turn hotkey Skip Playback, got ${oscStartsDuringTurnSkip}`,
            );
            assert.equal((await page.locator('#street-banner').textContent())?.trim(), 'RIVER');
            assert.equal(await page.locator('#community-cards-container .card').count(), 5);
            assert.equal(
              await page.locator('#opp-cards-container-reginald .card:not(.card-back)').count(),
              2,
              'Folded opponent cards must be revealed face-up even when Skip Playback fast-forwards',
            );

            // 6. Finish Hand #1, start Hand #2 at 1x with sound enabled, call pre-flop at a 5-seat table, focus #skip-playback-btn and press Enter -> moves focus to the first enabled Flop action button with zero transient oscillator starts
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await waitForPromptReady(page, 'Play another hand?');
            await page.locator('#action-buttons-group button[data-choice-id="yes"]').click();
            await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
            await skipBtn.click();
            await waitForPromptReady(page, 'Pre-flop');
            await page.locator('#action-buttons-group button[data-choice-id="call"]').click();
            await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
            await skipBtn.focus();
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'skip-playback-btn');
            await page.evaluate(() => {
              (window as unknown as { __RESET_OSC_STARTS__: () => void }).__RESET_OSC_STARTS__();
            });
            await page.keyboard.press('Enter');
            await waitForPromptReady(page, 'Flop');
            const focusAfterEnterSkip = await page.evaluate(() => {
              const active = document.activeElement as HTMLElement | null;
              const firstEnabledAction = document.querySelector(
                '#action-buttons-group button:not(:disabled)',
              ) as HTMLElement | null;
              return {
                matchesFirstAction: Boolean(active && active === firstEnabledAction),
                choiceId: active?.getAttribute('data-choice-id') || '',
              };
            });
            assert.equal(
              focusAfterEnterSkip.matchesFirstAction,
              true,
              'Activating focused Skip Playback button via Enter must move focus to the first enabled action button when Skip hides',
            );
            assert.equal(focusAfterEnterSkip.choiceId, 'check');
            const oscStartsPreFlopCallSkip = await page.evaluate(() =>
              (window as unknown as { __OSC_STARTS__: () => number }).__OSC_STARTS__(),
            );
            assert.equal(
              oscStartsPreFlopCallSkip,
              0,
              `Expected zero transient oscillator starts when skipping after calling Pre-flop at 1x with sound enabled, got ${oscStartsPreFlopCallSkip}`,
            );
            assert.equal((await page.locator('#street-banner').textContent())?.trim(), 'FLOP');
            assert.equal(await page.locator('#community-cards-container .card').count(), 3);

            // 7. Opening with ?turnSpeed=4x displays the effective 4x speed on #speed-toggle-btn, and cycling the speed button to 2x replaces the URL override so the initial 350ms playback delay schedules at 175ms (2x) rather than 88ms (4x)
            await page.goto(`${baseUrl}/?turnSpeed=4x`, { waitUntil: 'networkidle' });
            await waitForPromptReady(page, 'Flop');
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 4x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '4x');

            // Cycle 4x -> 1x -> 2x
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 1x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '1x');
            await speedBtn.click();
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 2x');
            assert.equal(await speedBtn.getAttribute('data-speed'), '2x');

            await page.evaluate(() => {
              const scheduled: number[] = [];
              (window as unknown as { __OVERRIDE_DELAYS__: number[] }).__OVERRIDE_DELAYS__ = scheduled;
              const origSetTimeout = window.setTimeout.bind(window);
              window.setTimeout = ((fn: TimerHandler, timeout?: number, ...args: unknown[]) => {
                if (typeof timeout === 'number' && timeout > 50) {
                  scheduled.push(timeout);
                }
                return origSetTimeout(fn, timeout, ...args);
              }) as typeof window.setTimeout;
            });

            // On Hand #2 Player is CO, so checking on Flop triggers BTN (reginald) to act and schedules the initial 350ms delay at 2x (175ms)
            await page.locator('#action-buttons-group button[data-choice-id="check"]').click();
            await skipBtn.waitFor({ state: 'visible', timeout: 3000 });
            await skipBtn.click();
            await waitForPromptReady(page, 'Turn');
            const overrideDelays = await page.evaluate(
              () => (window as unknown as { __OVERRIDE_DELAYS__: number[] }).__OVERRIDE_DELAYS__,
            );
            assert.ok(
              overrideDelays.includes(175),
              `Expected cycling from ?turnSpeed=4x to 2x to schedule the 350ms delay at 175ms (2x), got: ${JSON.stringify(overrideDelays)}`,
            );
            assert.equal(
              overrideDelays.includes(88),
              false,
              `Expected 4x delay (88ms) to be replaced once user selects 2x, got: ${JSON.stringify(overrideDelays)}`,
            );

            // 8. Custom numeric delay multipliers display their reciprocal playback speed (0.75 -> 1.33x) and 0 displays Instant
            await page.goto(`${baseUrl}/?turnSpeed=0.75`, { waitUntil: 'networkidle' });
            await waitForPromptReady(page, 'Turn');
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: 1.33x');
            assert.equal(await speedBtn.getAttribute('data-speed'), 'custom');

            await page.goto(`${baseUrl}/?turnSpeed=0`, { waitUntil: 'networkidle' });
            await waitForPromptReady(page, 'Turn');
            assert.equal((await speedBtn.textContent())?.trim(), '⚡ Speed: Instant');
            assert.equal(await speedBtn.getAttribute('data-speed'), 'instant');
          },
          {
            // No turnSpeed option here so we test the real default 1x and header speed toggle!
            engineOptions: {
              initialButtonSeatIndex: 0,
              random: () => (turnRngQueue.length > 0 ? turnRngQueue.shift()! : 0.5),
              deckFactory: makePlaybackTestDeck,
            },
          },
        );
      });

      // ----------------------------------------------------------------------
      // TEST 16: Issue #27 — Fixed-Limit Felt Copy & Pre-Deal Rules Cue at Desktop and Narrow Widths
      // ----------------------------------------------------------------------
      for (const vp of [
        { width: 1280, height: 800 },
        { width: 360, height: 740 },
      ]) {
        await t.test(
          `felt copy and pre-deal fixed-limit rules cue are accurate and visible at ${vp.width}x${vp.height}`,
          async () => {
            await withGamePage(
              async ({ page }) => {
                // 1. Felt subtitle reflects Fixed-Limit rules (never "NO LIMIT")
                const feltSub = (await page.locator('.table-center-logo .logo-sub').textContent())?.trim() || '';
                assert.equal(feltSub, 'FIXED-LIMIT CASINO LOUNGE');
                assert.doesNotMatch(feltSub, /NO LIMIT/i);

                // 2. Opponent picker dialog shows the fixed-limit rules cue before the first deal
                const modalCue = await page.evaluate(() => {
                  const el = document.getElementById('modal-rules-cue');
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return {
                    text: el.textContent?.trim() || '',
                    visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
                    left: r.left,
                    right: r.right,
                    vw: window.innerWidth,
                  };
                });
                assert.ok(modalCue && modalCue.visible, `Expected #modal-rules-cue visible at ${vp.width}x${vp.height}`);
                assert.ok(modalCue.left >= 0 && modalCue.right <= modalCue.vw + 1);
                assert.match(modalCue.text, /\$5\/\$10 blinds/);
                assert.match(modalCue.text, /\$10 Pre-flop \/ \$20 Flop \/ \$30 Turn \/ \$40 River/);
                assert.match(modalCue.text, /One bet or raise per street/);

                // 3. After choosing opponents (select_mode, still before first deal), #predeal-rules-cue is visible and unclipped
                await page.locator('#btn-random-opponents').click();
                await page.waitForSelector('dialog#opponent-modal-overlay', { state: 'hidden' });
                await waitForPromptReady(page, 'Choose table difficulty:');

                const predealCue = await page.evaluate(() => {
                  const el = document.getElementById('predeal-rules-cue');
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return {
                    text: el.textContent?.trim() || '',
                    hidden: el.hidden,
                    visible: r.width > 0 && r.height > 0,
                    left: r.left,
                    right: r.right,
                    vw: window.innerWidth,
                  };
                });
                assert.ok(predealCue && !predealCue.hidden && predealCue.visible);
                assert.ok(predealCue.left >= 0 && predealCue.right <= predealCue.vw + 1);
                assert.match(predealCue.text, /\$5\/\$10 blinds/);
                assert.match(predealCue.text, /\$10 Pre-flop \/ \$20 Flop \/ \$30 Turn \/ \$40 River/);
                assert.match(predealCue.text, /One bet or raise per street/);

                // 4. Once Hand 1 is dealt, #predeal-rules-cue hides cleanly
                await page.locator('#action-buttons-group button', { hasText: 'Easy' }).click();
                await waitForPromptReady(page, 'Pre-flop');
                assert.equal(await page.locator('#predeal-rules-cue').isHidden(), true);
              },
              {
                turnSpeed: 0.02,
                viewport: vp,
                engineOptions: { random: () => 0.5 },
              },
            );
          },
        );
      }
    } finally {
      await browser.close();
    }
  },
);
