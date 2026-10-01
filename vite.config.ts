import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv, Plugin} from 'vite';

/**
 * Serves the Vercel functions in /api during `npm run dev`, so local dev matches production.
 * Each api/<route>.ts exports GET/POST/PATCH/DELETE(request: Request): Promise<Response>.
 */
function vercelApiDev(): Plugin {
  return {
    name: 'notifyem-vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
        const file = [path.resolve(__dirname, 'api', `${route}.ts`), path.resolve(__dirname, 'api', route, 'index.ts')].find(
          f => !route.split('/').some(part => part.startsWith('_') || part === '..') && fs.existsSync(f)
        );
        if (!file) return next();

        try {
          const mod = await server.ssrLoadModule(file);
          const method = (req.method || 'GET').toUpperCase();
          const fn = mod[method];
          if (typeof fn !== 'function') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: `${method} not allowed` }));
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined || ['connection', 'content-length', 'transfer-encoding', 'host'].includes(key)) continue;
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          const request = new Request(`http://localhost${req.url}`, {
            method,
            headers,
            body: ['GET', 'HEAD'].includes(method) ? undefined : Buffer.concat(chunks)
          });
          const response: Response = await fn(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          server.config.logger.error(String(error instanceof Error ? error.stack : error));
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'API error' }));
        }
      });
    },
  };
}

export default defineConfig(({mode}) => {
  // Make .env / .env.local values (SUPABASE_URL, MLS_*, …) visible to the /api handlers in dev.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), tailwindcss(), vercelApiDev()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
