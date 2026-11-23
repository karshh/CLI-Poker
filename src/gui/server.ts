import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PokerGameEngine, StaleStateError, type PokerGameEngineOptions } from './engine.js';

const LOOPBACK_HOST = '127.0.0.1';
const MAX_ACTION_BODY_BYTES = 1024;
const CONTROL_OR_SPACE_RE = /[\x00-\x20\x7f]/;
const LOOPBACK_AUTHORITY_RE = /^127\.0\.0\.1:(\d{1,5})$/;

interface BundledAsset {
  file: string;
  contentType: string;
  isHtml: boolean;
}

const ALLOWED_STATIC_ASSETS: Readonly<Record<string, BundledAsset>> = {
  '/': { file: 'index.html', contentType: 'text/html; charset=utf-8', isHtml: true },
  '/index.html': { file: 'index.html', contentType: 'text/html; charset=utf-8', isHtml: true },
  '/game.js': { file: 'game.js', contentType: 'application/javascript; charset=utf-8', isHtml: false },
  '/ads.js': { file: 'ads.js', contentType: 'application/javascript; charset=utf-8', isHtml: false },
  '/style.css': { file: 'style.css', contentType: 'text/css; charset=utf-8', isHtml: false },
};

const ADSENSE_CLIENT_ID_RE = /^ca-pub-\d{10,20}$/;
const ADSENSE_SLOT_ID_RE = /^\d{6,20}$/;

export interface AdSlotIds {
  side: string | null;
  bottom: string | null;
}

export interface AdConfigOptions {
  enabled?: boolean;
  clientId?: string | null;
  slotSide?: string | null;
  slotBottom?: string | null;
  adsTxtContent?: string | null;
}

export interface ResolvedAdConfig {
  enabled: boolean;
  provider: 'mock' | 'adsense' | 'disabled';
  clientId: string | null;
  slots: AdSlotIds;
  adsTxtContent: string | null;
}

export function resolveAdConfig(
  options: AdConfigOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  isLoopbackHost = true,
): ResolvedAdConfig {
  const envEnabledRaw = env['ADS_ENABLED']?.trim().toLowerCase();
  const enabledFromEnv =
    envEnabledRaw === undefined ? undefined : envEnabledRaw !== 'false' && envEnabledRaw !== '0' && envEnabledRaw !== 'off';
  const enabled = options.enabled ?? enabledFromEnv ?? true;

  const rawAdsTxt = (options.adsTxtContent ?? env['ADS_TXT_CONTENT'] ?? '').trim();
  const adsTxtContent = rawAdsTxt.length > 0 ? rawAdsTxt : null;

  if (!enabled) {
    return {
      enabled: false,
      provider: 'disabled',
      clientId: null,
      slots: { side: null, bottom: null },
      adsTxtContent,
    };
  }

  // On loopback (127.0.0.1 / localhost), always serve non-intrusive random mock ads
  // so local gameplay and automated tests make zero external ad-network calls.
  if (isLoopbackHost) {
    return {
      enabled: true,
      provider: 'mock',
      clientId: null,
      slots: { side: null, bottom: null },
      adsTxtContent,
    };
  }

  const rawClient = (options.clientId ?? env['ADSENSE_CLIENT_ID'] ?? '').trim();
  const rawSide = (options.slotSide ?? env['ADSENSE_SLOT_SIDE'] ?? '').trim();
  const rawBottom = (options.slotBottom ?? env['ADSENSE_SLOT_BOTTOM'] ?? '').trim();

  const validClient = ADSENSE_CLIENT_ID_RE.test(rawClient) ? rawClient : null;
  const validSide = ADSENSE_SLOT_ID_RE.test(rawSide) ? rawSide : null;
  const validBottom = ADSENSE_SLOT_ID_RE.test(rawBottom) ? rawBottom : null;

  if (validClient && (validSide || validBottom)) {
    return {
      enabled: true,
      provider: 'adsense',
      clientId: validClient,
      slots: { side: validSide, bottom: validBottom },
      adsTxtContent,
    };
  }

  return {
    enabled: true,
    provider: 'mock',
    clientId: null,
    slots: { side: null, bottom: null },
    adsTxtContent,
  };
}

export function findPublicDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  // Trusted, module-relative locations only (never derived from process.cwd())
  const candidates = [
    path.join(currentDir, 'public'),
    path.resolve(currentDir, '..', '..', '..', 'src', 'gui', 'public'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return fs.realpathSync(candidate);
      }
    } catch {
      // Try next trusted candidate
    }
  }

  return path.join(currentDir, 'public');
}

export interface PokerRequestHandlerOptions {
  /** Returns the actual bound TCP port once listening (enforces exact Host/Origin authority). */
  getBoundPort?: () => number | null;
  /** Optional AdSense / mock ad configuration overrides. */
  adConfig?: AdConfigOptions;
}

function validateHostAuthority(
  hostHeader: string | undefined,
  boundPort: number | null,
): string | null {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) {
    return null;
  }
  const normalized = hostHeader.trim().toLowerCase();
  if (boundPort !== null) {
    const expected = `${LOOPBACK_HOST}:${boundPort}`;
    return normalized === expected ? expected : null;
  }
  const match = LOOPBACK_AUTHORITY_RE.exec(normalized);
  if (!match) return null;
  const parsedPort = Number(match[1]);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return null;
  }
  return normalized;
}

function parseOriginFormTarget(rawUrl: string | undefined): URL | null {
  const target = rawUrl ?? '/';
  if (
    target.length === 0 ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    CONTROL_OR_SPACE_RE.test(target)
  ) {
    return null;
  }
  try {
    const parsed = new URL(target, `http://${LOOPBACK_HOST}`);
    if (parsed.origin !== `http://${LOOPBACK_HOST}`) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isFetchSiteAllowed(req: http.IncomingMessage, isStateChange: boolean): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite !== 'string' || fetchSite.length === 0) {
    return true;
  }
  const normalized = fetchSite.trim().toLowerCase();
  if (isStateChange) {
    return normalized === 'same-origin' || normalized === 'none';
  }
  return normalized !== 'cross-site';
}

function isJsonContentType(contentTypeHeader: string | undefined): boolean {
  if (typeof contentTypeHeader !== 'string') return false;
  const mediaType = contentTypeHeader.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function resolveBundledAssetPath(publicDir: string, filename: string): string | null {
  try {
    const realPublicDir = fs.realpathSync(publicDir);
    const candidatePath = path.join(realPublicDir, filename);
    const lstat = fs.lstatSync(candidatePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      return null;
    }
    const realTarget = fs.realpathSync(candidatePath);
    if (!realTarget.startsWith(realPublicDir + path.sep)) {
      return null;
    }
    return realTarget;
  } catch {
    return null;
  }
}

export interface PokerServerInstance {
  server: http.Server;
  engine: PokerGameEngine;
  port: number;
  host: string;
  close(): Promise<void>;
}

export function createPokerRequestHandler(
  engine: PokerGameEngine,
  publicDir: string = findPublicDir(),
  options: PokerRequestHandlerOptions = {},
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    // 1. Validate Host header against configured loopback authority & actual bound port
    //    before serving HTML, static assets, or API responses (blocks DNS rebinding).
    const boundPort = options.getBoundPort ? options.getBoundPort() : null;
    const authority = validateHostAuthority(req.headers.host, boundPort);
    if (!authority) {
      sendJson(res, 403, { error: 'Forbidden: invalid Host header.' });
      return;
    }

    // 2. Parse origin-form request target against a fixed base without trusting Host.
    const parsedUrl = parseOriginFormTarget(req.url);
    if (!parsedUrl) {
      sendJson(res, 400, { error: 'Malformed request URL.' });
      return;
    }

    const pathname = parsedUrl.pathname;
    const expectedOrigin = `http://${authority}`;

    // 3. API endpoints (same-origin loopback only, no wildcard CORS)
    if (pathname.startsWith('/api/')) {
      const isStateChange = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';

      if (!isFetchSiteAllowed(req, isStateChange)) {
        sendJson(res, 403, { error: 'Cross-site requests are not permitted.' });
        return;
      }

      const originHeader = req.headers.origin;
      if (isStateChange) {
        // State-changing requests require the exact configured Origin and application/json
        if (typeof originHeader !== 'string' || originHeader.trim().toLowerCase() !== expectedOrigin) {
          sendJson(res, 403, { error: 'Cross-origin or missing Origin header on state change.' });
          return;
        }
        if (!isJsonContentType(req.headers['content-type'])) {
          sendJson(res, 415, { error: 'Content-Type must be application/json.' });
          return;
        }
      } else if (typeof originHeader === 'string' && originHeader.length > 0) {
        // Missing Origin on state reads is normal; if supplied, it must match exactly
        if (originHeader.trim().toLowerCase() !== expectedOrigin) {
          sendJson(res, 403, { error: 'Cross-origin requests are not permitted.' });
          return;
        }
      }

      if (req.method === 'OPTIONS') {
        sendJson(res, 403, { error: 'CORS preflight is not permitted.' });
        return;
      }

      // API: GET /api/state
      if (req.method === 'GET' && pathname === '/api/state') {
        sendJson(res, 200, engine.getState());
        return;
      }

      // API: GET /api/ad-config
      if (req.method === 'GET' && pathname === '/api/ad-config') {
        const resolved = resolveAdConfig(options.adConfig, process.env, true);
        sendJson(res, 200, {
          enabled: resolved.enabled,
          provider: resolved.provider,
          clientId: resolved.clientId,
          slots: resolved.slots,
        });
        return;
      }

      // API: POST /api/action (with strict streaming byte cap before buffering/parsing)
      if (req.method === 'POST' && pathname === '/api/action') {
        const declaredLength = req.headers['content-length'];
        if (typeof declaredLength === 'string') {
          const parsedLen = Number(declaredLength);
          if (Number.isFinite(parsedLen) && parsedLen > MAX_ACTION_BODY_BYTES) {
            sendJson(res, 413, { error: `Request body exceeds ${MAX_ACTION_BODY_BYTES} byte limit.` });
            req.resume();
            return;
          }
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let rejected = false;

        req.on('error', () => {
          rejected = true;
          chunks.length = 0;
        });

        req.on('data', (chunk: Buffer | string) => {
          if (rejected) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          if (totalBytes > MAX_ACTION_BODY_BYTES) {
            rejected = true;
            chunks.length = 0;
            if (!res.headersSent) {
              sendJson(res, 413, { error: `Request body exceeds ${MAX_ACTION_BODY_BYTES} byte limit.` });
            }
            req.resume();
            return;
          }
          chunks.push(buf);
        });

        req.on('end', () => {
          if (rejected || res.headersSent) return;
          try {
            const rawBody = Buffer.concat(chunks, totalBytes).toString('utf8');
            const data = JSON.parse(rawBody || '{}') as {
              action?: unknown;
              stateRevision?: unknown;
              tableInstanceId?: unknown;
            };
            if (typeof data.action !== 'string') {
              sendJson(res, 400, { error: 'Missing action string in body' });
              return;
            }
            let expectedRevision: number | undefined;
            if (data.stateRevision !== undefined) {
              if (
                typeof data.stateRevision !== 'number' ||
                !Number.isInteger(data.stateRevision) ||
                data.stateRevision < 1
              ) {
                sendJson(res, 400, { error: 'Invalid stateRevision in body' });
                return;
              }
              expectedRevision = data.stateRevision;
            }
            let expectedInstanceId: string | undefined;
            if (data.tableInstanceId !== undefined) {
              if (typeof data.tableInstanceId !== 'string' || data.tableInstanceId.trim().length === 0) {
                sendJson(res, 400, { error: 'Invalid tableInstanceId in body' });
                return;
              }
              expectedInstanceId = data.tableInstanceId;
            }
            const newState = engine.act(data.action, expectedRevision, expectedInstanceId);
            sendJson(res, 200, newState);
          } catch (err) {
            if (err instanceof StaleStateError) {
              sendJson(res, 409, {
                error: err.message,
                code: err.code,
                state: engine.getState(),
              });
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            sendJson(res, 400, { error: message });
          }
        });
        return;
      }

      // API: POST /api/reset
      if (req.method === 'POST' && pathname === '/api/reset') {
        sendJson(res, 200, engine.getState());
        return;
      }

      sendJson(res, 404, { error: 'Unknown API endpoint' });
      return;
    }

    // 4. Static file serving — strictly allowlisted to the bundled GUI assets (and optional /ads.txt),
    //    rejecting symlinks and outside targets, with clickjacking CSP on HTML.
    if (req.method === 'GET') {
      if (pathname === '/ads.txt') {
        const resolved = resolveAdConfig(options.adConfig, process.env, true);
        if (resolved.adsTxtContent) {
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(`${resolved.adsTxtContent}\n`);
          return;
        }
      }

      const asset = ALLOWED_STATIC_ASSETS[pathname];
      if (asset) {
        const safePath = resolveBundledAssetPath(publicDir, asset.file);
        if (safePath) {
          const headers: Record<string, string> = {
            'Content-Type': asset.contentType,
            'X-Content-Type-Options': 'nosniff',
          };
          if (asset.isHtml) {
            headers['Content-Security-Policy'] = "frame-ancestors 'none'";
            headers['X-Frame-Options'] = 'DENY';
          }
          res.writeHead(200, headers);
          const stream = fs.createReadStream(safePath);
          stream.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            }
            res.end();
          });
          stream.pipe(res);
          return;
        }
      }
    }

    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end('Not Found');
  };
}

export function createPokerServer(
  engine: PokerGameEngine = new PokerGameEngine(),
  publicDir: string = findPublicDir(),
  options: PokerRequestHandlerOptions = {},
): http.Server {
  const handler = createPokerRequestHandler(engine, publicDir, options);
  return http.createServer(handler);
}

export async function startServer(
  preferredPort = 3000,
  publicDir: string = findPublicDir(),
  engineOptions?: PokerGameEngineOptions,
): Promise<PokerServerInstance> {
  const engine = new PokerGameEngine(engineOptions);
  let boundPort: number | null = null;
  const server = createPokerServer(engine, publicDir, {
    getBoundPort: () => boundPort,
  });

  let candidatePort = preferredPort;
  const maxAttempts = preferredPort === 0 ? 1 : 10;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      boundPort = await new Promise<number>((resolve, reject) => {
        const onError = (err: Error) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            resolve(addr.port);
          } else {
            resolve(candidatePort);
          }
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidatePort, LOOPBACK_HOST);
      });
      break;
    } catch (err: unknown) {
      lastError = err;
      if (
        preferredPort !== 0 &&
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === 'EADDRINUSE'
      ) {
        candidatePort += 1;
      } else {
        throw err;
      }
    }
  }

  if (boundPort === null || !server.listening) {
    throw new Error(
      `Failed to bind poker GUI server on ${LOOPBACK_HOST} after ${maxAttempts} attempt(s) starting at port ${preferredPort}.`,
      { cause: lastError },
    );
  }

  return {
    server,
    engine,
    port: boundPort,
    host: LOOPBACK_HOST,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
