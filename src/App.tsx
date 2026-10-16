import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings2,
  CircleHelp,
  Home,
  Monitor,
  FileText,
  Download,
  Image,
  Smartphone,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  FolderOpen,
  Pencil,
  Trash2,
  Copy,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  Bootstrap,
  Connection,
  Device,
  FileNode,
  Preferences,
  TransferRequest,
  TransferUpdate,
  Failure,
} from '../shared/contracts';
import { ContextMenu } from './components/ContextMenu';
import { FilePane } from './components/FilePane';
import { Modal } from './components/Modal';
import { usePane, type PaneState } from './hooks/usePane';
import { translate, errorKey } from './i18n';
import { asFailure, parent, size, unwrap } from './lib';
const defaults: Preferences = {
  language: 'zh-CN',
  theme: 'auto',
  view: 'list',
  showHidden: false,
  directoriesFirst: true,
  autoConnect: true,
  preprocess: true,
};
type Dialog =
  | { type: 'settings' | 'help' }
  | { type: 'mkdir' | 'rename' | 'delete'; device: Device }
  | { type: 'overwrite'; request: TransferRequest };
type Menu = { x: number; y: number; device: Device; file: FileNode | null } | null;
export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [storageId, setStorageId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [active, setActive] = useState<Device>('local');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [form, setForm] = useState('');
  const [formError, setFormError] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobs, setJobs] = useState<TransferUpdate[]>([]);
  const [transferPending, setTransferPending] = useState(false);
  const [cancellingTransfer, setCancellingTransfer] = useState(false);
  const [toast, setToast] = useState<{
    key: 'folderCreated' | 'renamed' | 'deleted' | 'copied' | 'transferDone' | 'transferFailed';
    id: number;
    error?: boolean;
    message?: string;
  } | null>(null);
  const [globalError, setGlobalError] = useState<Failure | null>(null);
  const [diagnostics, setDiagnostics] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const local = usePane('local', preferences, null);
  const mtp = usePane('mtp', preferences, storageId);
  const t = translate(preferences.language);
  const busy =
    transferPending || jobs.some((job) => job.status === 'running' || job.status === 'preparing');
  const runningJob = jobs.find((job) => job.status === 'running' || job.status === 'preparing');
  const current = active === 'local' ? local : mtp;
  const actions = useRef({ local, mtp, connect: () => {}, busy: false });
  const connectingRef = useRef(false);
  const preferencesRevision = useRef(0);
  const notify = (key: NonNullable<typeof toast>['key']) => setToast({ key, id: Date.now() });
  const notifyFailure = (message: string) =>
    setToast({ key: 'transferFailed', id: Date.now(), error: true, message });
  const updatePreferences = async (patch: Partial<Preferences>) => {
    const revision = ++preferencesRevision.current;
    setPreferences((value) => ({ ...value, ...patch }));
    try {
      const saved = unwrap(await window.desktop.preferences(patch));
      if (revision === preferencesRevision.current) setPreferences(saved);
    } catch (error) {
      setGlobalError(asFailure(error));
    }
  };
  const connect = async () => {
    if (connectingRef.current || busy) return;
    connectingRef.current = true;
    setConnecting(true);
    mtp.setError(null);
    try {
      const device = unwrap(await window.desktop.connect());
      setConnection(device);
      setStorageId(device.storages[0]?.id ?? null);
      if (!device.storages.length) mtp.setError({ code: 'NO_DEVICE', message: t('storageEmpty') });
    } catch (error) {
      setConnection(null);
      setStorageId(null);
      mtp.reset();
      mtp.setError(asFailure(error));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  };
  const disconnect = async () => {
    if (busy) return;
    try {
      unwrap(await window.desktop.disconnect());
      setConnection(null);
      setStorageId(null);
      mtp.reset();
    } catch (error) {
      setGlobalError(asFailure(error));
    }
  };
  actions.current = { local, mtp, connect: () => void connect(), busy };
  useEffect(() => {
    let alive = true;
    void window.desktop
      .bootstrap()
      .then((reply) => {
        if (!alive) return;
        const data = unwrap(reply);
        setBootstrap(data);
        setPreferences(data.preferences);
      })
      .catch((error) => setGlobalError(asFailure(error)));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (bootstrap?.home) void local.navigate(bootstrap.home).catch(() => undefined);
    if (bootstrap?.preferences.autoConnect) void connect();
  }, [bootstrap?.home]);
  useEffect(() => {
    if (connection?.connected && storageId !== null)
      void mtp.navigate('/', false).catch(() => undefined);
  }, [storageId, connection?.connected]);
  useEffect(() => {
    if (local.path) void local.refresh();
    if (connection?.connected) void mtp.refresh();
  }, [preferences.showHidden]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'auto' ? (media.matches ? 'dark' : 'light') : preferences.theme;
      document.documentElement.lang = preferences.language;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme, preferences.language]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(
    () =>
      window.desktop.onTransfer((update) => {
        if (update.status === 'completed' || update.status === 'failed')
          setCancellingTransfer(false);
        setJobs((jobs) => [update, ...jobs.filter((job) => job.id !== update.id)].slice(0, 30));
        if (update.status === 'completed') {
          notify('transferDone');
          void actions.current.local.refresh();
          void actions.current.mtp.refresh();
        } else if (update.status === 'failed') {
          notifyFailure(update.error ? t(errorKey(update.error)) : t('transferFailed'));
          void actions.current.local.refresh();
          void actions.current.mtp.refresh();
        }
      }),
    [],
  );
  useEffect(
    () =>
      window.desktop.onDeviceChanged((reason) => {
        if (reason === 'unavailable') {
          setConnection(null);
          setStorageId(null);
          actions.current.mtp.reset();
          actions.current.mtp.setError({ code: 'NO_DEVICE', message: 'MTP service unavailable' });
        } else if (preferences.autoConnect && !actions.current.busy) actions.current.connect();
      }),
    [preferences.autoConnect],
  );
  useEffect(() =>
    window.desktop.onCommand((command) => {
      if (command === 'settings') {
        setDialog({ type: 'settings' });
        return;
      }
      if (document.activeElement instanceof HTMLInputElement) {
        if (command === 'select-all') document.activeElement.select();
        return;
      }
      if (command === 'select-all') current.setSelected(current.visible.map((file) => file.path));
      if (command === 'new-folder' && !busy) showMutation('mkdir', active);
      if (command === 'refresh' && !busy) void current.refresh();
      if (command === 'parent' && !busy)
        void current.navigate(parent(current.path)).catch(() => undefined);
    }),
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        current.setSelected(current.visible.map((file) => file.path));
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setDialog({ type: 'settings' });
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'n' &&
        !busy
      ) {
        event.preventDefault();
        showMutation('mkdir', active);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        event.preventDefault();
        void current.navigate(parent(current.path)).catch(() => undefined);
      }
      if (event.key === 'Escape' && !dialog) current.setSelected([]);
      if (event.key === 'Backspace' && current.selected.length && !busy && !dialog) {
        event.preventDefault();
        showMutation('delete', active);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  function showMutation(type: 'mkdir' | 'rename' | 'delete', device: Device) {
    const pane = device === 'local' ? local : mtp;
    setForm(
      type === 'rename'
        ? pane.files.find((file) => file.path === pane.selected[0])?.name || ''
        : '',
    );
    setFormError(null);
    setDialog({ type, device });
  }
  const mutation = async () => {
    if (!dialog || !('device' in dialog)) return;
    const pane = dialog.device === 'local' ? local : mtp;
    setSubmitting(true);
    setFormError(null);
    try {
      unwrap(
        await window.desktop.mutate({
          type: dialog.type as 'mkdir' | 'rename' | 'delete',
          device: dialog.device,
          storageId: dialog.device === 'mtp' ? storageId : null,
          path: dialog.type === 'rename' ? pane.selected[0] : pane.path,
          name: form,
          files: pane.selected,
        }),
      );
      await pane.refresh();
      notify(
        dialog.type === 'mkdir'
          ? 'folderCreated'
          : dialog.type === 'rename'
            ? 'renamed'
            : 'deleted',
      );
      setDialog(null);
    } catch (error) {
      setFormError(asFailure(error));
    } finally {
      setSubmitting(false);
    }
  };
  const transfer = async (
    direction: 'upload' | 'download',
    sources?: TransferRequest['sources'],
    overwrite = false,
  ) => {
    if (!connection?.connected || storageId === null || busy) return;
    const pane = direction === 'upload' ? local : mtp;
    const files = sources || pane.files.filter((file) => pane.selected.includes(file.path));
    if (!files.length) return;
    const request: TransferRequest = {
      direction,
      storageId,
      sources: files,
      destination: direction === 'upload' ? mtp.path : local.path,
      overwrite,
      preprocess: preferences.preprocess,
    };
    await startTransfer(request);
  };
  async function startTransfer(request: TransferRequest) {
    setTransferPending(true);
    setGlobalError(null);
    try {
      const result = unwrap(await window.desktop.transfer(request));
      setJobs((jobs) =>
        jobs.some((job) => job.id === result.id)
          ? jobs
          : [
              {
                id: result.id,
                direction: request.direction,
                destination: request.destination,
                count: request.sources.length,
                status: 'preparing',
                progress: 0,
                currentFile: '',
                speed: 0,
                elapsed: 0,
                bytesSent: 0,
                totalBytes: 0,
              },
              ...jobs,
            ],
      );
      setDialog(null);
    } catch (error) {
      const value = asFailure(error);
      if (value.code === 'OVERWRITE_REQUIRED') setDialog({ type: 'overwrite', request });
      else setGlobalError(value);
    } finally {
      setTransferPending(false);
    }
  }
  const open = (pane: PaneState, file: FileNode) => {
    if (file.isFolder) void pane.navigate(file.path).catch(() => undefined);
    else if (pane.device === 'local')
      void window.desktop
        .openFile(file.path)
        .then(unwrap)
        .catch((error) => setGlobalError(asFailure(error)));
    else void transfer('download', [file]);
  };
  const copy = async (device: Device = active) => {
    const pane = device === 'local' ? local : mtp;
    const value = pane.selected.join('\n') || pane.path;
    unwrap(await window.desktop.copyText(value));
    notify('copied');
  };
  const showContextMenu = (device: Device, file: FileNode | null, event: React.MouseEvent) => {
    event.preventDefault();
    const pane = device === 'local' ? local : mtp;
    if (file && !pane.selected.includes(file.path)) pane.setSelected([file.path]);
    setActive(device);
    setMenu({ x: event.clientX, y: event.clientY, device, file });
  };
  const shortcutIcons = {
    home: Home,
    desktop: Monitor,
    documents: FileText,
    downloads: Download,
    pictures: Image,
  };
  const paneProps = {
    preferences,
    connection,
    storageId,
    disabled: busy,
    connecting,
    onConnect: () => void connect(),
    onDisconnect: () => void disconnect(),
    onStorage: setStorageId,
    onView: (view: 'list' | 'grid') => void updatePreferences({ view }),
  };
  const renderContextMenu = () => {
    if (!menu) return null;
    const pane = menu.device === 'local' ? local : mtp;
    const unavailable = menu.device === 'mtp' && !connection?.connected;
    return (
      <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
        {menu.file ? (
          <>
            <button
              className="context-item"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                open(pane, menu.file!);
                setMenu(null);
              }}
            >
              {menu.file.isFolder ? <FolderOpen size={16} /> : <FileText size={16} />}
              <span>{t('open')}</span>
            </button>
            {menu.device === 'mtp' ? (
              <button
                className="context-item"
                role="menuitem"
                disabled={!connection?.connected || !pane.selected.length || busy}
                onClick={() => {
                  void transfer('download');
                  setMenu(null);
                }}
              >
                <ArrowDownToLine size={16} />
                <span>{t('download')}</span>
              </button>
            ) : (
              <button
                className="context-item"
                role="menuitem"
                disabled={!connection?.connected || !pane.selected.length || busy}
                onClick={() => {
                  void transfer('upload');
                  setMenu(null);
                }}
              >
                <ArrowUpFromLine size={16} />
                <span>{t('upload')}</span>
              </button>
            )}
            <div className="context-separator" />
            <button
              className="context-item"
              role="menuitem"
              disabled={!pane.path}
              onClick={() => {
                void copy(menu.device).catch((error) => setGlobalError(asFailure(error)));
                setMenu(null);
              }}
            >
              <Copy size={16} />
              <span>{t('copyPath')}</span>
            </button>
            <button
              className="context-item"
              role="menuitem"
              disabled={pane.selected.length !== 1 || busy}
              onClick={() => {
                showMutation('rename', menu.device);
                setMenu(null);
              }}
            >
              <Pencil size={16} />
              <span>{t('rename')}</span>
            </button>
            <button
              className="context-item danger"
              role="menuitem"
              disabled={!pane.selected.length || busy}
              onClick={() => {
                showMutation('delete', menu.device);
                setMenu(null);
              }}
            >
              <Trash2 size={16} />
              <span>{t('delete')}</span>
            </button>
          </>
        ) : (
          <>
            <button
              className="context-item"
              role="menuitem"
              disabled={unavailable || busy}
              onClick={() => {
                showMutation('mkdir', menu.device);
                setMenu(null);
              }}
            >
              <FolderPlus size={16} />
              <span>{t('newFolder')}</span>
            </button>
            <button
              className="context-item"
              role="menuitem"
              disabled={busy}
              onClick={() => {
                if (unavailable) void connect();
                else void pane.refresh();
                setMenu(null);
              }}
            >
              <RefreshCw size={16} />
              <span>{t('refresh')}</span>
            </button>
            <div className="context-separator" />
            <button
              className="context-item"
              role="menuitem"
              disabled={!pane.path}
              onClick={() => {
                void copy(menu.device).catch((error) => setGlobalError(asFailure(error)));
                setMenu(null);
              }}
            >
              <Copy size={16} />
              <span>{t('copyPath')}</span>
            </button>
          </>
        )}
      </ContextMenu>
    );
  };
  return (
    <div className="application">
      <header className="titlebar">
        <span className="titlebar-title">MacAndroid Relay</span>
        <div className="titlebar-tools">
          <button
            className="icon-button"
            title={t('help')}
            aria-label={t('help')}
            onClick={() => {
              setDialog({ type: 'help' });
              void window.desktop.diagnostics().then((reply) => setDiagnostics(unwrap(reply)));
            }}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="icon-button"
            title={t('settings')}
            aria-label={t('settings')}
            onClick={() => setDialog({ type: 'settings' })}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="brand">
            <img src="./app-icon.png" alt="" />
            <div>
              <strong>MacAndroid</strong>
              <span>Relay</span>
            </div>
          </div>
          <h2>{t('favorites')}</h2>
          <nav aria-label={t('favorites')}>
            {bootstrap?.shortcuts.map((shortcut) => {
              const Icon = shortcutIcons[shortcut.name];
              return (
                <button
                  key={shortcut.name}
                  className={local.path === shortcut.path ? 'selected' : ''}
                  onClick={() => {
                    setActive('local');
                    void local.navigate(shortcut.path).catch(() => undefined);
                  }}
                >
                  <Icon size={17} />
                  <span>{t(shortcut.name)}</span>
                  {local.path === shortcut.path && <ChevronRight size={13} />}
                </button>
              );
            })}
          </nav>
          <h2>{t('devices')}</h2>
          <button className="device-sidebar" onClick={() => setActive('mtp')}>
            <Smartphone size={18} />
            <div>
              <span>{connection?.name || t('android')}</span>
              <small>
                <i className={connection?.connected ? 'online' : ''} />
                {connection?.connected ? t('connected') : t('notConnected')}
              </small>
            </div>
          </button>
          <div className="sidebar-bottom">
            <p>{t('safety')}</p>
            <span>v{bootstrap?.version || '0.1.0'}</span>
          </div>
        </aside>
        <main>
          <div className="workspace-toolbar">
            <div className="workspace-title">
              <h1>{t('workspace')}</h1>
              <p>{t('workspaceSubtitle')}</p>
            </div>
            <div className="toolbar-buttons">
              <div className="transfer-actions">
                <button
                  className="button primary"
                  disabled={!connection?.connected || !local.selected.length || busy}
                  onClick={() => void transfer('upload')}
                >
                  <ArrowUpFromLine size={17} />
                  {t('upload')}
                </button>
                <button
                  className="button"
                  disabled={!connection?.connected || !mtp.selected.length || busy}
                  onClick={() => void transfer('download')}
                >
                  <ArrowDownToLine size={17} />
                  {t('download')}
                </button>
              </div>
              <div className="selection-actions">
                <button
                  className="icon-button"
                  title={t('copyPath')}
                  aria-label={t('copyPath')}
                  disabled={!current.path}
                  onClick={() => void copy().catch((error) => setGlobalError(asFailure(error)))}
                >
                  <Copy size={17} />
                </button>
                <button
                  className="icon-button"
                  title={t('rename')}
                  aria-label={t('rename')}
                  disabled={current.selected.length !== 1 || busy}
                  onClick={() => showMutation('rename', active)}
                >
                  <Pencil size={17} />
                </button>
                <button
                  className="icon-button danger"
                  title={t('delete')}
                  aria-label={t('delete')}
                  disabled={!current.selected.length || busy}
                  onClick={() => showMutation('delete', active)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          </div>
          {globalError && (
            <div className="global-error" role="alert">
              <AlertCircle size={17} />
              <span>{t(errorKey(globalError))}</span>
              <details>
                <summary>{t('showDetails')}</summary>
                {globalError.message}
              </details>
              <button
                className="icon-button"
                title={t('close')}
                aria-label={t('close')}
                onClick={() => setGlobalError(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <div className="panes">
            <FilePane
              {...paneProps}
              pane={local}
              active={active === 'local'}
              onFocus={() => setActive('local')}
              onFolder={() => showMutation('mkdir', 'local')}
              onChooseFolder={
                bootstrap?.requiresFolderAuthorization
                  ? () => {
                      void window.desktop
                        .chooseFolder()
                        .then(async (reply) => {
                          const folder = unwrap(reply);
                          if (folder) await local.navigate(folder);
                        })
                        .catch((error) => setGlobalError(asFailure(error)));
                    }
                  : undefined
              }
              onOpen={(file) => open(local, file)}
              onDrop={(sources) => void transfer('download', sources)}
              onContextMenu={(file, event) => showContextMenu('local', file, event)}
            />
            <FilePane
              {...paneProps}
              pane={mtp}
              active={active === 'mtp'}
              onFocus={() => setActive('mtp')}
              onFolder={() => showMutation('mkdir', 'mtp')}
              onOpen={(file) => open(mtp, file)}
              onDrop={(sources) => void transfer('upload', sources)}
              onContextMenu={(file, event) => showContextMenu('mtp', file, event)}
            />
          </div>
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <i className={connection?.connected ? 'online' : ''} />
          {connection?.connected ? t('connected') : t('ready')}
        </span>
        {runningJob && (
          <span className="status-transfer">
            <span className="status-progress">
              <i style={{ width: `${Math.max(0, Math.min(100, runningJob.progress))}%` }} />
            </span>
            <strong>{Math.round(runningJob.progress)}%</strong>
            <span className="status-file">
              {runningJob.currentFile.split('/').at(-1) ||
                `${runningJob.count} ${t('transferCount')}`}
            </span>
          </span>
        )}
        <span>{t('sourceNote')}</span>
      </footer>
      {runningJob && (
        <section className="transfer-card" aria-label={t('transferring')}>
          <div className="transfer-card-heading">
            <strong>
              {cancellingTransfer
                ? t('cancellingTransfer')
                : runningJob.status === 'preparing'
                  ? t('preparingTransfer')
                  : runningJob.progress >= 99
                    ? t('finalizingTransfer')
                    : t('transferring')}
            </strong>
            <button
              className="button"
              disabled={cancellingTransfer}
              onClick={() => {
                setCancellingTransfer(true);
                void window.desktop.cancelTransfer().then((result) => {
                  if (!result.ok) {
                    setCancellingTransfer(false);
                    notifyFailure(t(errorKey(result.error)));
                  }
                });
              }}
            >
              {t('cancelTransfer')}
            </button>
          </div>
          <div className="transfer-filename" title={runningJob.currentFile}>
            {runningJob.currentFile.split('/').at(-1) || '—'}
          </div>
          <div
            className={`transfer-meter ${runningJob.status === 'preparing' ? 'indeterminate' : ''}`}
            role="progressbar"
            aria-label={t('transferring')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={
              runningJob.status === 'preparing' ? undefined : Math.floor(runningJob.progress)
            }
          >
            <i style={{ width: `${runningJob.progress}%` }} />
          </div>
          <div className="transfer-details">
            <span>
              {runningJob.status === 'preparing' ? '—' : `${Math.floor(runningJob.progress)}%`}
            </span>
            <span>
              {size(runningJob.bytesSent)} /{' '}
              {runningJob.totalBytes ? size(runningJob.totalBytes) : '—'}
            </span>
            <span>{runningJob.speed > 0 ? `${size(runningJob.speed * 1048576)}/s` : '—'}</span>
          </div>
        </section>
      )}
      {renderContextMenu()}
      {toast && (
        <div className={`toast ${toast.error ? 'error' : ''}`} role="status" aria-live="polite">
          {toast.error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
          {toast.message || t(toast.key)}
        </div>
      )}
      {dialog?.type === 'settings' && (
        <Modal
          title={t('settings')}
          closeLabel={t('close')}
          onClose={() => setDialog(null)}
          footer={
            <button className="button primary" onClick={() => setDialog(null)}>
              {t('close')}
            </button>
          }
        >
          <div className="settings-row">
            <label htmlFor="setting-language">{t('language')}</label>
            <select
              id="setting-language"
              value={preferences.language}
              onChange={(event) =>
                void updatePreferences({ language: event.target.value as Preferences['language'] })
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="settings-row">
            <label htmlFor="setting-theme">{t('appearance')}</label>
            <select
              id="setting-theme"
              value={preferences.theme}
              onChange={(event) =>
                void updatePreferences({ theme: event.target.value as Preferences['theme'] })
              }
            >
              {(['auto', 'light', 'dark'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </div>
          {(['showHidden', 'directoriesFirst', 'autoConnect', 'preprocess'] as const).map((key) => (
            <label className="settings-row toggle-row" key={key}>
              <span>
                {t(
                  (
                    {
                      showHidden: 'hidden',
                      directoriesFirst: 'directoriesFirst',
                      autoConnect: 'autoConnect',
                      preprocess: 'preprocess',
                    } as const
                  )[key],
                )}
              </span>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => void updatePreferences({ [key]: event.target.checked })}
              />
            </label>
          ))}
          <div className="settings-note">
            {t('shortcuts')}
            <p>{t('shortcutBody')}</p>
          </div>
        </Modal>
      )}
      {dialog?.type === 'help' && (
        <Modal
          title={t('help')}
          closeLabel={t('close')}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="button" onClick={() => void window.desktop.openHelp()}>
                {t('support')}
              </button>
              <button className="button primary" onClick={() => setDialog(null)}>
                {t('close')}
              </button>
            </>
          }
        >
          <h3>{t('connectTitle')}</h3>
          <p>{t('connectBody')}</p>
          <p>{t('deviceHelp')}</p>
          <div className="settings-note">
            {t('shortcuts')}
            <p>{t('shortcutBody')}</p>
          </div>
          <details>
            <summary>{t('diagnostics')}</summary>
            <pre>{diagnostics}</pre>
          </details>
        </Modal>
      )}
      {dialog && 'device' in dialog && (
        <Modal
          title={t(
            dialog.type === 'mkdir'
              ? 'newFolder'
              : dialog.type === 'rename'
                ? 'rename'
                : 'deleteTitle',
          )}
          closeLabel={t('close')}
          onClose={() => {
            if (!submitting) setDialog(null);
          }}
          footer={
            <>
              <button className="button" disabled={submitting} onClick={() => setDialog(null)}>
                {t('cancel')}
              </button>
              <button
                className={`button ${dialog.type === 'delete' ? 'destructive' : 'primary'}`}
                disabled={submitting || (dialog.type !== 'delete' && !form.trim())}
                onClick={() => void mutation()}
              >
                {submitting ? t('loading') : t(dialog.type === 'delete' ? 'delete' : 'confirm')}
              </button>
            </>
          }
        >
          {dialog.type === 'delete' ? (
            <p>
              {t(dialog.device === 'local' ? 'deleteLocal' : 'deleteMtp')}
              <strong className="delete-count">
                {(dialog.device === 'local' ? local : mtp).selected.length} {t('items')}
              </strong>
            </p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (form.trim()) void mutation();
              }}
            >
              <label className="field-label" htmlFor="mutation-name">
                {t(dialog.type === 'mkdir' ? 'folderName' : 'newName')}
              </label>
              <input
                id="mutation-name"
                className="text-field"
                autoFocus
                value={form}
                onChange={(event) => setForm(event.target.value)}
                onFocus={(event) => event.target.select()}
              />
            </form>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {t(errorKey(formError))}
            </p>
          )}
        </Modal>
      )}
      {dialog?.type === 'overwrite' && (
        <Modal
          title={t('overwriteTitle')}
          closeLabel={t('close')}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button className="button" onClick={() => setDialog(null)}>
                {t('cancel')}
              </button>
              <button
                className="button destructive"
                disabled={transferPending}
                onClick={() => void startTransfer({ ...dialog.request, overwrite: true })}
              >
                {t('overwrite')}
              </button>
            </>
          }
        >
          <p>{t('overwriteBody')}</p>
        </Modal>
      )}
    </div>
  );
}
