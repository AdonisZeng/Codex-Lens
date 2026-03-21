import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { platform, arch, homedir } from 'node:os';
import { chmodSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ptyProcess = null;
let dataListeners = [];
let exitListeners = [];
let lastExitCode = null;
let outputBuffer = '';
let lastPtyCols = 120;
let lastPtyRows = 30;
const MAX_BUFFER = 200000;
let batchBuffer = '';
let batchScheduled = false;

async function getPty() {
  const ptyMod = await import('node-pty');
  return ptyMod.default || ptyMod;
}

function findSafeSliceStart(buf, rawStart) {
  const scanLimit = Math.min(rawStart + 64, buf.length);
  let i = rawStart;
  while (i < scanLimit) {
    const ch = buf.charCodeAt(i);
    if (ch === 0x1b) {
      let j = i + 1;
      while (j < scanLimit && !((buf.charCodeAt(j) >= 0x40 && buf.charCodeAt(j) <= 0x7e) && j > i + 1)) {
        j++;
      }
      if (j < scanLimit) {
        return j + 1;
      }
      i = j;
      continue;
    }
    if ((ch >= 0x20 && ch <= 0x3f)) {
      i++;
      continue;
    }
    break;
  }
  return i < buf.length ? i : rawStart;
}

function flushBatch() {
  batchScheduled = false;
  if (!batchBuffer) return;
  const chunk = batchBuffer;
  batchBuffer = '';
  for (const cb of dataListeners) {
    try { cb(chunk); } catch { }
  }
}

function fixSpawnHelperPermissions() {
  try {
    const os = platform();
    const cpu = arch();
    const helperPath = join(__dirname, 'node_modules', 'node-pty', 'prebuilds', `${os}-${cpu}`, 'spawn-helper');
    const stat = statSync(helperPath);
    if (!(stat.mode & 0o111)) {
      chmodSync(helperPath, stat.mode | 0o755);
    }
  } catch { }
}

function setupCodexConfig(proxyPort) {
  const codexDir = join(homedir(), '.codex');
  const configPath = join(codexDir, 'config.toml');

  if (!existsSync(codexDir)) {
    mkdirSync(codexDir, { recursive: true });
  }

  let config = '';
  if (existsSync(configPath)) {
    config = readFileSync(configPath, 'utf-8');
  }

  const baseUrl = `http://127.0.0.1:${proxyPort}`;
  const configLine = `openai_base_url = "${baseUrl}"`;

  if (config.includes('openai_base_url')) {
    config = config.replace(/openai_base_url\s*=\s*"[^"]*"/, configLine);
  } else {
    config = config.trimEnd() + '\n' + configLine + '\n';
  }

  writeFileSync(configPath, config);
}

export async function spawnCodex(codexBinary, projectRoot, proxyPort) {
  if (ptyProcess) {
    killPty();
  }

  const pty = await getPty();

  fixSpawnHelperPermissions();
  setupCodexConfig(proxyPort);

  const shell = platform() === 'win32' ? 'powershell.exe' : 'bash';
  const args = platform() === 'win32'
    ? ['-NoExit', '-Command', `Set-Location "${projectRoot}"; & "${codexBinary}"`]
    : [];

  const env = { ...process.env };
  if (platform() === 'win32') {
    env.WINPTY = '1';
  }

  lastExitCode = null;
  outputBuffer = '';

  ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: lastPtyCols,
    rows: lastPtyRows,
    cwd: projectRoot,
    env,
    useConpty: false,
  });

  ptyProcess.onData((data) => {
    outputBuffer += data;
    if (outputBuffer.length > MAX_BUFFER) {
      const rawStart = outputBuffer.length - MAX_BUFFER;
      const safeStart = findSafeSliceStart(outputBuffer, rawStart);
      outputBuffer = outputBuffer.slice(safeStart);
    }
    batchBuffer += data;
    if (!batchScheduled) {
      batchScheduled = true;
      setImmediate(flushBatch);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    flushBatch();
    lastExitCode = exitCode;
    ptyProcess = null;
    for (const cb of exitListeners) {
      try { cb(exitCode); } catch { }
    }
  });

  return ptyProcess;
}

export function writeToPty(data) {
  if (ptyProcess) {
    ptyProcess.write(data);
    return true;
  }
  return false;
}

export function resizePty(cols, rows) {
  lastPtyCols = cols;
  lastPtyRows = rows;
  if (ptyProcess) {
    try { ptyProcess.resize(cols, rows); } catch { }
  }
}

export function killPty() {
  if (ptyProcess) {
    flushBatch();
    batchBuffer = '';
    batchScheduled = false;
    try { ptyProcess.kill(); } catch { }
    ptyProcess = null;
  }
}

export function onPtyData(cb) {
  dataListeners.push(cb);
  return () => {
    dataListeners = dataListeners.filter(l => l !== cb);
  };
}

export function onPtyExit(cb) {
  exitListeners.push(cb);
  return () => {
    exitListeners = exitListeners.filter(l => l !== cb);
  };
}

export function getPtyPid() {
  return ptyProcess ? ptyProcess.pid : null;
}

export function getPtyState() {
  return {
    running: !!ptyProcess,
    exitCode: lastExitCode,
  };
}

export function getOutputBuffer() {
  return outputBuffer;
}