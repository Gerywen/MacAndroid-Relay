import { app, Menu, type BrowserWindow } from 'electron';
import { writeFile, stat, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Reply, TransferRequest, TransferUpdate } from '../shared/contracts';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function verifyWindow(window: BrowserWindow, home: string) {
  const web = window.webContents;
  const execute = <T>(code: string): Promise<T> =>
    web.executeJavaScript(`(() => eval(${JSON.stringify(code)}))()`);
  const until = async (check: () => Promise<boolean>, name: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${name}`);
  };
  const capture = async (name: string) => {
    window.show();
    window.focus();
    await delay(350);
    await execute(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    await web.capturePage();
    await delay(150);
    await writeFile(path.join(home, `${name}.png`), (await web.capturePage()).toPNG());
  };
  const write = async (name: string, data: unknown) =>
    writeFile(path.join(home, `${name}.json`), JSON.stringify(data, null, 2));
  let loads = 0;
  web.on('did-finish-load', () => {
    loads++;
  });
  const errors: string[] = [];
  web.on('console-message', (event) => {
    if (event.level === 'error') errors.push(event.message);
  });
  web.once('did-finish-load', async () => {
    try {
      if (process.env.MACANDROID_RELAY_VERIFY_MODE === 'mas-policy' && !process.mas) {
        await until(
          () => execute(`!!document.querySelector('[data-folder-authorization]')`),
          'folder authorization screen',
        );
        const bootstrap = await execute<
          Reply<{ home: string; requiresFolderAuthorization: boolean }>
        >('window.desktop.bootstrap()');
        assert(bootstrap.ok && !bootstrap.data.home && bootstrap.data.requiresFolderAuthorization);
        const denied = await execute<Reply<unknown>>(
          `window.desktop.navigate(${JSON.stringify({ device: 'local', path: home, currentPath: '/', storageId: null, showHidden: false })})`,
        );
        assert(!denied.ok && denied.error.code === 'PERMISSION');
        await execute(`document.querySelector('[data-folder-authorization] button').click()`);
        await until(
          () => execute(`!!document.querySelector('[data-pane=local] .file-row')`),
          'authorized folder files',
        );
        const outside = await execute<Reply<unknown>>(
          `window.desktop.navigate(${JSON.stringify({ device: 'local', path: path.dirname(home), currentPath: home, storageId: null, showHidden: false })})`,
        );
        assert(!outside.ok && outside.error.code === 'PERMISSION');
        for (const direction of ['upload', 'download']) {
          const transferDenied = await execute<Reply<unknown>>(
            `window.desktop.transfer(${JSON.stringify({ direction, storageId: 1, destination: path.dirname(home), sources: [{ path: path.dirname(home), name: 'outside', isFolder: true }], overwrite: false, preprocess: true })})`,
          );
          assert(
            !transferDenied.ok && transferDenied.error.code === 'PERMISSION',
            'Unapproved transfer reached native backend',
          );
        }
        await write('mas-policy-result', {
          passed: true,
          kind: 'authorization-policy-only',
          actualAppSandbox: false,
        });
        console.info(
          'PASS: folder chooser, authorization boundary and path denial. This is not an Apple App Sandbox verification.',
        );
        app.quit();
        return;
      }
      await until(
        () => execute(`!!document.querySelector('[data-pane=local] .file-row')`),
        'renderer files',
      );
      const branding = await execute<{ title: string; header: string; brand: string }>(
        `({title:document.title,header:document.querySelector('.titlebar-title').textContent,brand:document.querySelector('.brand strong').textContent})`,
      );
      assert.deepEqual(branding, {
        title: 'MacAndroid Relay',
        header: 'MacAndroid Relay',
        brand: 'MacAndroid',
      });
      assert.equal(Menu.getApplicationMenu()?.items[0].label, 'MacAndroid Relay');
      const security = await execute<{ require: string; process: string; api: boolean }>(
        `({require:typeof window.require,process:typeof window.process,api:!!window.desktop})`,
      );
      assert.deepEqual(security, { require: 'undefined', process: 'undefined', api: true });
      const keys = await execute<string[]>('Object.keys(window.desktop)');
      assert(!keys.some((key) => ['invoke', 'send', 'ipcRenderer'].includes(key)));
      if (process.env.MACANDROID_RELAY_VERIFY_MODE === 'hardware') {
        const invoke = async <T>(code: string) => {
          const result = await execute<Reply<T>>(code);
          if (!result.ok) throw new Error(result.error.message);
          return result.data;
        };
        await execute(`document.querySelector('[data-pane=mtp] .device-empty button').click()`);
        await until(
          () =>
            execute(
              `!!document.querySelector('#device-storage')||!!document.querySelector('[data-pane=mtp] .connection-error')`,
            ),
          'phone connection',
        );
        const summary = await execute<{ name: string; id: number; error: string | null }>(
          `({name:document.querySelector('[data-pane=mtp] h2').textContent,id:Number(document.querySelector('#device-storage')?.value),error:document.querySelector('[data-pane=mtp] .connection-error')?.textContent||null})`,
        );
        if (summary.error) throw new Error(summary.error);
        await invoke<void>('window.desktop.disconnect()');
        const reopened = await invoke<{ connected: boolean; storages: { id: number }[] }>(
          'window.desktop.connect()',
        );
        assert(reopened.connected, 'Reconnect failed');
        assert(
          reopened.storages.some((storage) => storage.id === summary.id),
          'Storage changed after reconnect',
        );
        await write('hardware-reconnect', { passed: true });
        const diagnostics = JSON.parse(await invoke<string>('window.desktop.diagnostics()'));
        assert.equal(diagnostics.backend, 'libmtp');
        assert.equal(diagnostics.nativeLibrary, 'libmtp.9.dylib');
        await write('hardware-backend', diagnostics);
        const storageId = summary.id;
        assert(Number.isFinite(storageId), 'No device storage');
        const connection = { data: { name: summary.name } };
        const sourceName = '中文 传输资料';
        const source = path.join(home, sourceName);
        const download = path.join(home, 'Downloaded');
        await mkdir(path.join(source, '嵌套目录'), { recursive: true });
        await mkdir(download);
        const fixtures = [
          {
            name: '中文 文档.txt',
            data: Buffer.from('MacAndroid Relay 真机传输验证 / Unicode file transfer'),
          },
          { name: 'empty.txt', data: Buffer.alloc(0) },
          { name: 'binary.bin', data: randomBytes(1024 * 1024) },
          { name: '嵌套目录/notes.txt', data: Buffer.from('Nested directory verification') },
        ];
        for (const file of fixtures) await writeFile(path.join(source, file.name), file.data);
        const remote = '/MacAndroid-Relay-Verification-' + Date.now();
        let created = false;
        const transfer = async (request: TransferRequest) => {
          const result = await execute<Reply<TransferUpdate>>(`(async()=>{
            const terminal=new Map();let expected;let resolveWait;
            const complete=new Promise(resolve=>{resolveWait=resolve;});
            const stop=window.desktop.onTransfer(update=>{if(update.status==='completed'||update.status==='failed'){terminal.set(update.id,update);if(update.id===expected)resolveWait(update);}});
            const result=await window.desktop.transfer(${JSON.stringify(request)});
            if(!result.ok){stop();return result;}
            expected=result.data.id;if(terminal.has(expected))resolveWait(terminal.get(expected));
            const update=await Promise.race([complete,new Promise(resolve=>setTimeout(()=>resolve({status:'failed',error:{message:'Transfer timeout'}}),45000))]);stop();
            return update.status==='completed'?{ok:true,data:update}:{ok:false,error:update.error};
          })()`);
          await write('hardware-transfer-' + request.direction, result);
          if (!result.ok) throw new Error(result.error.message || JSON.stringify(result.error));
          await delay(200);
          return result.data;
        };
        try {
          await invoke<void>(
            `window.desktop.mutate(${JSON.stringify({ device: 'mtp', type: 'mkdir', storageId, path: '/', name: remote.slice(1) })})`,
          );
          created = true;
          await invoke<void>(
            `window.desktop.mutate(${JSON.stringify({ device: 'mtp', type: 'mkdir', storageId, path: remote, name: '重命名 验证' })})`,
          );
          await invoke<void>(
            `window.desktop.mutate(${JSON.stringify({ device: 'mtp', type: 'rename', storageId, path: remote + '/重命名 验证', name: '已重命名 验证' })})`,
          );
          await invoke<void>(
            `window.desktop.mutate(${JSON.stringify({ device: 'mtp', type: 'delete', storageId, path: remote, files: [remote + '/已重命名 验证'] })})`,
          );
          await delay(200);
          const upload = await transfer({
            direction: 'upload',
            storageId: storageId!,
            destination: remote,
            sources: [{ path: source, name: sourceName, isFolder: true }],
            overwrite: false,
            preprocess: true,
          });
          const duplicateRequest: TransferRequest = {
            direction: 'upload',
            storageId,
            destination: remote,
            sources: [{ path: source, name: sourceName, isFolder: true }],
            overwrite: false,
            preprocess: true,
          };
          const collision = await execute<Reply<{ id: string }>>(
            `window.desktop.transfer(${JSON.stringify(duplicateRequest)})`,
          );
          assert(
            !collision.ok && collision.error.code === 'OVERWRITE_REQUIRED',
            'Nested folder overwrite must require confirmation',
          );
          await transfer({ ...duplicateRequest, overwrite: true });
          const downloaded = await transfer({
            direction: 'download',
            storageId: storageId!,
            destination: download,
            sources: [{ path: remote + '/' + sourceName, name: sourceName, isFolder: true }],
            overwrite: false,
            preprocess: true,
          });
          const checks = [];
          for (const file of fixtures) {
            const actual = await readFile(path.join(download, sourceName, file.name));
            const expected = createHash('sha256').update(file.data).digest('hex');
            const sha256 = createHash('sha256').update(actual).digest('hex');
            assert.equal(sha256, expected, file.name);
            checks.push({ name: file.name, bytes: actual.length, sha256 });
          }
          await write('hardware-result', {
            device: connection.data.name,
            storageId,
            checks,
            upload,
            download: downloaded,
            passed: true,
          });
          for (const [device, value] of [
            ['local', source],
            ['mtp', remote + '/' + sourceName],
          ]) {
            await until(
              () =>
                execute(
                  `!document.querySelector('[data-pane=${device}] .path-bar input').disabled`,
                ),
              'path ready',
            );
            await execute(
              `const input=document.querySelector('[data-pane=${device}] .path-bar input');input.focus();input.select()`,
            );
            await web.insertText(value);
            web.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
            web.sendInputEvent({ type: 'char', keyCode: '\r' });
            web.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
            await delay(200);
            await until(
              () =>
                execute(
                  `document.querySelector('[data-pane=${device}] .path-bar input').value===${JSON.stringify(value)}&&!document.querySelector('[data-pane=${device}] .path-bar input').disabled&&document.querySelectorAll('[data-pane=${device}] .file-row').length===4`,
                ),
              'owned fixture folder',
            );
          }
          await write('hardware-paths', { local: source, mtp: remote + '/' + sourceName });
          await capture('hardware');
        } finally {
          if (created) {
            const cleanup = await execute<Reply<void>>(
              `window.desktop.mutate(${JSON.stringify({ device: 'mtp', type: 'delete', storageId, path: '/', files: [remote] })})`,
            );
            await write('hardware-cleanup', cleanup);
            assert(cleanup.ok, 'Owned remote test directory cleanup failed');
          }
          await execute('window.desktop.disconnect()');
        }
        console.info(
          `PASS: new Electron/preload/IPC upload and download, four SHA-256 matches, owned remote directory cleaned. Artifacts: ${home}`,
        );
        app.quit();
        return;
      }
      if (process.env.MACANDROID_RELAY_MAIN_MARKER === 'true') {
        await write('main-restarted', { pid: process.pid, url: web.getURL(), security });
        return;
      }
      const navigate = async (value: string) => {
        await execute(
          `const input=document.querySelector('[data-pane=local] .path-bar input');input.focus();input.select();`,
        );
        await web.insertText(value);
        web.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        web.sendInputEvent({ type: 'char', keyCode: '\r' });
        web.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        await delay(180);
        await until(
          () => execute(`!document.querySelector('[data-pane=local] .path-bar input').disabled`),
          'navigation settled',
        );
      };
      await navigate('~/Bulk');
      await until(
        () =>
          execute(
            `document.querySelector('[data-pane=local] .path-bar input').value.endsWith('/Bulk')`,
          ),
        'bulk navigation',
      );
      await delay(180);
      const virtualCount = await execute<number>(
        `document.querySelectorAll('[data-pane=local] .file-row').length`,
      );
      assert(virtualCount < 60, `Expected virtualization, got ${virtualCount} rows`);
      await navigate('../中文 文件.txt');
      await until(
        () =>
          execute(
            `!!document.querySelector('[data-pane=local] [data-file="中文 文件.txt"][aria-selected=true]')`,
          ),
        'Unicode file selected',
      );
      const goodPath = await execute<string>(
        `document.querySelector('[data-pane=local] .path-bar input').value`,
      );
      await navigate('missing-verification-path');
      await until(
        () => execute(`!!document.querySelector('[data-pane=local] .pane-error')`),
        'inline path error',
      );
      assert.equal(
        await execute<string>(
          `document.querySelector('[data-pane=local] [aria-selected=true]').getAttribute('data-file')`,
        ),
        '中文 文件.txt',
      );
      await execute(`document.querySelector('[data-pane=local] .path-bar input').focus()`);
      web.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      web.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await delay(100);
      assert.equal(
        await execute(`document.querySelector('[data-pane=local] .path-bar input').value`),
        goodPath,
      );
      assert(!(await execute(`!!document.querySelector('[data-pane=local] .pane-error')`)));
      await navigate(home);
      await until(
        () =>
          execute(
            `document.querySelector('[data-pane=local] .path-bar input').value===${JSON.stringify(home)}`,
          ),
        'home navigation',
      );
      await execute(
        `document.querySelector('[data-pane=local] button[aria-label="新建文件夹"]').click()`,
      );
      await until(() => execute(`!!document.querySelector('#mutation-name')`), 'new folder dialog');
      await web.insertText('UI 验证目录');
      await execute(`document.querySelector('#mutation-name').form.requestSubmit()`);
      await until(
        () =>
          stat(path.join(home, 'UI 验证目录')).then(
            () => true,
            () => false,
          ),
        'create directory',
      );
      await until(
        () => execute(`!!document.querySelector('[data-pane=local] [data-file="UI 验证目录"]')`),
        'created row',
      );
      await execute(
        `document.querySelector('[data-pane=local] [data-file="UI 验证目录"]').click()`,
      );
      await delay(100);
      await execute(`document.querySelector('button[aria-label="重命名"]').click()`);
      await until(() => execute(`!!document.querySelector('#mutation-name')`), 'rename dialog');
      await execute(
        `document.querySelector('#mutation-name').focus();document.querySelector('#mutation-name').select()`,
      );
      await web.insertText('已重命名目录');
      await execute(`document.querySelector('#mutation-name').form.requestSubmit()`);
      await until(
        () =>
          stat(path.join(home, '已重命名目录')).then(
            () => true,
            () => false,
          ),
        'rename directory',
      );
      await until(() => execute(`!document.querySelector('dialog[open]')`), 'rename modal close');
      await until(
        () => execute(`!!document.querySelector('[data-pane=local] [data-file="已重命名目录"]')`),
        'renamed row',
      );
      await capture('zh-light');
      // Synthetic progress events validate rendering without touching a connected phone.
      const preview: TransferUpdate = {
        id: 'progress-preview',
        direction: 'upload',
        destination: '/',
        count: 2,
        status: 'preparing',
        progress: 0,
        currentFile: '',
        speed: 0,
        elapsed: 0,
        bytesSent: 0,
        totalBytes: 0,
      };
      web.send('macandroid-relay:transfer-update', preview);
      await until(
        () => execute(`!!document.querySelector('.transfer-meter.indeterminate')`),
        'indeterminate preparation',
      );
      web.send('macandroid-relay:transfer-update', {
        ...preview,
        status: 'running',
        progress: 42,
        currentFile: '/demo/演示视频.mp4',
        speed: 12.5,
        elapsed: 8000,
        bytesSent: 42 * 1048576,
        totalBytes: 100 * 1048576,
      });
      await until(
        () => execute(`document.querySelector('.transfer-details')?.textContent.includes('42%')`),
        'batch byte progress',
      );
      await capture('transfer-progress');
      web.send('macandroid-relay:transfer-update', { ...preview, status: 'running', progress: 99 });
      await until(
        () =>
          execute(
            `document.querySelector('.transfer-card')?.textContent.includes('正在完成文件提交')`,
          ),
        'commit phase',
      );
      web.send('macandroid-relay:transfer-update', {
        ...preview,
        status: 'completed',
        progress: 100,
      });
      await until(
        () => execute(`!document.querySelector('.transfer-card')`),
        'completion clears active progress',
      );
      await execute(`document.querySelector('button[aria-label="设置"]').click()`);
      await until(() => execute(`!!document.querySelector('#setting-language')`), 'settings');
      await execute(
        `const language=document.querySelector('#setting-language');language.value='en';language.dispatchEvent(new Event('change',{bubbles:true}));`,
      );
      await until(
        () => execute(`document.body.innerText.includes('Appearance')`),
        'English language',
      );
      await until(
        async () => !!Menu.getApplicationMenu()?.items.some((item) => item.label === 'Edit'),
        'English native menu',
      );
      await execute(
        `const theme=document.querySelector('#setting-theme');theme.value='dark';theme.dispatchEvent(new Event('change',{bubbles:true}));`,
      );
      await until(() => execute(`document.documentElement.dataset.theme==='dark'`), 'dark theme');
      await execute(
        `[...document.querySelectorAll('dialog button')].find(node=>node.textContent==='Close').click()`,
      );
      await capture('en-dark');
      await execute(
        `document.querySelector('[data-pane=local] button[aria-label="Icon view"]').click()`,
      );
      await until(
        () => execute(`!!document.querySelector('[data-pane=local] .grid-item')`),
        'grid view',
      );
      await capture('en-dark-grid');
      window.setSize(880, 640);
      await delay(180);
      const dimensions = await execute<{ width: number; content: number }>(
        `({width:innerWidth,content:document.documentElement.scrollWidth})`,
      );
      assert(dimensions.content <= dimensions.width, 'Horizontal overflow at minimum window size');
      window.setSize(1180, 790);
      await delay(200);
      assert.equal(errors.length, 0, errors.join('\n'));
      await write('production-result', {
        branding,
        security,
        virtualCount,
        loads,
        pid: process.pid,
        url: web.getURL(),
        passed: true,
      });
      if (process.env.MACANDROID_RELAY_VERIFY_MODE === 'development') {
        await execute(
          `window.__verifyDocument=document; const input=document.querySelector('[data-pane=local] .path-bar input');input.focus();input.select();`,
        );
        await web.insertText('Preserved HMR draft');
        await delay(100);
        await write('dev-initial', { pid: process.pid, loads, url: web.getURL() });
        await until(
          () => execute(`!!document.querySelector('[data-hmr-verification]')`),
          'React Fast Refresh',
        );
        const refreshed = await execute<{ sameDocument: boolean; draft: string }>(
          `({sameDocument:document===window.__verifyDocument,draft:document.querySelector('[data-pane=local] .path-bar input').value})`,
        );
        assert(refreshed.sameDocument);
        assert.equal(refreshed.draft, 'Preserved HMR draft');
        await write('dev-refreshed', { ...refreshed, pid: process.pid, loads });
        await capture('dev-refreshed');
      } else {
        console.info(
          `PASS: isolated preload, Unicode navigation, virtualization, file mutations, bilingual native menu, themes, grid/list. Artifacts: ${home}`,
        );
        app.quit();
      }
    } catch (error) {
      await write('failure', {
        error: String(error),
        stack: (error as Error).stack,
        console: errors,
      });
      console.error(error);
      await capture('failure');
      app.exit(1);
    }
  });
}
