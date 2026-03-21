import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_DIR = resolve(__dirname, '../../logs');

const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let sharedLogFile = null;
let sharedInitDone = false;

class Logger {
  constructor(moduleName, level = 'INFO') {
    this.moduleName = moduleName;
    this.level = LEVELS[level] ?? LEVELS.INFO;
  }

  init() {
    if (!sharedInitDone) {
      if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
      }

      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      sharedLogFile = join(LOG_DIR, `${timestamp}.txt`);

      appendFileSync(sharedLogFile, `\n========== Session Started: ${now.toISOString()} ==========\n`);
      sharedInitDone = true;
    }
  }

  _format(level, message) {
    const now = new Date();
    const timestamp = now.toISOString();
    return `[${timestamp}] [${level}] [${this.moduleName}] ${message}`;
  }

  _write(level, message) {
    if (LEVELS[level] < this.level) return;

    const formatted = this._format(level, message);

    console.log(formatted);

    if (sharedLogFile) {
      try {
        appendFileSync(sharedLogFile, formatted + '\n');
      } catch (e) {
        console.error('Failed to write to log file:', e);
      }
    }
  }

  debug(message) {
    this._write('DEBUG', message);
  }

  info(message) {
    this._write('INFO', message);
  }

  warn(message) {
    this._write('WARN', message);
  }

  error(message) {
    this._write('ERROR', message);
  }

  errorWithStack(message, error) {
    const stack = error?.stack || error?.message || error || '';
    this._write('ERROR', `${message}\n  ${stack}`);
  }
}

export function createLogger(moduleName, level = 'INFO') {
  const logger = new Logger(moduleName, level);
  logger.init();
  return logger;
}
