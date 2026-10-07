import fs from 'node:fs';
import path from 'node:path';
import { protocol } from 'electron';
import type { ModulesManager } from './modules-manager.js';

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        codeCache: true,
      },
    },
  ]);
}

export function setupAppProtocol(
  distDir: string,
  modulesManager: ModulesManager
): void {
  protocol.handle('app', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      let pathname = decodeURIComponent(parsedUrl.pathname);

      // Normalize root
      if (pathname === '' || pathname === '/') {
        pathname = '/index.html';
      }

      // 1. Check if it's a module mount (e.g. /modules/pymupdf/... or /libreoffice-wasm/...)
      const mountedFile = modulesManager.resolveMountedFile(pathname);
      if (mountedFile) {
        return serveFile(mountedFile);
      }

      // 2. Check dist directory
      const directPath = path.join(distDir, pathname);
      if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
        return serveFile(directPath);
      }

      // 3. Try clean URLs: /merge-pdf -> /merge-pdf.html
      const htmlCandidate = path.join(distDir, `${pathname}.html`);
      if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
        return serveFile(htmlCandidate);
      }

      // 4. Try i18n clean URLs: /vi/merge-pdf -> try /vi/merge-pdf.html, then fallback to /merge-pdf.html
      const langMatch = pathname.match(
        /^\/([a-z]{2}(?:-[A-Za-z]+)?)\/([a-z0-9-]+(?:\.html)?)$/
      );
      if (langMatch) {
        const [, lang, tool] = langMatch;
        const toolName = tool.endsWith('.html') ? tool : `${tool}.html`;
        const langPath = path.join(distDir, lang, toolName);
        if (fs.existsSync(langPath) && fs.statSync(langPath).isFile()) {
          return serveFile(langPath);
        }
        const fallbackPath = path.join(distDir, toolName);
        if (fs.existsSync(fallbackPath) && fs.statSync(fallbackPath).isFile()) {
          return serveFile(fallbackPath);
        }
      }

      // 5. Try language root: /vi/ -> /dist/vi/index.html or /dist/index.html
      const langRootMatch = pathname.match(/^\/([a-z]{2}(?:-[A-Za-z]+)?)\/?$/);
      if (langRootMatch) {
        const lang = langRootMatch[1];
        const langIndexPath = path.join(distDir, lang, 'index.html');
        if (
          fs.existsSync(langIndexPath) &&
          fs.statSync(langIndexPath).isFile()
        ) {
          return serveFile(langIndexPath);
        }
        const rootIndexPath = path.join(distDir, 'index.html');
        if (
          fs.existsSync(rootIndexPath) &&
          fs.statSync(rootIndexPath).isFile()
        ) {
          return serveFile(rootIndexPath);
        }
      }

      return new Response('Not Found', { status: 404 });
    } catch (err: unknown) {
      console.error('[Protocol] Error serving request:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

function serveFile(filePath: string): Response {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const headers = new Headers();
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('Access-Control-Allow-Origin', '*');

  // Specific handling for LibreOffice gz files
  if (filePath.endsWith('.wasm.gz')) {
    headers.set('Content-Type', 'application/wasm');
    headers.set('Content-Encoding', 'gzip');
    headers.set('Vary', 'Accept-Encoding');
  } else if (filePath.endsWith('.data.gz')) {
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Encoding', 'gzip');
    headers.set('Vary', 'Accept-Encoding');
  } else {
    headers.set('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
  }

  return new Response(data, {
    status: 200,
    headers,
  });
}
