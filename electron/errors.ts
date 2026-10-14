import type { ErrorCode, Failure, Reply } from '../shared/contracts';
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export function failure(error: unknown): Failure {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  const code = (error as NodeJS.ErrnoException)?.code;
  return {
    code:
      code === 'ENOENT'
        ? 'NOT_FOUND'
        : code === 'EACCES' || code === 'EPERM'
          ? 'PERMISSION'
          : 'IO_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}
export async function reply<T>(operation: () => T | Promise<T>): Promise<Reply<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
}
export function string(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new AppError('INVALID_PATH', 'Invalid path');
}
export function filename(value: unknown): asserts value is string {
  string(value);
  if (value === '.' || value === '..' || /[/\\]/.test(value))
    throw new AppError('INVALID_PATH', 'Invalid filename');
}
