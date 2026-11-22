import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PokerGameEngine } from './engine.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const LOOPBACK_HOST = '127.0.0.1';

export function findPublicDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  const candidates = [
    path.join(currentDir, 'public'),
    path.join(process.cwd(), 'dist', 'src', 'gui', 'public'),
    path.join(process.cwd(), 'src', 'gui', 'public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return path.join(currentDir, 'public');
}

function isSameOriginRequest(req: http.IncomingMessage): boolean {
  const fetchSite = req.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite === 'cross-site') {
    return false;
  }

  const hostHeader = req.headers.host;
  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string' && originHeader.length > 0) {
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.protocol !== 'http:') return false;
      const isLoopbackOrigin =
        originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost' || originUrl.hostname === '[::1]';
      if (!isLoopbackOrigin) return false;
      if (hostHeader) {
        const expectedUrl = new URL(`http://${hostHeader}`);
        if (originUrl.port !== expectedUrl.port) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return true;
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
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? `${LOOPBACK_HOST}:3000`}`);
    const pathname = parsedUrl.pathname;

    // Restrict API endpoints to same-origin loopback requests only (no wildcard CORS)
    if (pathname.startsWith('/api/')) {
      if (!isSameOriginRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Cross-origin requests are not permitted.' }));
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // API: GET /api/state
      if (req.method === 'GET' && pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(engine.getState()));
        return;
      }

      // API: POST /api/action
      if (req.method === 'POST' && pathname === '/api/action') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}') as { action?: unknown };
            if (typeof data.action !== 'string') {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'Missing action string in body' }));
              return;
            }
            const newState = engine.act(data.action);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(newState));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: message }));
          }
        });
        return;
      }

      // API: POST /api/reset
      if (req.method === 'POST' && pathname === '/api/reset') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(engine.getState()));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
      return;
    }

    // Static file serving
    if (req.method === 'GET') {
      let filePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
      const absolutePath = path.join(publicDir, filePath);
      const resolvedPublic = path.resolve(publicDir);
      const resolvedTarget = path.resolve(absolutePath);

      if (
        resolvedTarget.startsWith(resolvedPublic + path.sep) &&
        fs.existsSync(resolvedTarget) &&
        fs.statSync(resolvedTarget).isFile()
      ) {
        const ext = path.extname(resolvedTarget).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(resolvedTarget);
        stream.pipe(res);
        return;
      }

      // Fallback to index.html for root/SPA paths
      const indexPath = path.join(resolvedPublic, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  };
}

export function createPokerServer(
  engine: PokerGameEngine = new PokerGameEngine(),
  publicDir: string = findPublicDir(),
): http.Server {
  const handler = createPokerRequestHandler(engine, publicDir);
  return http.createServer(handler);
}

export async function startServer(
  preferredPort = 3000,
  publicDir: string = findPublicDir(),
): Promise<PokerServerInstance> {
  const engine = new PokerGameEngine();
  const server = createPokerServer(engine, publicDir);

  let candidatePort = preferredPort;
  const maxAttempts = preferredPort === 0 ? 1 : 10;
  let boundPort: number | null = null;
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
