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

export function findPublicDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);

  const candidates = [
    path.join(currentDir, 'public'),
    path.join(process.cwd(), 'src', 'gui', 'public'),
    path.join(process.cwd(), 'dist', 'src', 'gui', 'public'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return path.join(currentDir, 'public');
}

export interface PokerServerInstance {
  server: http.Server;
  engine: PokerGameEngine;
  port: number;
  close(): Promise<void>;
}

export function createPokerRequestHandler(
  engine: PokerGameEngine,
  publicDir: string = findPublicDir(),
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => {
    // Enable CORS for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

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
          const data = JSON.parse(body || '{}');
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

    // Static file serving
    if (req.method === 'GET') {
      let filePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
      const absolutePath = path.join(publicDir, filePath);

      if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(absolutePath);
        stream.pipe(res);
        return;
      }

      // Fallback
      const indexPath = path.join(publicDir, 'index.html');
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

export function createPokerServer(engine: PokerGameEngine = new PokerGameEngine()): http.Server {
  const handler = createPokerRequestHandler(engine);
  return http.createServer(handler);
}

export async function startServer(preferredPort = 3000): Promise<PokerServerInstance> {
  const engine = new PokerGameEngine();
  const server = createPokerServer(engine);

  let port = preferredPort;
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      break;
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'EADDRINUSE') {
        port += 1;
      } else {
        throw err;
      }
    }
  }

  return {
    server,
    engine,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
