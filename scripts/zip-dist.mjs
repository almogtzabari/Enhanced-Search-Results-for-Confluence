#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distRoot = path.join(repoRoot, 'dist');
const packagesDir = path.join(distRoot, 'packages');

const allowedTargets = new Set(['chrome', 'firefox', 'all']);
const args = process.argv.slice(2);

const targetArg = (args.find((arg) => !arg.startsWith('--')) || 'all').toLowerCase();
if (!allowedTargets.has(targetArg)) {
  console.error(`Invalid target "${targetArg}". Use: chrome | firefox | all`);
  process.exit(1);
}

const skipBuild = args.includes('--skip-build');
const targets = targetArg === 'all' ? ['chrome', 'firefox'] : [targetArg];

const sourceArchiveExcludedPrefixes = [
  '.build/',
  '.codex/',
  '.git/',
  '.vscode/',
  'dist/',
  'node_modules/',
  'ui/coverage/',
  'ui/node_modules/',
];

const sourceArchiveExcludedBasenames = new Set(['.DS_Store']);
const sourceArchiveExcludedSuffixes = ['.zip', '.xpi'];

function runCommand(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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
      reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
    });
  });
}

function collectCommandOutput(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }

      const stderrText = Buffer.concat(stderr).toString('utf8').trim();
      const details = stderrText ? `\n${stderrText}` : '';
      reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}${details}`));
    });
  });
}

function runCommandWithInput(command, commandArgs, cwd, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
    });

    child.stdin.end(input);
  });
}

function isSourceArchiveFile(filePath) {
  const normalizedPath = filePath.replaceAll(path.sep, '/');
  const basename = path.basename(normalizedPath);

  if (sourceArchiveExcludedBasenames.has(basename)) {
    return false;
  }

  if (sourceArchiveExcludedPrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
    return false;
  }

  return !sourceArchiveExcludedSuffixes.some((suffix) => normalizedPath.endsWith(suffix));
}

async function listSourceArchiveFiles() {
  const output = await collectCommandOutput('git', ['ls-files', '-z'], repoRoot);
  const trackedFiles = output.split('\0').filter(Boolean);
  const sourceFiles = trackedFiles.filter(isSourceArchiveFile).sort();

  if (sourceFiles.length === 0) {
    throw new Error('No source files found for source archive.');
  }

  return sourceFiles;
}

async function ensureManifest(target) {
  const targetDir = path.join(distRoot, target);
  const manifestPath = path.join(targetDir, 'manifest.json');
  try {
    const s = await stat(manifestPath);
    if (!s.isFile()) {
      throw new Error(`Not a file: ${manifestPath}`);
    }
  } catch {
    throw new Error(`Missing dist bundle for "${target}". Run "npm run build:dist" first.`);
  }
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

async function createArchive(target, version) {
  const targetDir = path.join(distRoot, target);
  const extension = target === 'firefox' ? 'xpi' : 'zip';
  const archiveName = `enhanced-search-results-for-confluence-${target}-v${version}.${extension}`;
  const archiveAbsPath = path.join(packagesDir, archiveName);

  await rm(archiveAbsPath, { force: true });
  await createArchiveWithZipCommand(targetDir, archiveAbsPath);

  return archiveAbsPath;
}

async function createSourceArchive(version) {
  const archiveName = `enhanced-search-results-for-confluence-source-v${version}.zip`;
  const archiveAbsPath = path.join(packagesDir, archiveName);

  await rm(archiveAbsPath, { force: true });
  const sourceFiles = await listSourceArchiveFiles();
  await createArchiveWithZipFileList(repoRoot, archiveAbsPath, sourceFiles);

  return archiveAbsPath;
}

async function createArchiveWithZipCommand(targetDir, archiveAbsPath, excludes = ['*.DS_Store', '__MACOSX/*']) {
  try {
    await runCommand(
      'zip',
      ['-q', '-r', '-X', archiveAbsPath, '.', '-x', ...excludes],
      targetDir,
    );
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('The "zip" command was not found. Install zip and retry.');
    }
    throw error;
  }
}

async function createArchiveWithZipFileList(targetDir, archiveAbsPath, files) {
  try {
    await runCommandWithInput('zip', ['-q', '-X', archiveAbsPath, '-@'], targetDir, `${files.join('\n')}\n`);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('The "zip" command was not found. Install zip and retry.');
    }
    throw error;
  }
}

async function main() {
  if (!skipBuild) {
    console.log('Building dist targets...');
    await runCommand('npm', ['run', 'build:dist'], repoRoot);
  }

  await mkdir(packagesDir, { recursive: true });

  const createdArchives = [];
  const rootManifest = JSON.parse(await readFile(path.join(repoRoot, 'manifest.json'), 'utf8'));
  const rootVersion = String(rootManifest.version || '0.0.0');

  for (const target of targets) {
    const manifest = await ensureManifest(target);
    const version = String(manifest.version || '0.0.0');
    const archivePath = await createArchive(target, version);
    createdArchives.push(path.relative(repoRoot, archivePath));
  }

  const sourceArchivePath = await createSourceArchive(rootVersion);
  createdArchives.push(path.relative(repoRoot, sourceArchivePath));

  console.log('Created upload package(s):');
  createdArchives.forEach((archivePath) => console.log(`- ${archivePath}`));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
