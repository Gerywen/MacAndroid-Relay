import { createServer } from 'vite';
import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { options } from './build-electron.mjs';
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
let child,
  closing = false;
const launch = async () => {
  if (child && child.exitCode === null)
    await new Promise((resolve) => {
      const previous = child;
      const timer = setTimeout(() => previous.kill('SIGKILL'), 4000);
      previous.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      previous.kill();
    });
  if (closing) return;
  child = spawn(createRequire(import.meta.url)('electron'), ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
};
const compiler = await context({
  ...options,
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd(async (result) => {
          if (!result.errors.length) await launch();
        });
      },
    },
  ],
});
await compiler.watch();
server.printUrls();
const shutdown = async () => {
  if (closing) return;
  closing = true;
  child?.kill();
  await compiler.dispose();
  await server.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
