#!/usr/bin/env node
import 'dotenv/config';

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  parsePosHistoryArgs,
  verifyPosHistory,
} from '../lib/r6-pos-history.js';
import {
  r6Secret,
  sourceProjectRef,
  targetProjectRef,
} from '../lib/r6-pos-migration-cli.js';

const execFileAsync = promisify(execFile);
const RES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.log(
    'Usage: node scripts/verify-r6-pos-history.js '
      + '--from=YYYY-MM-DD --to=YYYY-MM-DD --old-store="source store" '
      + '--r6-store=HC001',
  );
}

function jsonResult(output, operation) {
  const lines = String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking for the command's final JSON result.
    }
  }
  throw new Error(`${operation} returned no JSON result`);
}

async function verifyWindow(args, window) {
  const operation = `verify ${window.fromDate}..${window.toDate}`;
  const childArgs = [
    path.join(RES_ROOT, 'scripts/verify-r6-pos-range.js'),
    `--from=${window.fromDate}`,
    `--to=${window.toDate}`,
    `--old-store=${args.oldStore}`,
    `--r6-store=${args.r6Store}`,
  ];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, childArgs, {
      cwd: RES_ROOT,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (stderr) process.stderr.write(stderr);
    return jsonResult(stdout, operation);
  } catch (error) {
    if (error.stderr) process.stderr.write(error.stderr);
    try {
      return jsonResult(error.stdout, operation);
    } catch {
      throw new Error(`${operation} failed: ${error.message}`);
    }
  }
}

async function main() {
  const args = parsePosHistoryArgs(process.argv.slice(2), { allowApply: false });
  if (args.help) {
    usage();
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.R6_SUPABASE_URL) {
    throw new Error('DATABASE_URL and R6_SUPABASE_URL are required');
  }
  r6Secret();
  const result = await verifyPosHistory({
    args,
    sourceRef: sourceProjectRef(process.env.DATABASE_URL),
    targetRef: targetProjectRef(process.env.R6_SUPABASE_URL),
    verifyWindow: (window) => verifyWindow(args, window),
    onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(`[r6-pos-history-verify] ${error.message}`);
  process.exitCode = 1;
});
