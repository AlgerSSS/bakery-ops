import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  closePreparedEncryptedSort,
  encryptedExternalSort,
  iteratePreparedEncryptedSort,
  prepareEncryptedExternalSort,
} from "../etl/lib/encrypted-external-sort.mjs";

function records(keys) {
  return (async function* values() {
    for (const key of keys) {
      yield { key, value: Buffer.from(`PLAINTEXT-SORT-MARKER:${key}`, "utf8") };
    }
  }());
}

async function collect(iterable) {
  const values = [];
  for await (const value of iterable) values.push(value);
  return values;
}

test("encrypted external sort is bounded, multipass, mode 0600, and never persists plaintext runs", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-"));
  await chmod(parent, 0o700);
  const sealed = [];
  try {
    const output = await collect(encryptedExternalSort({
      estimatedInputBytes: 1024,
      records: records(["00000000-0000-5000-8000-000000000009", "00000000-0000-5000-8000-000000000001", "00000000-0000-5000-8000-000000000007", "00000000-0000-5000-8000-000000000003", "00000000-0000-5000-8000-000000000005"]),
      resourcePolicy: {
        freeSpaceReserveBytes: 0,
        maxFrameBytes: 1024,
        maxMemoryBytes: 16 * 1024,
        maxMergePasses: 8,
        maxOpenRuns: 2,
        maxRunPlaintextBytes: 400,
        temporaryDiskMultiplier: 3,
      },
      statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
      testHooks: {
        async onRunSealed(run) {
          const info = await lstat(run.path);
          const encrypted = await readFile(run.path);
          assert.equal(info.mode & 0o777, 0o600);
          assert.equal(info.nlink, 1);
          assert.equal(encrypted.includes(Buffer.from("PLAINTEXT-SORT-MARKER")), false);
          const magicLength = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii").length;
          const headerLength = encrypted.readUInt32BE(magicLength);
          const header = JSON.parse(encrypted.subarray(
            magicLength + 4,
            magicLength + 4 + headerLength,
          ));
          sealed.push({
            artifact: run.artifactSha256,
            payloadIv: header.payload_iv,
            wrapIv: header.wrap_iv,
            wrappedDek: header.wrapped_dek,
          });
        },
      },
      workDirectory: parent,
    }));
    assert.deepEqual(output.map((record) => record.key), [
      "00000000-0000-5000-8000-000000000001",
      "00000000-0000-5000-8000-000000000003",
      "00000000-0000-5000-8000-000000000005",
      "00000000-0000-5000-8000-000000000007",
      "00000000-0000-5000-8000-000000000009",
    ]);
    for (const record of output) {
      assert.equal(record.value.toString("utf8"), `PLAINTEXT-SORT-MARKER:${record.key}`);
    }
    assert.ok(sealed.length >= 6, "small run limit must force at least two merge levels");
    for (const key of ["payloadIv", "wrapIv", "wrappedDek", "artifact"]) {
      assert.equal(new Set(sealed.map((entry) => entry[key])).size, sealed.length);
    }
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("free-space failure occurs before creating sort side effects", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-space-"));
  await chmod(parent, 0o700);
  try {
    await assert.rejects(
      collect(encryptedExternalSort({
        estimatedInputBytes: 10_000,
        records: records(["00000000-0000-5000-8000-000000000001"]),
        resourcePolicy: {
          freeSpaceReserveBytes: 1000,
          maxFrameBytes: 1024,
          maxMemoryBytes: 4096,
          maxMergePasses: 4,
          maxOpenRuns: 2,
          maxRunPlaintextBytes: 1024,
          temporaryDiskMultiplier: 4,
        },
        statfsImpl: async () => ({ bavail: 1n, bsize: 1n }),
        workDirectory: parent,
      })),
      /s0_v2_insufficient_temporary_space/,
    );
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("a single record cannot exceed the declared plaintext run budget", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-record-budget-"));
  await chmod(parent, 0o700);
  try {
    await assert.rejects(
      collect(encryptedExternalSort({
        estimatedInputBytes: 1024,
        records: (async function* values() {
          yield {
            key: "00000000-0000-5000-8000-000000000001",
            value: Buffer.alloc(200, 0x61),
          };
        }()),
        resourcePolicy: {
          freeSpaceReserveBytes: 0,
          maxFrameBytes: 1024,
          maxMemoryBytes: 4096,
          maxMergePasses: 4,
          maxOpenRuns: 2,
          maxRunPlaintextBytes: 400,
          temporaryDiskMultiplier: 3,
        },
        statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
        workDirectory: parent,
      })),
      /s0_v2_sort_record_exceeds_run_limit/,
    );
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("fan-in, frame, run, and copy residency must fit the declared memory budget", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-memory-policy-"));
  await chmod(parent, 0o700);
  try {
    await assert.rejects(
      prepareEncryptedExternalSort({
        estimatedInputBytes: 0,
        records: (async function* empty() {})(),
        resourcePolicy: {
          freeSpaceReserveBytes: 0,
          maxFrameBytes: 1024,
          maxMemoryBytes: 4096,
          maxMergePasses: 4,
          maxOpenRuns: 4,
          maxRunPlaintextBytes: 2000,
          temporaryDiskMultiplier: 3,
        },
        statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
        workDirectory: parent,
      }),
      /s0_v2_sort_policy_invalid/,
    );
    await assert.rejects(
      prepareEncryptedExternalSort({
        estimatedInputBytes: 0,
        records: (async function* empty() {})(),
        resourcePolicy: {
          freeSpaceReserveBytes: 0,
          maxFrameBytes: 1300,
          maxMemoryBytes: 4096,
          maxMergePasses: 4,
          maxOpenRuns: 2,
          maxRunPlaintextBytes: 1800,
          temporaryDiskMultiplier: 3,
        },
        statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
        workDirectory: parent,
      }),
      /s0_v2_sort_policy_invalid/,
    );
    assert.deepEqual(await readdir(parent), []);
    const boundary = await prepareEncryptedExternalSort({
      estimatedInputBytes: 0,
      records: (async function* empty() {})(),
      resourcePolicy: {
        freeSpaceReserveBytes: 0,
        maxFrameBytes: 1024,
        maxMemoryBytes: 4096,
        maxMergePasses: 4,
        maxOpenRuns: 2,
        maxRunPlaintextBytes: 2048,
        temporaryDiskMultiplier: 3,
      },
      statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
      workDirectory: parent,
    });
    await closePreparedEncryptedSort(boundary);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});

test("duplicate occurrence key and merge-pass exhaustion fail closed and clean encrypted runs", async () => {
  for (const scenario of [
    {
      expected: /s0_v2_duplicate_occurrence_id/,
      keys: ["00000000-0000-5000-8000-000000000001", "00000000-0000-5000-8000-000000000001"],
      maxMergePasses: 4,
    },
    {
      expected: /s0_v2_sort_merge_pass_limit/,
      keys: Array.from({ length: 8 }, (_unused, index) =>
        `00000000-0000-5000-8000-${String(index + 1).padStart(12, "0")}`),
      maxMergePasses: 1,
    },
  ]) {
    const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-fail-"));
    await chmod(parent, 0o700);
    try {
      await assert.rejects(
        collect(encryptedExternalSort({
          estimatedInputBytes: 1024,
          records: records(scenario.keys),
          resourcePolicy: {
            freeSpaceReserveBytes: 0,
            maxFrameBytes: 1024,
            maxMemoryBytes: 16 * 1024,
            maxMergePasses: scenario.maxMergePasses,
            maxOpenRuns: 2,
            maxRunPlaintextBytes: 400,
            temporaryDiskMultiplier: 3,
          },
          statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
          workDirectory: parent,
        })),
        scenario.expected,
      );
      assert.deepEqual(await readdir(parent), []);
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  }
});

test("prepared encrypted sort supports repeatable bounded reads and duplicate hex grouping", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "hc-s0-v2-sort-prepared-"));
  await chmod(parent, 0o700);
  try {
    const prepared = await prepareEncryptedExternalSort({
      duplicatePolicy: "ALLOW",
      estimatedInputBytes: 1024,
      keyKind: "LOWERCASE_HEX_64",
      records: (async function* values() {
        yield { key: "bb".repeat(32), value: Buffer.from("second") };
        yield { key: "aa".repeat(32), value: Buffer.from("first-a") };
        yield { key: "aa".repeat(32), value: Buffer.from("first-b") };
      }()),
      resourcePolicy: {
        freeSpaceReserveBytes: 0,
        maxFrameBytes: 1024,
        maxMemoryBytes: 16 * 1024,
        maxMergePasses: 8,
        maxOpenRuns: 2,
        maxRunPlaintextBytes: 400,
        temporaryDiskMultiplier: 3,
      },
      statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4096n }),
      workDirectory: parent,
    });
    const first = await collect(iteratePreparedEncryptedSort(prepared));
    const second = await collect(iteratePreparedEncryptedSort(prepared));
    assert.deepEqual(first.map((record) => record.key), [
      "aa".repeat(32), "aa".repeat(32), "bb".repeat(32),
    ]);
    assert.deepEqual(second, first);
    assert.notEqual(first[0].value, second[0].value);
    assert.notDeepEqual(await readdir(parent), []);
    await closePreparedEncryptedSort(prepared);
    assert.deepEqual(await readdir(parent), []);
    await assert.rejects(collect(iteratePreparedEncryptedSort(prepared)), /s0_v2_sort_closed/);
  } finally {
    await rm(parent, { force: true, recursive: true });
  }
});
