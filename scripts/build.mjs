import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir } from 'node:fs/promises';
await mkdir('dist-electron', { recursive: true });
await viteBuild();
await build({ entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'], sourcemap: true });
await build({ entryPoints: ['src/main/preload.ts'], outfile: 'dist-electron/preload.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['electron'] });
