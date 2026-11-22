// Local test server: serves public/ and runs the same API code Netlify will run.
// Data is saved in the .data folder (never committed). Start with: npm run dev
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';

process.env.CHQ_LOCAL = '1';
try { process.loadEnvFile('.env'); } catch { /* no .env file: Google Calendar stays unconfigured locally */ }
const { handle } = await import('./server/app.mjs');
const PORT = Number(process.env.PORT || 8788);
const ROOT = path.resolve('public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handle(new Request(url, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'x-robots-tag': 'noindex' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500);
    res.end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
}).listen(PORT, () => console.log(`Family HQ running at http://localhost:${PORT}`));
