// A small local static server for the landing scripts (check-landing.mjs serves dist/, record-landing.mjs serves the
// repository so /prototype/ resolves). Directory → index.html; clean URLs (/docs/product → /docs/product.html) like
// the deployed site; text responses gzip-compressed when asked, so transfer sizes are close to production.
// Only Node built-ins; binds to 127.0.0.1 on a free port unless one is given.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createGzip } from 'node:zlib';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const TEXT = /^(?:text\/|application\/json|image\/svg)/;

export function serve(dir, { port = 0, notFound = '404.html' } = {}) {
  const root = path.resolve(dir);
  const resolve = pathname => {
    const target = path.join(root, decodeURIComponent(pathname));
    if (!target.startsWith(root)) return null;
    for (const candidate of [target, `${target}.html`, path.join(target, 'index.html')]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://local');
    let file = resolve(url.pathname);
    let status = 200;
    if (!file) { file = resolve(`/${notFound}`); status = 404; }
    if (!file) { response.writeHead(404).end('not found'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const size = statSync(file).size;
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && type === 'video/mp4') {
      // Videos are fetched in ranges by browsers.
      const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : size - 1;
      response.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    if (TEXT.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
      response.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
      createReadStream(file).pipe(createGzip({ level: 9 })).pipe(response);
      return;
    }
    response.writeHead(status, { ...headers, 'Content-Length': size, ...(type === 'video/mp4' ? { 'Accept-Ranges': 'bytes' } : {}) });
    createReadStream(file).pipe(response);
  });
  return new Promise(done => server.listen(port, '127.0.0.1', () => done({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })));
}
