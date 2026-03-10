#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');

function fail(message) {
  throw new Error(message);
}

async function pathExists(absPath) {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(targetDir, relPath, label) {
  const absPath = path.join(targetDir, relPath);
  const exists = await pathExists(absPath);
  if (!exists) fail(`Missing ${label}: ${relPath}`);
}

async function ensurePathFromResourcePattern(targetDir, resourcePattern, label) {
  const wildcardIndex = resourcePattern.search(/[*?]/);
  if (wildcardIndex === -1) {
    await ensureFile(targetDir, resourcePattern, label);
    return;
  }

  const prefix = resourcePattern.slice(0, wildcardIndex).replace(/\/+$/, '');
  if (!prefix) return;
  const absPrefix = path.join(targetDir, prefix);
  const exists = await pathExists(absPrefix);
  if (!exists) fail(`Missing path for ${label} pattern: ${resourcePattern}`);
}

async function validateCommonManifestFields(targetDir, manifest) {
  if (manifest.options_ui?.page) {
    await ensureFile(targetDir, manifest.options_ui.page, 'options page');
  }

  if (manifest.icons && typeof manifest.icons === 'object') {
    for (const iconPath of Object.values(manifest.icons)) {
      if (typeof iconPath === 'string') {
        await ensureFile(targetDir, iconPath, 'icon');
      }
    }
  }

  if (Array.isArray(manifest.web_accessible_resources)) {
    if (manifest.web_accessible_resources.length > 0 && typeof manifest.web_accessible_resources[0] === 'string') {
      for (const pattern of manifest.web_accessible_resources) {
        if (typeof pattern === 'string') {
          await ensurePathFromResourcePattern(targetDir, pattern, 'web_accessible_resources');
        }
      }
    } else {
      for (const entry of manifest.web_accessible_resources) {
        const resources = Array.isArray(entry?.resources) ? entry.resources : [];
        for (const resource of resources) {
          if (typeof resource === 'string') {
            await ensurePathFromResourcePattern(targetDir, resource, 'web_accessible_resources.resources');
          }
        }
      }
    }
  }
}

async function loadManifest(target) {
  const targetDir = path.join(distRoot, target);
  const manifestPath = path.join(targetDir, 'manifest.json');
  const exists = await pathExists(manifestPath);
  if (!exists) fail(`Missing manifest: dist/${target}/manifest.json`);
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  return { manifest, targetDir };
}

async function validateChromeDist() {
  const { manifest, targetDir } = await loadManifest('chrome');
  if (manifest.manifest_version !== 3) fail('Chrome dist must use manifest_version 3');
  if (!manifest.background?.service_worker) fail('Chrome dist must define background.service_worker');
  await ensureFile(targetDir, manifest.background.service_worker, 'background service worker');

  if (!Array.isArray(manifest.permissions) || !manifest.permissions.includes('scripting')) {
    fail('Chrome dist should include "scripting" permission');
  }
  if (!Array.isArray(manifest.optional_host_permissions)) {
    fail('Chrome dist should include optional_host_permissions');
  }

  await validateCommonManifestFields(targetDir, manifest);
  await ensureFile(targetDir, 'views/index.html', 'views page');
  await ensureFile(targetDir, 'content/content-main.js', 'content bundle');
}

async function validateFirefoxDist() {
  const { manifest, targetDir } = await loadManifest('firefox');
  if (manifest.manifest_version !== 2) fail('Firefox dist must use manifest_version 2');
  if (!Array.isArray(manifest.background?.scripts) || manifest.background.scripts.length === 0) {
    fail('Firefox dist must define background.scripts');
  }
  for (const script of manifest.background.scripts) {
    if (typeof script === 'string') {
      await ensureFile(targetDir, script, 'background script');
    }
  }

  if (!Array.isArray(manifest.optional_permissions)) {
    fail('Firefox dist should include optional_permissions');
  }

  const gecko = manifest.browser_specific_settings?.gecko;
  if (!gecko?.id) fail('Firefox dist must define browser_specific_settings.gecko.id');

  await validateCommonManifestFields(targetDir, manifest);
  await ensureFile(targetDir, 'views/index.html', 'views page');
  await ensureFile(targetDir, 'content/content-main.js', 'content bundle');
}

async function main() {
  await validateChromeDist();
  await validateFirefoxDist();
  console.log('dist verification passed (chrome + firefox)');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
