import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import assert from 'node:assert/strict';
const mode = process.argv.includes('--mas-policy')
  ? 'mas-policy'
  : process.argv.includes('--hardware')
    ? 'hardware'
    : process.argv.includes('--dev')
      ? 'development'
      : 'production';
const appFlag = process.argv.indexOf('--app');
const executable = appFlag === -1 ? null : process.argv[appFlag + 1];
if (appFlag !== -1 && !executable) throw new Error('--app requires an executable path');
if (executable && mode === 'development')
  throw new Error('--app is only supported for built application checks');
const home = await mkdtemp(path.join(os.tmpdir(), 'macandroid-relay-ui-'));
await mkdir(path.join(home, 'profile'));
await writeFile(
  path.join(home, 'profile/preferences.json'),
  JSON.stringify({ language: 'zh-CN', theme: 'light', autoConnect: false }),
);
for (const folder of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Bulk', 'Projects'])
  await mkdir(path.join(home, folder));
await Promise.all(
  Array.from({ length: 400 }, (_, index) =>
    writeFile(path.join(home, 'Bulk', `file-${String(index).padStart(3, '0')}.txt`), 'fixture'),
  ),
);
await writeFile(path.join(home, '中文 文件.txt'), 'Unicode fixture');
await writeFile(path.join(home, 'Readme.md'), 'MacAndroid Relay');
await writeFile(path.join(home, '.hidden'), 'Hidden fixture');
const env = {
  ...process.env,
  MACANDROID_RELAY_VERIFY_HOME: home,
  MACANDROID_RELAY_VERIFY_MODE: mode,
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (name) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      const failure = JSON.parse(await readFile(path.join(home, 'failure.json'), 'utf8'));
      throw new Error(JSON.stringify(failure));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      return JSON.parse(await readFile(path.join(home, name + '.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${name}: ${home}`);
};
if (mode !== 'development') {
  const child = spawn(
    executable || createRequire(import.meta.url)('electron'),
    executable ? [] : ['.'],
    { env, stdio: 'inherit' },
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  assert.equal(code, 0);
  assert(
    (
      await wait(
        mode === 'mas-policy'
          ? 'mas-policy-result'
          : mode === 'hardware'
            ? 'hardware-result'
            : 'production-result',
      )
    ).passed,
  );
} else {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  env.VITE_PORT = String(server.address().port);
  await new Promise((resolve) => server.close(resolve));
  const component = path.resolve('src/components/FilePane.tsx'),
    main = path.resolve('electron/main.ts');
  const original = await readFile(component, 'utf8'),
    originalMain = await readFile(main, 'utf8');
  const modified = original.replace('<section', '<section data-hmr-verification="updated"');
  const modifiedMain = originalMain + "\nprocess.env.MACANDROID_RELAY_MAIN_MARKER='true';\n";
  const child = spawn(process.execPath, ['scripts/dev.mjs'], { env, stdio: 'inherit' });
  try {
    const initial = await wait('dev-initial');
    await writeFile(component, modified);
    const refreshed = await wait('dev-refreshed');
    assert.equal(initial.pid, refreshed.pid);
    assert.equal(initial.loads, refreshed.loads);
    await writeFile(main, modifiedMain);
    const restarted = await wait('main-restarted');
    assert.notEqual(restarted.pid, initial.pid);
    console.info(
      `PASS: real React Fast Refresh preserves document and draft; Electron-only changes restart main. Artifacts: ${home}`,
    );
  } finally {
    if ((await readFile(component, 'utf8')) === modified) await writeFile(component, original);
    if ((await readFile(main, 'utf8')) === modifiedMain) await writeFile(main, originalMain);
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  }
}
