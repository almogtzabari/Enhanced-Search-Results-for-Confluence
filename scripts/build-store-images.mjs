#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const screenshotSources = [
  'settings.png',
  'tree-view.png',
  'table-view.png',
];

const defaultSizes = ['1280x800', '640x400'];
const args = process.argv.slice(2);
const sizeArg = args.find((arg) => arg.startsWith('--sizes='));
const requestedSizes = sizeArg
  ? sizeArg.replace('--sizes=', '').split(',').map((v) => v.trim()).filter(Boolean)
  : defaultSizes;

function parseSize(sizeValue) {
  const match = /^(\d+)x(\d+)$/.exec(String(sizeValue || '').trim());
  if (!match) return null;
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height, label: `${width}x${height}` };
}

const sizes = requestedSizes.map(parseSize);
if (sizes.some((v) => !v)) {
  console.error('Invalid --sizes value. Use comma-separated WIDTHxHEIGHT values, e.g. --sizes=1280x800,640x400');
  process.exit(1);
}

async function runSips(cmdArgs) {
  try {
    return await execFileAsync('sips', cmdArgs, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('The "sips" command was not found. This script currently requires macOS.');
    }
    const stderr = error?.stderr ? `\n${String(error.stderr).trim()}` : '';
    throw new Error(`sips failed for args: ${cmdArgs.join(' ')}${stderr}`);
  }
}

async function getDimensions(absPath) {
  const { stdout } = await runSips(['-g', 'pixelWidth', '-g', 'pixelHeight', absPath]);
  const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
  const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);
  const width = widthMatch ? Number.parseInt(widthMatch[1], 10) : 0;
  const height = heightMatch ? Number.parseInt(heightMatch[1], 10) : 0;
  if (!width || !height) {
    throw new Error(`Could not read image dimensions for ${absPath}`);
  }
  return { width, height };
}

function calcContainResize(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    return {
      width: targetWidth,
      height: Math.max(1, Math.round(targetWidth / sourceRatio)),
    };
  }
  return {
    width: Math.max(1, Math.round(targetHeight * sourceRatio)),
    height: targetHeight,
  };
}

async function buildSizedScreenshot(sourceAbsPath, outputAbsPath, target) {
  const sourceDims = await getDimensions(sourceAbsPath);
  const fit = calcContainResize(sourceDims.width, sourceDims.height, target.width, target.height);
  const tempPng = outputAbsPath.replace(/\.jpg$/i, '.tmp.png');

  try {
    await runSips([
      '--resampleHeightWidth',
      String(fit.height),
      String(fit.width),
      '--padToHeightWidth',
      String(target.height),
      String(target.width),
      '--padColor',
      'FFFFFF',
      sourceAbsPath,
      '--out',
      tempPng,
    ]);

    await runSips([
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      'best',
      tempPng,
      '--out',
      outputAbsPath,
    ]);
  } finally {
    await rm(tempPng, { force: true });
  }

  const finalDims = await getDimensions(outputAbsPath);
  if (finalDims.width !== target.width || finalDims.height !== target.height) {
    throw new Error(
      `Unexpected output size for ${outputAbsPath}. Expected ${target.label}, got ${finalDims.width}x${finalDims.height}`,
    );
  }
}

async function main() {
  const outRoot = path.join(repoRoot, 'dist', 'store-assets', 'chrome', 'screenshots');
  const generated = [];

  for (const target of sizes) {
    const sizeDir = path.join(outRoot, target.label);
    await mkdir(sizeDir, { recursive: true });

    for (const sourceName of screenshotSources) {
      const sourceAbsPath = path.join(repoRoot, 'assets', 'images', sourceName);
      const basename = sourceName.replace(/\.[^.]+$/, '');
      const outputAbsPath = path.join(sizeDir, `${basename}-${target.label}.jpg`);
      await buildSizedScreenshot(sourceAbsPath, outputAbsPath, target);
      generated.push(path.relative(repoRoot, outputAbsPath));
    }
  }

  console.log('Created Chrome store screenshot copies:');
  generated.forEach((relPath) => console.log(`- ${relPath}`));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
