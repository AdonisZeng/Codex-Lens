import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import express from 'express';
import { spawn } from 'child_process';
import { createProxyServer } from './proxy.js';
import { FileWatcher, scanDirectory } from './watcher.js';
import { createLogger } from './lib/logger.js';
import { spawnCodex, writeToPty, resizePty, killPty, onPtyData, onPtyExit, getPtyState, getOutputBuffer } from './pty-manager.js';
import { createGitManager } from './git-manager.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync, writeFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HTTP_PORT = 5174;
const NPM_PACKAGE_NAME = 'codex-lens';

const logger = createLogger('Aggregator');

let latestVersion = null;
let currentVersion = null;

async function fetchLatestVersion() {
  try {
    const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);
    if (response.ok) {
      const data = await response.json();
      latestVersion = data.version;
      logger.info(`Latest ${NPM_PACKAGE_NAME} version: ${latestVersion}`);
    }
  } catch (error) {
    logger.warn(`Failed to fetch latest version: ${error.message}`);
  }
}

function getCurrentVersion() {
  if (currentVersion) return currentVersion;
  try {
    const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    currentVersion = packageJson.version;
  } catch {
    currentVersion = '0.0.0';
  }
  return currentVersion;
}

class Aggregator {
  constructor(codexBinary, projectRoot) {
    this.codexBinary = codexBinary;
    this.projectRoot = projectRoot;
    this.clients = new Set();
    this.terminalClients = new Set();
    this.httpServer = null;
    this.wss = null;
    this.proxyServer = null;
    this.fileWatcher = null;
    this.ptyProcess = null;
    this.gitManager = null;
  }

  async start(proxyPort) {
    await fetchLatestVersion();

    const app = express();
    const publicPath = path.join(__dirname, 'public');
    app.use(express.static(publicPath));

    app.use((req, res, next) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.send(this.getIndexHtml());
      } else if (req.url === '/api/status') {
        const current = getCurrentVersion();
        res.json({
          status: 'running',
          clients: this.clients.size,
          codexRunning: !!this.ptyProcess,
          version: current,
          latestVersion: latestVersion,
          hasUpdate: latestVersion && latestVersion !== current,
          projectRoot: this.projectRoot
        });
      } else {
        next();
      }
    });

    app.use(express.json());

    app.post('/api/open-in-explorer', (req, res) => {
      const { path: filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'Path is required' });
      }

      const platform = process.platform;
      let command;

      if (platform === 'win32') {
        command = 'explorer';
      } else if (platform === 'darwin') {
        command = 'open';
      } else {
        command = 'xdg-open';
      }

      spawn(command, [filePath], { detached: true, stdio: 'ignore' });
      res.json({ success: true });
    });

    app.post('/api/save-file', (req, res) => {
      const { path: filePath, content } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      if (content === undefined) {
        return res.status(400).json({ error: 'Content is required' });
      }

      try {
        writeFileSync(filePath, content, 'utf-8');
        logger.info(`File saved: ${filePath}`);
        res.json({ success: true, path: filePath });
      } catch (error) {
        logger.error(`Failed to save file: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });

    await new Promise((resolve) => {
      this.httpServer = createServer(app);

      this.httpServer.on('upgrade', (req, socket, head) => {
        const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
        logger.info(`Upgrade: ${pathname}`);
        if (pathname === '/ws/terminal') {
          this.handleTerminalUpgrade(req, socket, head);
        } else if (pathname === '/ws') {
          this.wss.handleUpgrade(req, socket, head, (ws) => {
            this.wss.emit('connection', ws, req);
          });
        } else {
          socket.destroy();
        }
      });

      this.httpServer.listen(HTTP_PORT, () => {
        logger.info(`HTTP server started on port ${HTTP_PORT}`);
        resolve();
      });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.setupMainWebSocket();

    this.proxyServer = createProxyServer((event) => this.broadcast(event), proxyPort);
    await this.proxyServer.start();

    this.fileWatcher = new FileWatcher(this.projectRoot, (event) => this.broadcast(event));
    await this.fileWatcher.start();

    // Initialize Git Manager
    this.gitManager = createGitManager(this.projectRoot, (event) => this.broadcast(event));
    if (this.gitManager.isGitRepo()) {
      await this.gitManager.broadcastUpdate();
      logger.info('Git repository detected, git status broadcasting enabled');
      // Set up git status update trigger on file changes
      this.fileWatcher.setGitStatusCallback((filePath) => {
        if (this.gitManager?.isGitRepo()) {
          this.gitManager.scheduleStatusUpdate();
        }
      });
    }

    await this.startCodex(proxyPort);

    return { httpPort: HTTP_PORT, proxyPort };
  }

  setupMainWebSocket() {
    this.wss.on('connection', async (ws) => {
      logger.info('API client connected');
      this.clients.add(ws);

      const fileTree = scanDirectory(this.projectRoot);
      logger.info(`Sending file_tree with ${fileTree.length} top-level items`);
      ws.send(JSON.stringify({ type: 'file_tree', data: fileTree }));

      // Send initial git status if available
      if (this.gitManager?.isGitRepo()) {
        await this.gitManager.broadcastUpdate();
      }

      ws.on('close', () => {
        logger.info('API client disconnected');
        this.clients.delete(ws);
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(data, ws);
        } catch (e) {
          logger.error(`Invalid message: ${e.message}`);
        }
      });
    });
  }

  async startCodex(proxyPort) {
    this.ptyProcess = await spawnCodex(this.codexBinary, this.projectRoot, proxyPort);
    logger.info(`Codex PTY spawned with PID: ${this.ptyProcess.pid}`);

    onPtyData((data) => {
      this.broadcastToTerminal({ type: 'data', data });
    });

    onPtyExit((exitCode) => {
      logger.info(`Codex PTY exited with code: ${exitCode}`);
      this.broadcastToTerminal({ type: 'exit', exitCode });
    });
  }

  handleTerminalUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      logger.info('Terminal WebSocket connected');
      this.handleTerminalConnection(ws);
    });
  }

  handleTerminalConnection(ws) {
    this.terminalClients.add(ws);
    logger.info(`Terminal client connected. Total: ${this.terminalClients.size}`);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input') {
          writeToPty(msg.data);
        } else if (msg.type === 'resize') {
          resizePty(msg.cols || 120, msg.rows || 30);
        }
      } catch (e) {
        logger.error(`Terminal message error: ${e.message}`);
      }
    });

    ws.on('close', () => {
      this.terminalClients.delete(ws);
      logger.info(`Terminal client disconnected. Total: ${this.terminalClients.size}`);
    });

    const state = getPtyState();
    ws.send(JSON.stringify({ type: 'state', ...state }));

    const bufferedOutput = getOutputBuffer();
    if (bufferedOutput) {
      ws.send(JSON.stringify({ type: 'data', data: bufferedOutput }));
    }
  }

  broadcastToTerminal(event) {
    const message = JSON.stringify(event);
    for (const client of this.terminalClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  async handleClientMessage(data, ws) {
    if (data.type === 'user_message') {
      writeToPty(data.data + '\r');
    } else if (data.type === 'open_file') {
      const result = this.fileWatcher.readFile(data.data);
      if (result.error) {
        ws.send(JSON.stringify({ type: 'error', message: result.error }));
      } else {
        const extension = path.extname(result.path);
        ws.send(JSON.stringify({
          type: 'file_content',
          data: {
            path: result.path,
            content: result.content,
            extension
          }
        }));
      }
    } else if (data.type === 'git_status_request') {
      if (this.gitManager?.isGitRepo()) {
        this.gitManager.broadcastUpdate();
      }
    } else if (data.type === 'git_stage') {
      if (this.gitManager?.isGitRepo()) {
        if (data.filePath) {
          await this.gitManager.stageFile(data.filePath);
        } else {
          await this.gitManager.stageAll();
        }
        this.gitManager.broadcastUpdate();
      }
    } else if (data.type === 'git_unstage') {
      if (this.gitManager?.isGitRepo()) {
        if (data.filePath) {
          await this.gitManager.unstageFile(data.filePath);
        } else {
          await this.gitManager.unstageAll();
        }
        this.gitManager.broadcastUpdate();
      }
    } else if (data.type === 'git_commit') {
      if (this.gitManager?.isGitRepo()) {
        await this.gitManager.commit(data.message);
        this.gitManager.broadcastUpdate();
      }
    }
  }

  broadcast(event) {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getIndexHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codex Lens</title>
  <link rel="stylesheet" href="/lib/xterm/xterm.css">
  <style>
    :root {
      --bg-primary: #1e1e1e;
      --bg-secondary: #252526;
      --bg-tertiary: #2d2d30;
      --text-primary: #cccccc;
      --text-secondary: #858585;
      --border-color: #3c3c3c;
      --accent-color: #007acc;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root { height: 100%; width: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg-primary); color: var(--text-primary); }
    .app { display: flex; height: 100vh; }
    .panel { display: flex; flex-direction: column; border-right: 1px solid var(--border-color); overflow: hidden; }
    .panel:last-child { border-right: none; }
    .panel-header { padding: 8px 12px; background: var(--bg-tertiary); border-bottom: 1px solid var(--border-color); font-weight: 600; font-size: 12px; text-transform: uppercase; color: var(--text-secondary); }
    .panel-content { flex: 1; overflow: auto; padding: 8px; }
    .file-tree .item { padding: 4px 8px; cursor: pointer; border-radius: 3px; display: flex; align-items: center; gap: 6px; }
    .file-tree .item:hover { background: var(--bg-tertiary); }
    .diff-line { font-family: 'SF Mono', Consolas, monospace; font-size: 13px; padding: 2px 12px; white-space: pre; }
    .diff-line.added { background: #2d4a2d; color: #89d185; }
    .diff-line.removed { background: #5a2d2d; color: #f48771; }
    .diff-line::before { display: inline-block; width: 16px; margin-right: 8px; text-align: center; font-weight: bold; }
    .diff-line.added::before { content: '+'; }
    .diff-line.removed::before { content: '-'; }
    .terminal-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .terminal-container { flex: 1; padding: 8px; overflow: hidden; background: #1e1e1e; }
    .terminal-toolbar { display: flex; gap: 4px; padding: 8px; background: #252526; border-top: 1px solid var(--border-color); flex-wrap: wrap; }
    .terminal-btn { padding: 4px 8px; background: #2d2d30; border: 1px solid #3c3c3c; border-radius: 3px; color: #cccccc; cursor: pointer; font-size: 12px; }
    .terminal-btn:hover { background: #3c3c3c; }
    .left-panel { width: 250px; min-width: 200px; }
    .middle-panel { flex: 1; min-width: 400px; }
    .right-panel { width: 45%; min-width: 350px; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); }
  </style>
</head>
<body>
  <div id="root">
    <div class="app">
      <div class="panel left-panel">
        <div class="panel-header">File Explorer</div>
        <div class="panel-content" id="fileTree">
          <div class="loading">Waiting for file changes...</div>
        </div>
      </div>
      <div class="panel middle-panel">
        <div class="panel-header" id="fileHeader">File Content</div>
        <div class="panel-content" id="codeContent">
          <div class="loading">Select a file to view diff...</div>
        </div>
      </div>
      <div class="panel right-panel">
        <div class="panel-header">Terminal</div>
        <div class="terminal-wrapper">
          <div class="terminal-container" id="terminalContainer"></div>
          <div class="terminal-toolbar">
            <button class="terminal-btn" onclick="sendKey('\\x1b[A')">Up</button>
            <button class="terminal-btn" onclick="sendKey('\\x1b[B')">Down</button>
            <button class="terminal-btn" onclick="sendKey('\\x1b[D')">Left</button>
            <button class="terminal-btn" onclick="sendKey('\\x1b[C')">Right</button>
            <button class="terminal-btn" onclick="sendKey('\\r')">Enter</button>
            <button class="terminal-btn" onclick="sendKey('\\t')">Tab</button>
            <button class="terminal-btn" onclick="sendKey('\\x03')">Ctrl+C</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script src="/lib/xterm/xterm.js"></script>
  <script src="/lib/xterm/addon-fit.js"></script>
  <script src="/lib/xterm/addon-web-links.js"></script>
  <script>
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SF Mono", "Fira Code", Consolas, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(document.getElementById('terminalContainer'));
    term.write('Connecting to Codex...\r\n');

    const wsHost = window.location.hostname;
    let terminalWs = null;

    function connectTerminal() {
      const port = window.location.port === '5173' ? '5174' : window.location.port;
      terminalWs = new WebSocket('ws://' + wsHost + ':' + port + '/ws/terminal');

      terminalWs.onopen = () => {
        term.write('\r\n\x1b[32mConnected to Codex!\x1b[0m\r\n');
      };

      terminalWs.onclose = () => {
        term.write('\r\n\x1b[33mDisconnected, reconnecting...\x1b[0m\r\n');
        setTimeout(connectTerminal, 3000);
      };

      terminalWs.onerror = (e) => {
        term.write('\r\n\x1b[31mWebSocket Error\x1b[0m\r\n');
      };

      terminalWs.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write('\r\n\x1b[31m[Process exited with code ' + msg.exitCode + ']\x1b[0m\r\n');
        }
      };
    }

    connectTerminal();

    term.onData((data) => {
      if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
        terminalWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    window.sendKey = function(seq) {
      if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
        terminalWs.send(JSON.stringify({ type: 'input', data: seq }));
      }
      term.write(seq);
    };

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && terminalWs && terminalWs.readyState === WebSocket.OPEN) {
          terminalWs.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch (e) {}
    });
    resizeObserver.observe(document.getElementById('terminalContainer'));

    let apiWs = null;
    const fileTree = document.getElementById('fileTree');
    const codeContent = document.getElementById('codeContent');
    let recentChanges = [];

    const port = window.location.port === '5173' ? '5174' : window.location.port;
    apiWs = new WebSocket('ws://' + wsHost + ':' + port + '/ws');

    apiWs.onopen = () => console.log('[API] Connected');
    apiWs.onclose = () => {
      setTimeout(() => { apiWs = new WebSocket('ws://' + wsHost + ':' + port + '/ws'); }, 3000);
    };

    apiWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'file_change') {
        recentChanges.unshift({ path: msg.data.path, time: Date.now(), diff: msg.data.diff, content: msg.data.newContent });
        if (recentChanges.length > 10) recentChanges.pop();
        renderRecentChanges();
      }
    };

    function renderRecentChanges() {
      let html = '<div style="padding:8px;font-size:11px;color:var(--text-secondary);border-bottom:1px solid var(--border-color)">RECENT CHANGES</div>';
      recentChanges.forEach((c, i) => {
        const fileName = c.path.split(/[/\\\\]/).pop();
        const time = new Date(c.time).toLocaleTimeString();
        html += '<div class="item" onclick="openFile(' + i + ')">' +
                '<span>📝</span><span style="flex:1">' + fileName + '</span><span style="font-size:10px;color:#858585">' + time + '</span>' +
                '</div>';
      });
      if (recentChanges.length === 0) {
        html += '<div style="padding:20px;color:#858585;text-align:center">No changes yet</div>';
      }
      fileTree.innerHTML = html;
    }

    window.openFile = function(index) {
      const change = recentChanges[index];
      if (change.diff && change.diff.some(d => d.added || d.removed)) {
        codeContent.innerHTML = change.diff.map(line =>
          '<div class="diff-line ' + (line.added ? 'added' : line.removed ? 'removed' : '') + '">' +
          escapeHtml(line.content) + '</div>'
        ).join('');
      } else {
        codeContent.innerHTML = '<pre style="padding:8px;white-space:pre-wrap">' + escapeHtml(change.content) + '</pre>';
      }
    };

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    renderRecentChanges();
  </script>
</body>
</html>`;
  }

  stop() {
    if (this.fileWatcher) this.fileWatcher.stop();
    if (this.proxyServer) this.proxyServer.stop();
    killPty();
    if (this.wss) this.wss.close();
    if (this.httpServer) this.httpServer.close();
    logger.info('All services stopped');
  }
}

export function createAggregator(codexBinary, projectRoot) {
  return new Aggregator(codexBinary, projectRoot);
}
