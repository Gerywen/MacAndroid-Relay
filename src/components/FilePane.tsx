import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  RefreshCw,
  FolderPlus,
  FolderOpen,
  Search,
  Smartphone,
  Laptop,
  Plug,
  List,
  Grid2X2,
  ChevronRight,
} from 'lucide-react';
import type { Connection, FileNode, Preferences } from '../../shared/contracts';
import type { PaneState } from '../hooks/usePane';
import { errorKey, translate } from '../i18n';
import { date, parent, size } from '../lib';
import { FileIcon } from './FileIcon';
type Props = {
  pane: PaneState;
  preferences: Preferences;
  connection: Connection | null;
  storageId: number | null;
  disabled: boolean;
  active: boolean;
  connecting: boolean;
  onFocus: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onStorage: (id: number) => void;
  onFolder: () => void;
  onChooseFolder?: () => void;
  onOpen: (file: FileNode) => void;
  onDrop: (sources: { path: string; name: string; isFolder: boolean }[]) => void;
  onContextMenu: (file: FileNode | null, event: React.MouseEvent) => void;
  onView: (view: 'list' | 'grid') => void;
};
export function FilePane({
  pane,
  preferences,
  connection,
  storageId,
  disabled,
  active,
  connecting,
  onFocus,
  onConnect,
  onDisconnect,
  onStorage,
  onFolder,
  onChooseFolder,
  onOpen,
  onDrop,
  onContextMenu,
  onView,
}: Props) {
  const t = translate(preferences.language);
  const mtp = pane.device === 'mtp';
  const unavailable = mtp && !connection?.connected;
  const [draft, setDraft] = useState(pane.path);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState({ top: 0, height: 420, width: 420 });
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef(0);
  const previousPath = useRef(pane.path);
  useEffect(() => {
    if (previousPath.current !== pane.path) {
      previousPath.current = pane.path;
      setDraft(pane.path);
    }
  }, [pane.path]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const update = () =>
      setViewport((value) => ({
        ...value,
        height: element.clientHeight,
        width: element.clientWidth,
      }));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [unavailable]);
  const grid = preferences.view === 'grid';
  const columns = grid ? Math.max(1, Math.floor(viewport.width / 116)) : 1;
  const rowHeight = grid ? 114 : 42;
  const rows = Math.ceil(pane.visible.length / columns);
  const start = Math.max(0, Math.floor(viewport.top / rowHeight) - 3);
  const end = Math.min(rows, Math.ceil((viewport.top + viewport.height) / rowHeight) + 3);
  const visible = useMemo(
    () => pane.visible.slice(start * columns, end * columns),
    [pane.visible, start, end, columns],
  );
  useEffect(() => {
    if (!scroll.current) return;
    scroll.current.scrollTop = 0;
    setViewport((value) => ({ ...value, top: 0 }));
    const chosen = pane.visible.findIndex((file) => pane.selected.includes(file.path));
    if (chosen >= 0) scroll.current.scrollTop = Math.floor(chosen / columns) * rowHeight;
  }, [pane.path, pane.files]);
  const select = (
    file: FileNode,
    index: number,
    event: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => {
    if (event.shiftKey) {
      const low = Math.min(anchor.current, index),
        high = Math.max(anchor.current, index);
      pane.setSelected(pane.visible.slice(low, high + 1).map((file) => file.path));
    } else if (event.metaKey || event.ctrlKey) {
      pane.setSelected((value) =>
        value.includes(file.path)
          ? value.filter((path) => path !== file.path)
          : [...value, file.path],
      );
      anchor.current = index;
    } else {
      pane.setSelected([file.path]);
      anchor.current = index;
    }
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const old = pane.visible.findIndex((file) => file.path === pane.selected.at(-1));
      const index = Math.max(
        0,
        Math.min(pane.visible.length - 1, old + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      const file = pane.visible[index];
      if (!file) return;
      select(file, index, event);
      const top = Math.floor(index / columns) * rowHeight;
      if (
        scroll.current &&
        (top < scroll.current.scrollTop ||
          top + rowHeight > scroll.current.scrollTop + viewport.height)
      )
        scroll.current.scrollTop = top;
    }
    if (event.key === 'Enter' && pane.selected.length === 1) {
      const file = pane.files.find((file) => file.path === pane.selected[0]);
      if (file) onOpen(file);
    }
  };
  const drop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || unavailable) return;
    try {
      const internal = event.dataTransfer.getData('application/x-macandroid-relay');
      if (internal) {
        const payload = JSON.parse(internal) as { device: string; sources: FileNode[] };
        if (payload.device !== pane.device) onDrop(payload.sources);
        return;
      }
      if (mtp) {
        const paths = window.desktop.filePaths(Array.from(event.dataTransfer.files));
        onDrop(
          paths.map((path) => ({ path, name: path.split('/').at(-1) || '', isFolder: false })),
        );
      }
    } catch {
      /* Invalid external drag data is ignored. */
    }
  };
  return (
    <section
      className={`file-pane ${active ? 'active' : ''} ${dragging ? 'drop-target' : ''}`}
      data-pane={pane.device}
      onMouseDown={onFocus}
      onFocus={onFocus}
      onDragOver={(event) => {
        if (!disabled && !unavailable) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={drop}
      onContextMenu={(event) => onContextMenu(null, event)}
    >
      <header className="pane-header">
        <div className={`pane-device ${mtp ? 'android' : 'mac'}`}>
          {mtp ? <Smartphone size={21} /> : <Laptop size={21} />}
        </div>
        <div className="pane-heading">
          <h2>{mtp ? connection?.name || t('android') : t('myMac')}</h2>
          <span>
            {mtp
              ? connecting
                ? t('connecting')
                : connection?.connected
                  ? t('connected')
                  : t('notConnected')
              : pane.path.split('/').at(-1) || t('home')}
          </span>
        </div>
        <div className="pane-actions">
          {!mtp && onChooseFolder && (
            <button
              className="icon-button"
              title={t('chooseFolder')}
              aria-label={t('chooseFolder')}
              disabled={disabled}
              onClick={onChooseFolder}
            >
              <FolderOpen size={18} />
            </button>
          )}
          <button
            className="icon-button"
            title={t('back')}
            aria-label={t('back')}
            disabled={!pane.history.length || disabled || pane.busy}
            onClick={() => void pane.back()}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            className="icon-button"
            title={t('up')}
            aria-label={t('up')}
            disabled={unavailable || disabled || !pane.path || pane.path === '/' || pane.busy}
            onClick={() => void pane.navigate(parent(pane.path)).catch(() => undefined)}
          >
            <ArrowUp size={18} />
          </button>
          <button
            className="icon-button"
            title={t('refresh')}
            aria-label={t('refresh')}
            disabled={disabled || connecting || pane.busy}
            onClick={() => (unavailable ? onConnect() : void pane.refresh())}
          >
            <RefreshCw size={18} className={pane.busy ? 'spin' : ''} />
          </button>
          <button
            className="icon-button"
            title={t('newFolder')}
            aria-label={t('newFolder')}
            disabled={unavailable || disabled || pane.busy}
            onClick={onFolder}
          >
            <FolderPlus size={18} />
          </button>
        </div>
      </header>
      {mtp && connection?.connected && (
        <div className="storage-bar">
          <label htmlFor="device-storage">{t('storage')}</label>
          <select
            id="device-storage"
            aria-label={t('chooseStorage')}
            disabled={disabled}
            value={storageId ?? ''}
            onChange={(event) => onStorage(Number(event.target.value))}
          >
            {connection.storages.map((storage) => (
              <option key={storage.id} value={storage.id}>
                {storage.name} · {size(storage.available)} {t('free')}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            aria-label={t('reconnect')}
            title={t('reconnect')}
            disabled={disabled || connecting}
            onClick={onConnect}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon-button"
            aria-label={t('disconnect')}
            title={t('disconnect')}
            disabled={disabled || connecting}
            onClick={onDisconnect}
          >
            <Plug size={15} />
          </button>
        </div>
      )}
      <form
        className="path-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void pane
            .navigate(draft)
            .then((value) => {
              if (value) setDraft(value);
            })
            .catch(() => undefined);
        }}
      >
        <label htmlFor={`path-${pane.device}`}>{t('path')}</label>
        <input
          id={`path-${pane.device}`}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-label={`${t('path')} · ${mtp ? t('android') : t('myMac')}`}
          placeholder={t('pathPlaceholder')}
          disabled={unavailable || disabled || pane.busy}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(pane.path);
              pane.setError(null);
              event.currentTarget.blur();
            }
          }}
        />
        <ChevronRight size={15} />
      </form>
      {pane.error && !unavailable && (
        <div className="pane-error" role="alert">
          {t(errorKey(pane.error))}
          <button className="text-button" onClick={() => void pane.refresh()}>
            {t('retry')}
          </button>
          <details>
            <summary>{t('showDetails')}</summary>
            {pane.error.message}
          </details>
        </div>
      )}
      {!mtp && onChooseFolder && !pane.path ? (
        <div className="device-empty" data-folder-authorization>
          <FolderOpen size={58} strokeWidth={1.2} />
          <h3>{t('folderAccessTitle')}</h3>
          <p>{t('folderAccessBody')}</p>
          <button className="button primary" onClick={onChooseFolder}>
            {t('chooseFolder')}
          </button>
        </div>
      ) : unavailable ? (
        <div className="device-empty">
          <div className="device-art">
            <Smartphone size={58} strokeWidth={1.2} />
            <span>
              <Plug size={22} />
            </span>
          </div>
          <h3>{t('connectTitle')}</h3>
          <p>{t('connectBody')}</p>
          <button className="button primary" onClick={onConnect} disabled={connecting}>
            {connecting ? t('connecting') : t('connect')}
          </button>
          {pane.error && (
            <p className="connection-error" role="alert">
              {t(errorKey(pane.error))}
            </p>
          )}
          <small>{t('deviceHelp')}</small>
        </div>
      ) : (
        <>
          <div className="file-filter">
            <Search size={15} />
            <input
              aria-label={`${t('search')} · ${mtp ? t('android') : t('myMac')}`}
              placeholder={t('searchPlaceholder')}
              value={pane.search}
              onChange={(event) => pane.setSearch(event.target.value)}
            />
            <div className="segmented">
              <button
                title={t('list')}
                aria-label={t('list')}
                aria-pressed={!grid}
                onClick={() => onView('list')}
              >
                <List size={16} />
              </button>
              <button
                title={t('grid')}
                aria-label={t('grid')}
                aria-pressed={grid}
                onClick={() => onView('grid')}
              >
                <Grid2X2 size={16} />
              </button>
            </div>
          </div>
          {!grid && (
            <div className="list-head">
              <input
                type="checkbox"
                aria-label={t('all')}
                checked={
                  pane.visible.length > 0 &&
                  pane.visible.every((file) => pane.selected.includes(file.path))
                }
                onChange={(event) =>
                  pane.setSelected(
                    event.target.checked ? pane.visible.map((file) => file.path) : [],
                  )
                }
              />
              <span>{t('name')}</span>
              <span>{t('modified')}</span>
              <span>{t('size')}</span>
            </div>
          )}
          <div
            className={`file-scroll ${grid ? 'grid-scroll' : ''}`}
            ref={scroll}
            tabIndex={0}
            role="grid"
            aria-label={mtp ? t('android') : t('myMac')}
            aria-rowcount={pane.visible.length}
            onKeyDown={keyboard}
            onScroll={(event) => {
              const top = event.currentTarget.scrollTop;
              setViewport((value) => ({ ...value, top }));
            }}
          >
            {!pane.visible.length && !pane.busy && (
              <div className="folder-empty">{pane.search ? t('noMatches') : t('empty')}</div>
            )}
            <div
              className="virtual-content"
              style={{
                height: rows * rowHeight,
                minHeight: !pane.visible.length ? '100%' : undefined,
              }}
            >
              {visible.map((file, offset) => {
                const index = start * columns + offset;
                const chosen = pane.selected.includes(file.path);
                return (
                  <div
                    key={file.path}
                    role="row"
                    aria-rowindex={index + 1}
                    aria-selected={chosen}
                    data-file={file.name}
                    className={`file-row ${grid ? 'grid-item' : ''} ${chosen ? 'selected' : ''}`}
                    style={
                      grid
                        ? {
                            position: 'absolute',
                            top: Math.floor(index / columns) * rowHeight,
                            left: ((index % columns) * 100) / columns + '%',
                            width: 100 / columns + '%',
                            height: rowHeight,
                          }
                        : {
                            position: 'absolute',
                            top: index * rowHeight,
                            height: rowHeight,
                            width: '100%',
                          }
                    }
                    draggable={!disabled}
                    onDragStart={(event) => {
                      const sources = pane.files.filter((item) =>
                        (chosen ? pane.selected : [file.path]).includes(item.path),
                      );
                      event.dataTransfer.setData(
                        'application/x-macandroid-relay',
                        JSON.stringify({ device: pane.device, sources }),
                      );
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={(event) => select(file, index, event)}
                    onDoubleClick={() => onOpen(file)}
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      onContextMenu(file, event);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen}
                      aria-label={`${t('selected')} ${file.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() =>
                        pane.setSelected((value) =>
                          chosen
                            ? value.filter((path) => path !== file.path)
                            : [...value, file.path],
                        )
                      }
                    />
                    <span className="file-name" role="gridcell">
                      <FileIcon name={file.name} folder={file.isFolder} large={grid} />
                      <span title={file.name}>{file.name}</span>
                    </span>
                    {!grid && (
                      <>
                        <span className="file-date" role="gridcell">
                          {date(file.dateAdded, preferences.language)}
                        </span>
                        <span className="file-size" role="gridcell">
                          {size(file.isFolder ? null : file.size)}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <footer className="pane-footer">
            <span>
              {pane.visible.length} {t('items')}
              {pane.selected.length ? ` · ${pane.selected.length} ${t('selected')}` : ''}
            </span>
            {pane.busy && <span>{t('loading')}</span>}
          </footer>
        </>
      )}
      {dragging && <div className="drop-indicator">{t(mtp ? 'upload' : 'download')}</div>}
    </section>
  );
}
