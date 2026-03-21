import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const DEFAULT_LOG_DIR = join(homedir(), '.codex-lens');

export class LogManager {
  constructor(logDir = DEFAULT_LOG_DIR) {
    this.logDir = logDir;
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFilePath(projectName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(this.logDir, `${projectName}_${timestamp}.jsonl`);
  }

  appendEntry(logFile, entry) {
    try {
      const dir = dirname(logFile);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(logFile, JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('[LogManager] Failed to append entry:', error.message);
    }
  }

  readLogFile(logFile) {
    if (!existsSync(logFile)) {
      return [];
    }

    try {
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch (error) {
      console.error('[LogManager] Failed to read log file:', error.message);
      return [];
    }
  }

  listLogFiles(projectName) {
    try {
      if (!existsSync(this.logDir)) {
        return [];
      }

      const files = readdirSync(this.logDir)
        .filter(f => f.startsWith(projectName + '_') && f.endsWith('.jsonl'))
        .map(f => {
          const stats = statSync(join(this.logDir, f));
          return {
            name: f,
            path: join(this.logDir, f),
            size: stats.size,
            modified: stats.mtime
          };
        })
        .sort((a, b) => b.modified - a.modified);

      return files;
    } catch (error) {
      console.error('[LogManager] Failed to list log files:', error.message);
      return [];
    }
  }

  deleteOldLogs(projectName, keepCount = 10) {
    try {
      const files = this.listLogFiles(projectName);
      const toDelete = files.slice(keepCount);

      for (const file of toDelete) {
        unlinkSync(file.path);
        console.log(`[LogManager] Deleted old log: ${file.name}`);
      }
    } catch (error) {
      console.error('[LogManager] Failed to delete old logs:', error.message);
    }
  }

  getRecentLog(projectName) {
    const files = this.listLogFiles(projectName);
    if (files.length > 0) {
      return files[0];
    }
    return null;
  }

  writeSessionMeta(logFile, meta) {
    this.appendEntry(logFile, {
      type: 'session_meta',
      timestamp: new Date().toISOString(),
      ...meta
    });
  }

  writeApiRequest(logFile, request) {
    this.appendEntry(logFile, {
      type: 'api_request',
      timestamp: new Date().toISOString(),
      ...request
    });
  }

  writeApiResponse(logFile, response) {
    this.appendEntry(logFile, {
      type: 'api_response',
      timestamp: new Date().toISOString(),
      ...response
    });
  }

  writeFileChange(logFile, change) {
    this.appendEntry(logFile, {
      type: 'file_change',
      timestamp: new Date().toISOString(),
      ...change
    });
  }
}

export function createLogManager(logDir) {
  return new LogManager(logDir);
}
