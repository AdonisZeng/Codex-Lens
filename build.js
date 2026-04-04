import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync, existsSync, mkdirSync, cpSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'dist');

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true });
}

mkdirSync(outDir);

async function buildAll() {
  const backendFiles = [
    'src/cli.js',
    'src/proxy.js',
    'src/aggregator.js',
    'src/watcher.js',
    'src/pty-manager.js',
    'src/git-manager.js',
    'src/lib/sse-parser.js',
    'src/lib/diff-builder.js',
    'src/lib/log-manager.js',
    'src/lib/logger.js',
  ];

  for (const file of backendFiles) {
    const fullPath = resolve(__dirname, file);
    if (!existsSync(fullPath)) {
      console.log(`Skipping (not found): ${file}`);
      continue;
    }
    try {
      await esbuildBuild({
        entryPoints: [fullPath],
        outfile: resolve(__dirname, file.replace('src/', 'dist/')),
        bundle: false,
        platform: 'node',
        target: 'node18',
        format: 'esm',
        banner: {
          js: '#!/usr/bin/env node',
        },
      });
      console.log(`Built: ${file}`);
    } catch (e) {
      console.error(`Failed to build ${file}:`, e.message);
    }
  }

  console.log('Building frontend with Vite...');
  await viteBuild({
    configFile: resolve(__dirname, 'vite.config.js'),
  });
  console.log('Built: frontend -> dist/public/');

  if (existsSync(resolve(__dirname, 'public'))) {
    cpSync(resolve(__dirname, 'public'), resolve(outDir, 'public'), { recursive: true });
    console.log('Copied: public/ -> dist/public/');
  }
}

buildAll().catch(console.error);
