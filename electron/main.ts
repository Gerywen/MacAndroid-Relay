import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { LocalFiles } from './local-files';
import { MtpClient } from './mtp-client';
import type { DeviceSession } from './device';
import { FileAccess } from './file-access';
import { PreferencesStore } from './preferences';
import { reply, string, AppError } from './errors';
import type {
  NavigationRequest,
  Mutation,
  TransferRequest,
  Preferences,
} from '../shared/contracts';

const verification = process.env.MACANDROID_RELAY_VERIFY_HOME;
app.setName('MacAndroid Relay');
// Let Electron/Apple choose the container's data path for actual MAS builds.
if (!process.mas)
  app.setPath(
    'userData',
    verification
      ? path.join(verification, 'profile')
      : path.join(app.getPath('appData'), 'MacAndroid Relay'),
  );
const home = verification || os.homedir();
const policyTest =
  !!verification &&
  !app.isPackaged &&
  !process.mas &&
  process.env.MACANDROID_RELAY_VERIFY_MODE === 'mas-policy';
const restricted = !!process.mas || policyTest;
const access = new FileAccess(
  restricted,
  path.join(app.getPath('userData'), 'folder-access.json'),
  policyTest
    ? () => () => {}
    : (bookmark) => app.startAccessingSecurityScopedResource(bookmark) as () => void,
);

const preferences = new PreferencesStore(path.join(app.getPath('userData'), 'preferences.json'));
const local = new LocalFiles(
  home,
  (file) => shell.trashItem(file),
  restricted ? (file) => access.require(file) : undefined,
);
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../resources');
const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
const nativeDirectory = path.join(resources, 'native', architecture);
const library = path.join(nativeDirectory, 'libmtp.9.dylib');
let device: MtpClient | DeviceSession = new MtpClient(library, () =>
  window?.webContents.send('macandroid-relay:device-changed', 'unavailable'),
);
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
let window: BrowserWindow | undefined;
let closing = false;
let quitWhenIdle = false;
let quitPrompt = false;
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

const safe = <Args extends unknown[], T>(channel: string, operation: (...args: Args) => T) =>
  ipcMain.handle(`macandroid-relay:${channel}`, (event, ...args: unknown[]) => {
    if (event.sender !== window?.webContents)
      return { ok: false, error: { code: 'PERMISSION', message: 'Unknown application window' } };
    return reply(() => operation(...(args as Args)));
  });
function menu() {
  const zh = preferences.get().language === 'zh-CN';
  const label = (cn: string, en: string) => (zh ? cn : en);
  const command = (value: string) => window?.webContents.send('macandroid-relay:command', value);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'MacAndroid Relay',
        submenu: [
          { role: 'about', label: label('关于 MacAndroid Relay', 'About MacAndroid Relay') },
          { type: 'separator' },
          {
            label: label('设置…', 'Settings…'),
            accelerator: 'CmdOrCtrl+,',
            click: () => command('settings'),
          },
          { type: 'separator' },
          { role: 'hide', label: label('隐藏 MacAndroid Relay', 'Hide MacAndroid Relay') },
          { role: 'hideOthers', label: label('隐藏其他应用', 'Hide Others') },
          { role: 'unhide', label: label('显示全部', 'Show All') },
          { type: 'separator' },
          { role: 'quit', label: label('退出', 'Quit') },
        ],
      },
      {
        label: label('文件', 'File'),
        submenu: [
          {
            label: label('新建文件夹', 'New Folder'),
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => command('new-folder'),
          },
          {
            label: label('上一级', 'Parent Folder'),
            accelerator: 'CmdOrCtrl+Up',
            click: () => command('parent'),
          },
        ],
      },
      {
        label: label('编辑', 'Edit'),
        submenu: [
          { role: 'undo', label: label('撤销', 'Undo') },
          { role: 'redo', label: label('重做', 'Redo') },
          { type: 'separator' },
          { role: 'cut', label: label('剪切', 'Cut') },
          { role: 'copy', label: label('复制', 'Copy') },
          { role: 'paste', label: label('粘贴', 'Paste') },
          {
            label: label('全选', 'Select All'),
            accelerator: 'CmdOrCtrl+A',
            click: () => command('select-all'),
          },
        ],
      },
      {
        label: label('显示', 'View'),
        submenu: [
          {
            label: label('刷新', 'Refresh'),
            accelerator: 'CmdOrCtrl+R',
            click: () => command('refresh'),
          },
          ...(!process.mas
            ? [{ role: 'toggleDevTools' as const, label: label('开发者工具', 'Developer Tools') }]
            : []),
          { role: 'togglefullscreen', label: label('全屏', 'Full Screen') },
        ],
      },
      {
        label: label('窗口', 'Window'),
        submenu: [
          { role: 'minimize', label: label('最小化', 'Minimize') },
          { role: 'zoom', label: label('缩放', 'Zoom') },
        ],
      },
      {
        label: label('帮助', 'Help'),
        submenu: [
          {
            label: label('使用帮助', 'Documentation'),
            click: () => {
              void showHelp();
            },
          },
        ],
      },
    ]),
  );
}
async function showHelp(): Promise<void> {
  const chinese = preferences.get().language === 'zh-CN';
  await dialog.showMessageBox(window!, {
    type: 'info',
    title: 'MacAndroid Relay',
    message: chinese ? 'Mac 与 Android 文件传输' : 'Mac to Android file transfer',
    detail: chinese
      ? '1. 使用 USB 连接手机，解锁并选择“文件传输”。\n2. 退出其他占用手机的传输应用，点击连接。\n3. 左侧浏览 Mac，右侧浏览 Android；拖放或选择文件进行传输。\n4. 在路径栏输入文件或文件夹路径，回车跳转。\n\n传输后端：libmtp 1.1.23 / libusb 1.0.30。'
      : '1. Connect your phone by USB, unlock it and select File Transfer.\n2. Close other apps using the phone, then click Connect.\n3. Browse your Mac on the left and Android on the right; drag or select files to transfer.\n4. Enter a file or folder path and press Return to navigate.\n\nTransport: libmtp 1.1.23 / libusb 1.0.30.',
    buttons: [chinese ? '好' : 'OK'],
  });
}
async function createWindow() {
  window = new BrowserWindow({
    title: 'MacAndroid Relay',
    width: 1180,
    height: 790,
    minWidth: 880,
    minHeight: 620,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 19 },
    vibrancy: 'sidebar',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !verification,
    },
  });
  window.once('ready-to-show', () => window?.show());
  window.on('close', (event) => {
    if (device.active && !closing) {
      event.preventDefault();
      app.quit();
    }
  });
  window.on('closed', () => {
    window = undefined;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const dev = process.env.VITE_DEV_SERVER_URL;
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) event.preventDefault();
  });
  if (verification) {
    const { verifyWindow } = await import('./verification');
    void verifyWindow(window, verification);
  }
  if (dev) await window.loadURL(dev);
  else await window.loadFile(path.resolve(__dirname, '../dist/index.html'));
}
app
  .whenReady()
  .then(async () => {
    if (process.mas) {
      const { DeviceSession } = await import('./device');
      device = new DeviceSession(library);
    }
    await preferences.load();
    await access.load();
    if (verification) await preferences.save({ autoConnect: false });
    safe('bootstrap', () => ({
      home: restricted ? access.folders[0] || '' : home,
      requiresFolderAuthorization: restricted,
      preferences: preferences.get(),
      version: app.getVersion(),
      shortcuts: restricted
        ? access.folders.slice(0, 1).map((folder) => ({ name: 'home', path: folder }))
        : [
            { name: 'home', path: home },
            { name: 'desktop', path: path.join(home, 'Desktop') },
            { name: 'documents', path: path.join(home, 'Documents') },
            { name: 'downloads', path: path.join(home, 'Downloads') },
            { name: 'pictures', path: path.join(home, 'Pictures') },
          ],
    }));
    safe('preferences', async (patch: Partial<Preferences>) => {
      const value = await preferences.save(patch);
      menu();
      return value;
    });
    safe('navigate', async (request: NavigationRequest) =>
      request.device === 'local'
        ? local.navigate(
            await access.require(local.resolve(request.path, request.currentPath)),
            request.currentPath,
            request.showHidden,
          )
        : request.device === 'mtp'
          ? serial(() =>
              device.navigate(
                request.path,
                request.currentPath,
                request.storageId,
                request.showHidden,
              ),
            )
          : Promise.reject(new AppError('INVALID_PATH', 'Invalid device')),
    );
    safe('mutate', async (request: Mutation) => {
      if (request.device === 'mtp') return serial(() => device.mutate(request));
      if (request.device !== 'local') throw new AppError('INVALID_PATH', 'Invalid device');
      const target = await access.require(request.path);
      if (request.type === 'rename') access.protectRoot(target);
      const files = request.files
        ? await Promise.all(request.files.map((file) => access.require(file)))
        : undefined;
      if (request.type === 'delete') files?.forEach((file) => access.protectRoot(file));
      return local.mutate({ ...request, path: target, files });
    });
    safe('connect', () => serial(() => device.connect()));
    safe('disconnect', () => serial(() => device.disconnect()));
    safe('cancel-transfer', () => device.cancelTransfer());
    safe('transfer', (request: TransferRequest) =>
      serial(async () => {
        if (request.direction === 'upload') {
          request = {
            ...request,
            sources: await Promise.all(
              request.sources.map(async (source) => ({
                ...source,
                path: await access.require(source.path),
              })),
            ),
          };
        } else request = { ...request, destination: await access.require(request.destination) };
        return {
          id: await device.transfer(request, (update) => {
            if (window && !window.isDestroyed())
              window.webContents.send('macandroid-relay:transfer-update', update);
            if (quitWhenIdle && (update.status === 'completed' || update.status === 'failed'))
              setTimeout(() => app.quit(), 100);
          }),
        };
      }),
    );
    safe('choose-folder', async () => {
      if (policyTest) return access.grant(home, 'policy-fixture-only');
      const result = await dialog.showOpenDialog(window!, {
        properties: ['openDirectory'],
        defaultPath: access.folders[0] || home,
        securityScopedBookmarks: !!process.mas,
      });
      if (result.canceled) return null;
      return restricted
        ? access.grant(result.filePaths[0], result.bookmarks?.[0] || '')
        : result.filePaths[0];
    });
    safe('open-file', async (file: string) => {
      string(file);
      file = await access.require(file);
      await stat(file);
      const error = await shell.openPath(file);
      if (error) throw new AppError('IO_ERROR', error);
    });
    safe('copy-text', (text: string) => {
      if (typeof text !== 'string' || text.length > 1000000)
        throw new AppError('INVALID_PATH', 'Invalid text');
      clipboard.writeText(text);
    });
    safe('help', showHelp);
    safe('diagnostics', async () =>
      JSON.stringify(
        {
          ...JSON.parse(await device.diagnostics()),
          mas: !!process.mas,
          folderAuthorization: restricted,
          authorizedFolderCount: access.folders.length,
          nativeProcess: process.mas ? 'main' : 'utility',
        },
        null,
        2,
      ),
    );
    menu();
    const icon = path.resolve(
      __dirname,
      process.env.VITE_DEV_SERVER_URL ? '../public/app-icon.png' : '../dist/app-icon.png',
    );
    if (app.dock && existsSync(icon)) app.dock.setIcon(icon);
    await createWindow();
    if (!verification) {
      try {
        const { usb } = await import('usb');
        let timer: ReturnType<typeof setTimeout>;
        const changed = () => {
          clearTimeout(timer);
          timer = setTimeout(
            () => window?.webContents.send('macandroid-relay:device-changed'),
            500,
          );
        };
        usb.on('attach', changed);
        usb.on('detach', changed);
        app.once('will-quit', () => {
          clearTimeout(timer);
          usb.removeListener('attach', changed);
          usb.removeListener('detach', changed);
        });
      } catch (error) {
        console.warn('USB hotplug unavailable; manual connection remains available', error);
      }
    }
    app.on('activate', () => {
      if (!window) void createWindow();
    });
  })
  .catch((error) => {
    console.error(error);
    app.quit();
  });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || verification) app.quit();
});
app.on('before-quit', (event) => {
  if (closing) return;
  event.preventDefault();
  if (device.active) {
    if (quitPrompt) return;
    quitPrompt = true;
    const zh = preferences.get().language === 'zh-CN';
    void dialog
      .showMessageBox(window!, {
        type: 'info',
        title: 'MacAndroid Relay',
        message: zh
          ? '正在传输，请等待完成后再退出应用。'
          : 'A transfer is running. Wait for it to finish before quitting.',
        buttons: zh ? ['保持打开', '传输完成后退出'] : ['Keep open', 'Quit after transfer'],
        cancelId: 0,
      })
      .then((result) => {
        quitPrompt = false;
        quitWhenIdle = result.response === 1;
        if (quitWhenIdle && !device.active) app.quit();
      });
    return;
  }
  closing = true;
  void device
    .close()
    .catch((error) => console.error('MTP shutdown', error))
    .finally(() => {
      access.close();
      app.quit();
    });
});
