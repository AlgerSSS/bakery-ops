#!/usr/bin/env node
import 'dotenv/config';

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parsePosHistoryArgs,
  runPosHistory,
} from '../lib/r6-pos-history.js';
import {
  r6Secret,
  sourceProjectRef,
  targetProjectRef,
} from '../lib/r6-pos-migration-cli.js';

const RES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORM_ROOT = path.resolve(RES_ROOT, '../bakery-ops/services/data-platform');

function usage() {
  console.log(
    'Usage: node scripts/backfill-r6-pos-history.js '
      + '--from=YYYY-MM-DD --to=YYYY-MM-DD --old-store="source store" '
      + '--r6-store=HC001 [--apply]',
  );
}

function lastJsonLine(output, operation) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Child commands may emit informational lines before their final JSON result.
    }
  }
  throw new Error(`${operation} returned no JSON result`);
}

function runCommandJson(command, args, { cwd, env = process.env, operation }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => reject(new Error(`${operation} failed to start: ${error.message}`)));
    child.on('close', (code, signal) => {
      if (code !== 0) {
        const detail = stderr.trim().split(/\r?\n/).at(-1) || `exit=${code} signal=${signal || 'none'}`;
        reject(new Error(`${operation} failed: ${detail}`));
        return;
      }
      try {
        resolve(lastJsonLine(stdout, operation));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function rangeArgs(args, window, apply) {
  return [
    path.join(RES_ROOT, 'scripts/backfill-r6-pos-range.js'),
    `--from=${window.fromDate}`,
    `--to=${window.toDate}`,
    `--old-store=${args.oldStore}`,
    `--r6-store=${args.r6Store}`,
    ...(apply ? ['--apply'] : []),
  ];
}

function verifyArgs(args, window) {
  return [
    path.join(RES_ROOT, 'scripts/verify-r6-pos-range.js'),
    `--from=${window.fromDate}`,
    `--to=${window.toDate}`,
    `--old-store=${args.oldStore}`,
    `--r6-store=${args.r6Store}`,
  ];
}

function posWorkerEnv(env, window) {
  const workerEnv = {
    ...env,
    POS_WORKER_ID: `history:${window.fromDate}:${window.toDate}:${process.pid}`,
  };
  if (!workerEnv.R6_SUPABASE_SERVICE_KEY && workerEnv.R6_SUPABASE_SECRET_KEY) {
    workerEnv.R6_SUPABASE_SERVICE_KEY = workerEnv.R6_SUPABASE_SECRET_KEY;
  }
  if (!workerEnv.R6_SUPABASE_SERVICE_KEY_FILE && workerEnv.R6_SUPABASE_SECRET_KEY_FILE) {
    workerEnv.R6_SUPABASE_SERVICE_KEY_FILE = workerEnv.R6_SUPABASE_SECRET_KEY_FILE;
  }
  return workerEnv;
}

async function main() {
  const args = parsePosHistoryArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.R6_SUPABASE_URL) {
    throw new Error('DATABASE_URL and R6_SUPABASE_URL are required');
  }
  const sourceRef = sourceProjectRef(process.env.DATABASE_URL);
  const targetRef = targetProjectRef(process.env.R6_SUPABASE_URL);
  if (args.apply) r6Secret();

  const result = await runPosHistory({
    args,
    sourceRef,
    targetRef,
    registerWindow: (window, apply) => runCommandJson(
      process.execPath,
      rangeArgs(args, window, apply),
      {
        cwd: RES_ROOT,
        operation: `register ${window.fromDate}..${window.toDate}`,
      },
    ),
    drainWindow: (window, maxRuns) => runCommandJson(
      'uv',
      [
        'run', 'hotcrush-pos-worker', '--drain', `--max-runs=${maxRuns}`,
        '--log-level=WARNING',
      ],
      {
        cwd: PLATFORM_ROOT,
        env: posWorkerEnv(process.env, window),
        operation: `drain ${window.fromDate}..${window.toDate}`,
      },
    ),
    verifyWindow: (window) => runCommandJson(
      process.execPath,
      verifyArgs(args, window),
      {
        cwd: RES_ROOT,
        operation: `verify ${window.fromDate}..${window.toDate}`,
      },
    ),
    onProgress: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
  });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(`[r6-pos-history-backfill] ${error.message}`);
  process.exitCode = 1;
});
