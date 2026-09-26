import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app';
import { createPool, migrate } from './db';
import { ensureAdmin, seedDemo } from './seed';

const db = createPool();
await migrate(db);
if (process.env.SEED_DEMO === 'true') await seedDemo(db);
await ensureAdmin(db);

const app = createApp(db);

// In production the built PWA sits next to this file (dist/client); in development Vite serves it.
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders(res, file) {
        const name = path.basename(file);
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (name === 'sw.js' || name.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/{*path}', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Lockedin listening on :${port}`));
