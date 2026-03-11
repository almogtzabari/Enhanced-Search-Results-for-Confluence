#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const checkOnly = process.argv.includes('--check');
const packageJsonPath = path.join(repoRoot, 'package.json');
const manifestPath = path.join(repoRoot, 'manifest.json');

function isValidExtensionVersion(version) {
  return /^\d+\.\d+\.\d+(\.\d+)?$/.test(version);
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const sourceVersion = packageJson.version;
  const currentManifestVersion = manifest.version;

  if (!isValidExtensionVersion(sourceVersion)) {
    throw new Error(
      `Invalid extension version in package.json: "${sourceVersion}". Expected numeric dotted version (e.g. 2.0.4).`,
    );
  }

  if (sourceVersion === currentManifestVersion) {
    console.log(`Version already synced (${sourceVersion}).`);
    return;
  }

  if (checkOnly) {
    throw new Error(
      `Version mismatch: package.json="${sourceVersion}" manifest.json="${currentManifestVersion}". Run: npm run version:sync`,
    );
  }

  manifest.version = sourceVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Updated manifest.json version to ${sourceVersion}.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
