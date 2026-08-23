import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
);

const ROUTES = new Map([
  ['/blockers.js', ['blockers.js', 'text/javascript; charset=utf-8']],
  ['/configured.html', ['blockers.html', 'text/html; charset=utf-8']],
  ['/unconfigured.html', ['blockers.html', 'text/html; charset=utf-8']],
  ['/navigation/configured.html', ['blockers.html', 'text/html; charset=utf-8']],
  ['/navigation/unconfigured.html', ['blockers.html', 'text/html; charset=utf-8']],
  ['/frame.html', ['frame.html', 'text/html; charset=utf-8']],
]);

export async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
    const route = ROUTES.get(pathname);
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    try {
      const [file, contentType] = route;
      const body = await readFile(path.join(FIXTURE_ROOT, file));
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-length': body.length,
        'content-type': contentType,
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    url(pathname) {
      return new URL(pathname, origin).href;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
