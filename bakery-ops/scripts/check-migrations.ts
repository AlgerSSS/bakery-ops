/**
 * 只读对账（IMPROVEMENT-PLAN.md C5）：比较 src/modules/data/migrations/ 目录里的迁移编号
 * 与线上 schema_migrations 表内已记录的编号，报告差集。
 * 【只报告，绝不执行任何 SQL 文件】——发现未记录的迁移时，由人工核对后手工应用并回填。
 *   npx tsx scripts/check-migrations.ts   （在 bakery-ops/ 目录下运行）
 */
import "dotenv/config";
import { readdirSync } from "fs";
import { resolve } from "path";
import { query } from "../src/modules/shared/db/postgres";

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
}

/** 解析目录文件名列表 → 迁移清单（忽略不符合 NNN_name.sql 的文件），按编号升序。 */
export function parseMigrationFiles(filenames: string[]): MigrationFile[] {
  return filenames
    .map((filename) => {
      const m = /^(\d+)_(.+)\.sql$/.exec(filename);
      return m ? { version: parseInt(m[1], 10), name: m[2], filename } : null;
    })
    .filter((f): f is MigrationFile => f !== null)
    .sort((a, b) => a.version - b.version);
}

/** 差集：目录里有但表内未记录（unrecorded）；表内记录了但目录里没有对应文件（unknownRecorded）。 */
export function diffMigrations(
  dirFiles: MigrationFile[],
  recordedVersions: number[],
): { unrecorded: MigrationFile[]; unknownRecorded: number[] } {
  const recorded = new Set(recordedVersions);
  const inDir = new Set(dirFiles.map((f) => f.version));
  return {
    unrecorded: dirFiles.filter((f) => !recorded.has(f.version)),
    unknownRecorded: [...new Set(recordedVersions)]
      .filter((v) => !inDir.has(v))
      .sort((a, b) => a - b),
  };
}

const MIGRATIONS_DIR = resolve(process.cwd(), "src/modules/data/migrations");

async function main() {
  const dirFiles = parseMigrationFiles(readdirSync(MIGRATIONS_DIR));
  const rows = await query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const { unrecorded, unknownRecorded } = diffMigrations(
    dirFiles,
    rows.map((r) => Number(r.version)),
  );

  console.log(`migrations/ 目录: ${dirFiles.length} 个迁移文件`);
  console.log(`schema_migrations 已记录: ${rows.length} 个版本`);
  if (unrecorded.length === 0 && unknownRecorded.length === 0) {
    console.log("✓ 一致，无差异。");
    return;
  }
  for (const f of unrecorded) {
    console.log(`✗ 未记录（请人工核对是否已应用，再手工执行/回填）: ${f.filename}`);
  }
  for (const v of unknownRecorded) {
    console.log(`✗ 表内已记录但目录无对应文件: version=${v}`);
  }
  process.exitCode = 1;
}

// vitest 会 import 本文件取纯函数；仅在直接执行时跑 main。
if (process.argv[1]?.includes("check-migrations")) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
