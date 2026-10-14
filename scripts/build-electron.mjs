import { build } from 'esbuild';
export const options = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/mtp-worker.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
  external: ['electron', 'koffi', 'usb'],
};
if (process.argv[1]?.endsWith('build-electron.mjs')) await build(options);
