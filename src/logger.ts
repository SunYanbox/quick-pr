import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_DIR = '.quick-pr';
const LOG_FILE = 'log.log';

let _workspaceRoot: string | null = null;
let _logStream: fs.WriteStream | null = null;

function ensureLogDir(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, LOG_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLogStream(workspaceRoot: string): fs.WriteStream {
  if (_logStream && _workspaceRoot === workspaceRoot) {
    return _logStream;
  }

  if (_logStream) {
    _logStream.end();
  }

  const dir = ensureLogDir(workspaceRoot);
  const logPath = path.join(dir, LOG_FILE);
  _workspaceRoot = workspaceRoot;
  _logStream = fs.createWriteStream(logPath, { flags: 'a' });
  return _logStream;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatContext(ctx?: Record<string, unknown>): string {
  if (!ctx || Object.keys(ctx).length === 0) return '';

  const lines: string[] = [];
  for (const [key, value] of Object.entries(ctx)) {
    const str = typeof value === 'object' ? safeStringify(value) : String(value);
    // Truncate long values
    const truncated = str.length > 500 ? str.slice(0, 500) + '...' : str;
    lines.push(`  ${key}: ${truncated}`);
  }
  return '\n' + lines.join('\n');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    let result = `  Stack: ${err.stack || err.message}`;
    // Include stderr from child_process.exec failures
    const stderr = (err as { stderr?: string | Buffer }).stderr;
    if (stderr) {
      result += `\n  stderr: ${stderr.toString().trim()}`;
    }
    return result;
  }
  return `  Error: ${String(err)}`;
}

function write(level: LogLevel, tag: string, message: string, context?: Record<string, unknown>, error?: unknown): void {
  const line = `[${timestamp()}] [${level}] [${tag}] ${message}${formatContext(context)}${error ? '\n' + formatError(error) : ''}\n`;

  // Always write to file
  if (_workspaceRoot) {
    try {
      getLogStream(_workspaceRoot).write(line);
    } catch {
      // If logger itself fails, fall back to console
      console.error('Logger write failed:', line);
    }
  }

  // ERROR level also goes to console.error
  if (level === 'ERROR') {
    console.error(line.trim());
  } else if (level === 'WARN') {
    console.warn(line.trim());
  } else {
    console.log(line.trim());
  }
}

export function initLogger(workspaceRoot: string): void {
  _workspaceRoot = workspaceRoot;
  ensureLogDir(workspaceRoot);
  info('[Logger]', 'Logger initialized', { logFile: path.join(workspaceRoot, LOG_DIR, LOG_FILE) });
}

export function info(tag: string, message: string, context?: Record<string, unknown>): void {
  write('INFO', tag, message, context);
}

export function warn(tag: string, message: string, context?: Record<string, unknown>): void {
  write('WARN', tag, message, context);
}

export function error(tag: string, message: string, context?: Record<string, unknown>, err?: unknown): void {
  write('ERROR', tag, message, context, err);
}

export function debug(tag: string, message: string, context?: Record<string, unknown>): void {
  write('DEBUG', tag, message, context);
}
