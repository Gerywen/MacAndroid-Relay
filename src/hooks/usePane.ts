import { useCallback, useMemo, useRef, useState } from 'react';
import type { Device, Failure, FileNode, Preferences } from '../../shared/contracts';
import { asFailure, unwrap } from '../lib';
export function usePane(device: Device, preferences: Preferences, storageId: number | null) {
  const [path, setPath] = useState(device === 'local' ? '' : '/');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [search, setSearch] = useState('');
  const sequence = useRef(0);
  const current = useRef(path);
  current.current = path;
  const navigate = useCallback(
    async (input: string, remember = true) => {
      const request = ++sequence.current;
      setBusy(true);
      setError(null);
      try {
        const value = unwrap(
          await window.desktop.navigate({
            device,
            path: input,
            currentPath: current.current || '/',
            storageId,
            showHidden: preferences.showHidden,
          }),
        );
        if (request !== sequence.current) return;
        const previous = current.current;
        if (remember && previous && previous !== value.path)
          setHistory((history) => [...history.slice(-49), previous]);
        current.current = value.path;
        setPath(value.path);
        setFiles(value.files);
        setSelected(value.selected);
        setSearch('');
        return value.path;
      } catch (error) {
        if (request === sequence.current) setError(asFailure(error));
        throw error;
      } finally {
        if (request === sequence.current) setBusy(false);
      }
    },
    [device, storageId, preferences.showHidden],
  );
  const refresh = useCallback(
    () => navigate(current.current || '/', false).catch(() => undefined),
    [navigate],
  );
  const back = async () => {
    const previous = history.at(-1);
    if (!previous) return;
    try {
      await navigate(previous, false);
      setHistory((history) => history.slice(0, -1));
    } catch {
      /* Preserve the current location on failure. */
    }
  };
  const visible = useMemo(
    () =>
      files
        .filter((file) => file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
        .sort((a, b) =>
          preferences.directoriesFirst && a.isFolder !== b.isFolder
            ? Number(b.isFolder) - Number(a.isFolder)
            : a.name.localeCompare(b.name, preferences.language, { numeric: true }),
        ),
    [files, search, preferences.directoriesFirst, preferences.language],
  );
  const reset = () => {
    sequence.current += 1;
    setFiles([]);
    setSelected([]);
    current.current = '/';
    setPath('/');
    setError(null);
    setBusy(false);
    setHistory([]);
  };
  return {
    device,
    path,
    files,
    visible,
    selected,
    setSelected,
    history,
    busy,
    error,
    setError,
    search,
    setSearch,
    navigate,
    refresh,
    back,
    reset,
  };
}
export type PaneState = ReturnType<typeof usePane>;
