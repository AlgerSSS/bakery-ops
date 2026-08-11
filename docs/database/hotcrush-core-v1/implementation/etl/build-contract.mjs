#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  buildMigrationContract,
  CONTRACT_PATH,
  migrationContractBytes,
} from "./lib/contract.mjs";

async function main() {
  const checkOnly = process.argv.slice(2).includes("--check");
  if (process.argv.length > (checkOnly ? 3 : 2)) throw new Error("unsupported_argument");
  const contract = await buildMigrationContract();
  const bytes = migrationContractBytes(contract);
  if (checkOnly) {
    const existing = await readFile(CONTRACT_PATH);
    if (!existing.equals(bytes)) throw new Error("migration_contract_out_of_date");
    return;
  }
  const temporary = `${CONTRACT_PATH}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o644);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, CONTRACT_PATH);
    const directory = await open(path.dirname(CONTRACT_PATH), fsConstants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    try { await handle?.close(); } catch { /* best effort */ }
    try { await unlink(temporary); } catch { /* best effort */ }
    throw error;
  }
}

await main();
