import { createHash, timingSafeEqual } from "node:crypto";

export const MIGRATION_CONTRACT_RELEASE = Object.freeze({
  bytes: 663164,
  filename: "migration-contract.json",
  release_status: "PHYSICAL_BACKFILL_NOT_STARTED",
  sha256: "7ea542ef1e654b094628bbb97868b28a963879a4815740f7fa4f65c8c60d8587",
});

export function verifyMigrationContractRelease(bytes) {
  const input = Buffer.from(bytes);
  const expected = Buffer.from(MIGRATION_CONTRACT_RELEASE.sha256, "hex");
  const actual = createHash("sha256").update(input).digest();
  if (
    input.length !== MIGRATION_CONTRACT_RELEASE.bytes || actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new TypeError("migration_contract_release_mismatch");
  }
}
