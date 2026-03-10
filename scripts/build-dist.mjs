#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const allowedTargets = new Set(['chrome', 'firefox', 'all']);
const targetArg = (process.argv[2] || 'all').toLowerCase();
if (!allowedTargets.has(targetArg)) {
  console.error(`Invalid target "${targetArg}". Use: chrome | firefox | all`);
  process.exit(1);
}

const targets = targetArg === 'all' ? ['chrome', 'firefox'] : [targetArg];
const distRoot = path.join(repoRoot, 'dist');
const firefoxGeckoId = process.env.FIREFOX_GECKO_ID || 'enhancedconfluence@gmail.com';
const firefoxStrictMinVersion = process.env.FIREFOX_STRICT_MIN_VERSION || '102.0';

const runtimePathsToCopy = [
  'assets',
  'background',
  'extension',
  'shared',
];

const buildOutputMappings = [
  { src: '.build/content', dst: 'content' },
  { src: '.build/options', dst: 'options' },
  { src: '.build/views', dst: 'views' },
];

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function ensureExists(relativePath, context) {
  const absPath = path.join(context, relativePath);
  try {
    const s = await stat(absPath);
    if (!s.isFile()) throw new Error(`Not a file: ${relativePath}`);
  } catch (err) {
    throw new Error(`Missing required file "${relativePath}" in ${context}: ${err.message}`);
  }
}

async function validateManifestFiles(manifest, targetDir) {
  if (manifest.background?.service_worker) {
    await ensureExists(manifest.background.service_worker, targetDir);
  }
  if (Array.isArray(manifest.background?.scripts)) {
    for (const scriptPath of manifest.background.scripts) {
      if (typeof scriptPath === 'string') await ensureExists(scriptPath, targetDir);
    }
  }
  if (manifest.options_ui?.page) {
    await ensureExists(manifest.options_ui.page, targetDir);
  }

  if (manifest.icons && typeof manifest.icons === 'object') {
    for (const iconPath of Object.values(manifest.icons)) {
      if (typeof iconPath === 'string') await ensureExists(iconPath, targetDir);
    }
  }

  const war = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];
  for (const entry of war) {
    const resources = Array.isArray(entry?.resources) ? entry.resources : [];
    for (const resPath of resources) {
      await ensureExists(resPath, targetDir);
    }
  }
}

function buildTargetManifest(baseManifest, target) {
  const manifest = JSON.parse(JSON.stringify(baseManifest));

  if (target === 'firefox') {
    manifest.manifest_version = 2;
    manifest.permissions = Array.isArray(manifest.permissions)
      ? manifest.permissions.filter((perm) => perm !== 'scripting')
      : [];
    if (!manifest.permissions.includes('activeTab')) {
      manifest.permissions.push('activeTab');
    }

    // Firefox MV2 expects optional_permissions, not optional_host_permissions.
    const optionalHosts = Array.isArray(manifest.optional_host_permissions)
      ? manifest.optional_host_permissions
      : [];
    manifest.optional_permissions = optionalHosts.length > 0 ? optionalHosts : ['<all_urls>'];
    delete manifest.optional_host_permissions;

    manifest.background = {
      scripts: ['background/background.js'],
      persistent: false,
      type: 'module',
    };

    manifest.web_accessible_resources = [
      'assets/*',
      'extension/content/*',
      'content/*',
      'views/*',
      'options/*',
      'shared/*',
      'shared/runtime/*',
    ];

    manifest.browser_specific_settings = {
      gecko: {
        id: firefoxGeckoId,
        strict_min_version: firefoxStrictMinVersion,
      },
    };
    manifest.options_ui = {
      ...(manifest.options_ui || {}),
      browser_style: true,
    };
  } else {
    delete manifest.browser_specific_settings;
  }

  return manifest;
}

async function assembleTarget(target, baseManifest) {
  const targetDir = path.join(distRoot, target);
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  for (const relPath of runtimePathsToCopy) {
    const src = path.join(repoRoot, relPath);
    const dst = path.join(targetDir, relPath);
    await cp(src, dst, { recursive: true });
  }

  for (const mapping of buildOutputMappings) {
    const src = path.join(repoRoot, mapping.src);
    const dst = path.join(targetDir, mapping.dst);
    await cp(src, dst, { recursive: true });
  }

  const manifest = buildTargetManifest(baseManifest, target);
  await writeFile(
    path.join(targetDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await validateManifestFiles(manifest, targetDir);
  console.log(`Assembled dist/${target}`);
}

async function main() {
  const manifestPath = path.join(repoRoot, 'manifest.json');
  const baseManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  console.log('Building UI assets from ui...');
  await runCommand('npm', ['--prefix', 'ui', 'run', 'build'], repoRoot);

  await mkdir(distRoot, { recursive: true });
  for (const target of targets) {
    await assembleTarget(target, baseManifest);
  }

  console.log(`Done. Generated: ${targets.map((t) => `dist/${t}`).join(', ')}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
