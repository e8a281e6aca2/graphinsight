#!/usr/bin/env node
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '../dist');

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  const inline = args.find((item) => item.startsWith(`${name}=`));
  if (inline) {
    return inline.slice(name.length + 1);
  }
  return fallback;
}

const host = argValue('--host', process.env.HOST || '0.0.0.0');
const port = Number(argValue('--port', process.env.PORT || '4173'));
const apiTarget = argValue('--api-target', process.env.API_TARGET || 'http://127.0.0.1:8081').replace(/\/+$/, '');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
]);

const compressibleTypes = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.xml',
]);

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function safeFilePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = resolve(distDir, `.${decoded}`);
  if (normalized !== distDir && !normalized.startsWith(`${distDir}${sep}`)) {
    return null;
  }
  return normalized;
}

function cacheControl(filePath) {
  const relative = filePath.slice(distDir.length + 1).replaceAll('\\', '/');
  if (relative.startsWith('assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
}

async function serveStatic(req, res) {
  if (!existsSync(distDir)) {
    sendText(res, 500, 'frontend/dist does not exist. Run npm run build first.\n');
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  let filePath = safeFilePath(url.pathname);
  if (!filePath) {
    sendText(res, 403, 'Forbidden\n');
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }

  const stat = statSync(filePath);
  const ext = extname(filePath);
  const contentType = mimeTypes.get(ext) || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl(filePath),
    'Last-Modified': stat.mtime.toUTCString(),
    Vary: 'Accept-Encoding',
  };

  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  const shouldGzip = acceptsGzip && compressibleTypes.has(ext) && stat.size > 1024;

  if (shouldGzip) {
    const raw = await readFile(filePath);
    const body = gzipSync(raw);
    res.writeHead(200, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': body.length,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': stat.size,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const targetUrl = new URL(req.url || '/', apiTarget);
  const transport = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = {
    ...req.headers,
    host: targetUrl.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'http',
  };

  const upstream = transport(
    targetUrl,
    {
      method: req.method,
      headers,
      timeout: 30000,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('upstream timeout'));
  });
  upstream.on('error', (error) => {
    if (!res.headersSent) {
      sendText(res, 502, `Bad gateway: ${error.message}\n`);
      return;
    }
    res.destroy(error);
  });

  req.pipe(upstream);
}

const server = createServer((req, res) => {
  if (!req.url) {
    sendText(res, 400, 'Bad request\n');
    return;
  }
  if (req.url.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
    sendText(res, 405, 'Method not allowed\n');
    return;
  }
  serveStatic(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendText(res, 500, 'Internal server error\n');
    } else {
      res.destroy(error);
    }
  });
});

server.listen(port, host, () => {
  console.log(`GraphInsight dist server listening on http://${host}:${port}`);
  console.log(`Proxying /api/* to ${apiTarget}`);
});
