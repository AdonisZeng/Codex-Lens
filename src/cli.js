import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { createAggregator } from './aggregator.js';
import { createLogger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_PORT = 8080;

const logger = createLogger('CLI');

async function findCodexBinary() {
  const { execSync } = await import('child_process');

  logger.debug('Searching for Codex binary...');

  const candidates = [
    'D:\\Software\\npm\\codex.cmd',
    'C:\\Program Files\\nodejs\\codex.cmd',
    join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      logger.info(`Found Codex at: ${candidate}`);
      return candidate;
    }
  }

  try {
    const result = execSync('where codex', { encoding: 'utf-8' });
    const lines = result.trim().split('\n');
    if (lines.length > 0) {
      logger.info(`Found Codex in PATH: ${lines[0].trim()}`);
      return lines[0].trim();
    }
  } catch {}

  logger.warn('Codex not found, using "codex" command');
  return 'codex';
}

function findProjectRoot() {
  let cwd = process.cwd();

  while (cwd !== dirname(cwd)) {
    if (existsSync(join(cwd, 'package.json')) ||
        existsSync(join(cwd, '.git')) ||
        existsSync(join(cwd, 'src'))) {
      return cwd;
    }
    cwd = dirname(cwd);
  }

  return process.cwd();
}

async function main() {
  logger.info('========================================');
  logger.info('   Codex Lens Starting');
  logger.info('========================================');

  const projectRoot = findProjectRoot();
  logger.info(`Project root: ${projectRoot}`);

  const codexBinary = await findCodexBinary();

  const aggregator = createAggregator(codexBinary, projectRoot);
  await aggregator.start(PROXY_PORT);

  logger.info('All services started');

  spawn('cmd', ['/c', 'start', 'http://localhost:5174'], {
    detached: true,
    stdio: 'ignore',
  });

  logger.info('Press Ctrl+C to stop');

  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    aggregator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    aggregator.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.errorWithStack('Fatal error:', error);
  process.exit(1);
});
