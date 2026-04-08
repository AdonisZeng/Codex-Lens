import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from './lib/logger.js';

const logger = createLogger('GitManager');

class GitManager {
  constructor(projectRoot, wsEmitter) {
    this.projectRoot = projectRoot;
    this.wsEmitter = wsEmitter;
    this.gitDir = join(projectRoot, '.git');
    this.currentStatus = null;
    this.currentBranch = null;
    this._statusTimeout = null;
  }

  isGitRepo() {
    return existsSync(this.gitDir);
  }

  runGitCommand(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: this.projectRoot,
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr?.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  parsePorcelainStatus(output) {
    const lines = output.trim().split('\n');
    const result = {
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: []
    };

    for (const line of lines) {
      if (!line || line.length < 3) continue;

      const indexStatus = line[0];
      const workTreeStatus = line[1];
      // git returns relative path, convert to absolute path
      const relativePath = line.slice(3).trim();
      const absolutePath = join(this.projectRoot, relativePath);

      const fileInfo = { path: absolutePath, relativePath, indexStatus, workTreeStatus };

      // Staged changes (index)
      if (indexStatus !== ' ' && indexStatus !== '?') {
        result.staged.push(fileInfo);
      }

      // Working tree changes
      if (workTreeStatus === 'M' || workTreeStatus === 'D') {
        result.unstaged.push(fileInfo);
      }

      // Untracked files
      if (indexStatus === '?' && workTreeStatus === '?') {
        result.untracked.push(fileInfo);
      }

      // Conflicted files
      if (indexStatus === 'U' || workTreeStatus === 'U') {
        result.conflicted.push(fileInfo);
      }
    }

    return result;
  }

  async getStatus() {
    if (!this.isGitRepo()) return null;

    try {
      const { stdout } = await this.runGitCommand(['status', '--porcelain']);
      this.currentStatus = this.parsePorcelainStatus(stdout);
      return this.currentStatus;
    } catch (error) {
      logger.error(`Failed to get git status: ${error.message}`);
      return null;
    }
  }

  async getCurrentBranch() {
    if (!this.isGitRepo()) return null;

    try {
      const { stdout } = await this.runGitCommand(['branch', '--show-current']);
      this.currentBranch = stdout.trim();
      return this.currentBranch;
    } catch (error) {
      logger.error(`Failed to get branch: ${error.message}`);
      return null;
    }
  }

  async stageFile(filePath) {
    await this.runGitCommand(['add', filePath]);
    return this.getStatus();
  }

  async unstageFile(filePath) {
    await this.runGitCommand(['reset', 'HEAD', '--', filePath]);
    return this.getStatus();
  }

  async stageAll() {
    await this.runGitCommand(['add', '-A']);
    return this.getStatus();
  }

  async unstageAll() {
    await this.runGitCommand(['reset', 'HEAD']);
    return this.getStatus();
  }

  async commit(message) {
    await this.runGitCommand(['commit', '-m', message]);
    return this.getStatus();
  }

  async runRemoteOperation(operation, args, successMsg) {
    const result = await this.runGitCommand(args);
    return {
      success: result.code === 0,
      message: result.code === 0 ? successMsg : (result.stderr || `${operation} 失败`),
    };
  }

  async push() { return this.runRemoteOperation('Push', ['push'], 'Push 成功'); }
  async pull() { return this.runRemoteOperation('Pull', ['pull'], 'Pull 成功'); }
  async fetch() { return this.runRemoteOperation('Fetch', ['fetch', '--all'], 'Fetch 成功'); }

  async broadcastUpdate() {
    const branch = await this.getCurrentBranch();
    const status = await this.getStatus();

    this.wsEmitter({
      type: 'git_status',
      data: {
        isRepo: true,
        branch,
        status,
        stagedCount: status?.staged?.length || 0,
        unstagedCount: (status?.unstaged?.length || 0) + (status?.untracked?.length || 0),
        timestamp: new Date().toISOString()
      }
    });
  }

  scheduleStatusUpdate() {
    if (this._statusTimeout) {
      clearTimeout(this._statusTimeout);
    }
    this._statusTimeout = setTimeout(() => {
      this.broadcastUpdate();
    }, 500);
  }
}

export function createGitManager(projectRoot, wsEmitter) {
  return new GitManager(projectRoot, wsEmitter);
}
