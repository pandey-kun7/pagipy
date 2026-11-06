export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  pageId?: string;
  runId?: string;
  versionId?: string;
  jobId?: string;
  monitorExternalId?: string;
  integration?: string;
  elapsedMs?: number;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  'authorization',
  'api_key',
  'apikey',
  'secret',
  'password',
  'token',
  'tinyfish_api_key',
  'gemma_api_key',
  'webhook_secret',
]);

export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

class StructuredLogger {
  private formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context ? (redactSensitiveData(context) as Record<string, unknown>) : {}),
    };
    return JSON.stringify(entry);
  }

  debug(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === 'test' && !process.env.DEBUG_LOGS) return;
    console.debug(this.formatLog('debug', message, context));
  }

  info(message: string, context?: LogContext): void {
    if (process.env.NODE_ENV === 'test' && !process.env.DEBUG_LOGS) return;
    console.info(this.formatLog('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatLog('warn', message, context));
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    const errObj = error instanceof Error
      ? { errorMessage: error.message, errorStack: error.stack }
      : { errorMessage: String(error) };

    console.error(this.formatLog('error', message, { ...context, ...errObj }));
  }
}

export const logger = new StructuredLogger();
