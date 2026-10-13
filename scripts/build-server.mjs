// Bundles the server and CLI into single files under dist/ so the plugin
// runs without `npm install`.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'warning',
  legalComments: 'none',
  // CJS dependencies need require() inside an ESM bundle
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  external: ['bufferutil', 'utf-8-validate', '@napi-rs/canvas', 'canvas'],
};

await build({ ...common, entryPoints: ['packages/server/src/index.ts'], outfile: 'dist/server.mjs' });
await build({ ...common, entryPoints: ['packages/cli/src/index.ts'], outfile: 'dist/cli.mjs', banner: { js: '#!/usr/bin/env node\n' + common.banner.js } });

const pdfjsDir = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
copyFileSync(pdfjsDir + 'legacy/build/pdf.worker.mjs', 'dist/pdf.worker.mjs');
console.log('built dist/server.mjs, dist/cli.mjs');
