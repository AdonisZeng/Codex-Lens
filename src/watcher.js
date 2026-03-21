import chokidar from 'chokidar';
import { readFileSync, statSync, readdirSync } from 'fs';
import { diffLines } from 'diff';
import { extname, basename, join, relative } from 'path';
import { createLogger } from './lib/logger.js';

const logger = createLogger('Watcher');

const IGNORED_DIRS = [
  'node_modules', '.git', '.svn', '.hg',
  '.idea', '.vscode', 'dist', 'build', '.cache',
  '__pycache__', '.pytest_cache', '.next', '.nuxt',
  '.venv', '.env', '.DS_Store'
];

const IGNORED_FILES = [
  '.DS_Store', 'Thumbs.db', 'desktop.ini'
];

export function scanDirectory(projectPath, relativeTo = null) {
  const result = [];

  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(projectPath, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.includes(entry.name)) continue;

        const children = scanDirectory(fullPath, relativeTo);
        if (children.length > 0 || !IGNORED_DIRS.includes(entry.name)) {
          result.push({
            name: entry.name,
            path: relativeTo ? relative(relativeTo, fullPath) : fullPath,
            type: 'directory',
            children: children
          });
        }
      } else if (entry.isFile()) {
        if (IGNORED_FILES.includes(entry.name)) continue;
        if (entry.name.endsWith('.log')) continue;

        result.push({
          name: entry.name,
          path: relativeTo ? relative(relativeTo, fullPath) : fullPath,
          type: 'file'
        });
      }
    }

    result.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  } catch (error) {
    logger.error(`Error scanning directory ${projectPath}: ${error.message}`);
  }

  return result;
}

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json',
  '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.swift', '.kt', '.scala',
  '.html', '.css', '.scss', '.less',
  '.md', '.yaml', '.yml', '.toml',
  '.sh', '.bash', '.zsh', '.ps1',
  '.sql', '.xml', '.vue', '.svelte'
]);

class FileWatcher {
  constructor(projectPath, wsEmitter) {
    this.projectPath = projectPath;
    this.wsEmitter = wsEmitter;
    this.watcher = null;
    this.fileContents = new Map();
  }

  async start() {
    const ignored = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.cache/**',
      '**/__pycache__/**',
      '**/.*/**'
    ].concat(IGNORED_DIRS.map(d => `**/${d}/**`));

    logger.info(`Starting file watcher on: ${this.projectPath}`);

    this.watcher = chokidar.watch(this.projectPath, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    this.watcher.on('add', (filePath) => this.handleChange(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.handleChange(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.handleUnlink(filePath));
    this.watcher.on('error', (error) => logger.errorWithStack('Watcher error:', error));

    logger.info('File watcher started successfully');

    return this.projectPath;
  }

  handleChange(filePath, eventType) {
    try {
      const isCode = this.isCodeFile(filePath);

      if (eventType === 'add') {
        logger.info(`File added: ${filePath}`);
        this.emitFileTreeUpdate();
      } else {
        logger.info(`File changed: ${filePath}`);
      }

      if (!isCode) return;

      const stats = statSync(filePath);
      if (stats.size > 5 * 1024 * 1024) {
        logger.warn(`Skipping large file: ${filePath}`);
        return;
      }

      const newContent = readFileSync(filePath, 'utf-8');
      const oldContent = this.fileContents.get(filePath) || '';

      this.fileContents.set(filePath, newContent);

      if (eventType === 'add') {
        const lines = newContent.split('\n');
        const diff = lines.map(line => ({ content: line, added: true }));
        this.emitFileChange(filePath, newContent, diff);
      } else {
        const changes = diffLines(oldContent, newContent);
        const diff = [];

        for (const change of changes) {
          const lines = change.value.split('\n').filter(l => l !== '');
          for (const line of lines) {
            diff.push({
              content: line,
              added: change.added,
              removed: change.removed
            });
          }
        }

        this.emitFileChange(filePath, newContent, diff);
      }
    } catch (error) {
      logger.errorWithStack(`Error handling file change: ${filePath}`, error);
    }
  }

  handleUnlink(filePath) {
    this.fileContents.delete(filePath);
    logger.info(`File deleted: ${filePath}`);
    this.wsEmitter({
      type: 'file_delete',
      data: {
        path: filePath,
        timestamp: new Date().toISOString()
      }
    });
    this.emitFileTreeUpdate();
  }

  emitFileChange(filePath, newContent, diff) {
    this.wsEmitter({
      type: 'file_change',
      data: {
        path: filePath,
        fileName: basename(filePath),
        extension: extname(filePath),
        newContent,
        diff,
        timestamp: new Date().toISOString()
      }
    });
  }

  emitFileTreeUpdate() {
    const fileTree = scanDirectory(this.projectPath);
    this.wsEmitter({
      type: 'file_tree',
      data: fileTree
    });
  }

  isCodeFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    return CODE_EXTENSIONS.has(ext);
  }

  readFile(filePath) {
    try {
      const stats = statSync(filePath);
      if (stats.size > 5 * 1024 * 1024) {
        return { error: 'File too large' };
      }
      const content = readFileSync(filePath, 'utf-8');
      return { content, path: filePath };
    } catch (error) {
      return { error: error.message };
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      logger.info('File watcher stopped');
    }
  }
}

export function createFileWatcher(projectPath, wsEmitter) {
  return new FileWatcher(projectPath, wsEmitter);
}

export { FileWatcher };
