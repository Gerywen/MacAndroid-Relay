import type { Failure, Reply, Language } from '../shared/contracts';
export class UiError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}
export function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UiError(reply.error);
  return reply.data;
}
export function asFailure(error: unknown): Failure {
  return error instanceof UiError ? error.failure : { code: 'IO_ERROR', message: String(error) };
}
export function size(bytes: number | null): string {
  if (bytes === null) return '—';
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const order = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** order).toFixed(order ? 1 : 0)} ${units[order]}`;
}
export function date(value: number | string, language: Language): string {
  let number = typeof value === 'number' ? value : Number(value);
  const parsed = Number.isFinite(number)
    ? new Date(number < 1e12 ? number * 1000 : number)
    : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', year: 'numeric' }).format(
        parsed,
      );
}
export function parent(path: string): string {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return '/' + parts.join('/');
}
