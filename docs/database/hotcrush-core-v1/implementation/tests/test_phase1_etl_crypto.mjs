import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeJcs,
  canonicalizeTypedRow,
  sha256Hex,
} from "../etl/lib/canonical.mjs";
import {
  domainHmac,
  uuidV5,
  uuidV5FromIdentityHmac,
} from "../etl/lib/identity.mjs";
import {
  openEnvelope,
  sealEnvelope,
  writeEncryptedArtifact,
} from "../etl/lib/envelope.mjs";
import {
  KEYCHAIN,
  loadMacOSKeychainKeyring,
  validateKeyring,
} from "../etl/lib/keys.mjs";

const KEK = Buffer.alloc(32, 0x11);
const HMAC = Buffer.alloc(32, 0x22);

test("hotcrush typed-JCS v1 is stable, type preserving, and rejects lossy inputs", () => {
  assert.equal(
    canonicalizeJcs({ z: 1, a: "x" }).toString(),
    '{"a":"x","z":1}',
  );
  const fields = [
    { name: "amount", pg_type: "numeric(18,4)", raw: "438756.9000" },
    { name: "member_id", pg_type: "bigint", raw: "2004094164312182791" },
    { name: "missing", pg_type: "uuid", raw: null },
  ];
  const left = canonicalizeTypedRow("sample", fields);
  const right = canonicalizeTypedRow("sample", [...fields].reverse());
  assert.notDeepEqual(left, right);
  assert.match(left.toString(), /hotcrush\.typed-jcs\.v1/);
  assert.match(left.toString(), /2004094164312182791/);

  for (const invalid of [1n, new Date(), undefined, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalizeJcs(invalid), /unsupported_jcs_value/);
  }
  assert.throws(() => canonicalizeJcs("\ud800"), /lone_surrogate/);
});

test("UUIDv5 follows the RFC vector while HMAC supplies secrecy and domain separation", () => {
  assert.equal(
    uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", Buffer.from("www.example.com")),
    "2ed6657d-e927-568b-95e1-2665a8aea6a2",
  );
  const one = domainHmac(HMAC, "source-identity:v1", Buffer.from("same"));
  const two = domainHmac(HMAC, "source-payload:v1", Buffer.from("same"));
  assert.equal(one.length, 32);
  assert.notDeepEqual(one, two);
  assert.match(uuidV5FromIdentityHmac(one), /^[0-9a-f-]{36}$/);
  assert.throws(
    () => uuidV5FromIdentityHmac(Buffer.from("+60123456789")),
    /identity_hmac_required/,
  );
  assert.throws(
    () => uuidV5FromIdentityHmac(Buffer.alloc(32, 0x41)),
    /identity_hmac_required/,
  );
});

test("AES-256-GCM envelope authenticates payload and independently wrapped DEK", () => {
  const keyring = validateKeyring({
    kekId: "fixture-kek-v1",
    kek: KEK,
    hmacKeyId: "fixture-hmac-v1",
    hmacKey: HMAC,
  });
  const plaintext = Buffer.from("SENSITIVE_FIXTURE_MARKER");
  const first = sealEnvelope(plaintext, {
    keyring,
    artifactType: "S0_FIXTURE",
    contentId: sha256Hex(plaintext),
  });
  const second = sealEnvelope(plaintext, {
    keyring,
    artifactType: "S0_FIXTURE",
    contentId: sha256Hex(plaintext),
  });
  assert.notDeepEqual(first, second);
  assert.deepEqual(openEnvelope(first, {
    expectedArtifactType: "S0_FIXTURE",
    keyring,
  }), plaintext);
  assert.equal(first.includes(plaintext), false);

  const tampered = Buffer.from(first);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => openEnvelope(tampered, {
    expectedArtifactType: "S0_FIXTURE",
    keyring,
  }), /envelope_authentication_failed/);
  const wrong = { ...keyring, kek: Buffer.alloc(32, 0x33) };
  assert.throws(() => openEnvelope(first, {
    expectedArtifactType: "S0_FIXTURE",
    keyring: wrong,
  }), /envelope_authentication_failed/);
  assert.throws(() => openEnvelope(first, {
    expectedArtifactType: "R6_ROUTE_LEDGER",
    keyring,
  }), /envelope_authentication_failed/);
  assert.throws(
    () => validateKeyring({ ...keyring, hmacKey: KEK }),
    /key_separation_violation/,
  );
});

test("Keychain provider is read-only, no-shell, fixed-argument, and redacts failures", async () => {
  assert.throws(() => {
    KEYCHAIN.kek.service = "attacker-controlled";
  }, TypeError);
  const calls = [];
  const fakeExecFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, `${Buffer.alloc(32, calls.length).toString("base64")}\n`, "");
  };
  const keyring = await loadMacOSKeychainKeyring({ execFileImpl: fakeExecFile });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.file === "/usr/bin/security"));
  assert.ok(calls.every((call) => call.options.shell === false));
  assert.ok(calls.every((call) => call.args[0] === "find-generic-password"));
  assert.equal(keyring.kek.length, 32);
  assert.equal(keyring.hmacKey.length, 32);

  await assert.rejects(
    loadMacOSKeychainKeyring({
      execFileImpl: (_file, _args, _options, callback) =>
        callback(new Error("secret=DO_NOT_LEAK"), "", "secret=DO_NOT_LEAK"),
    }),
    (error) => error.message === "keychain_read_failed",
  );
});

test("encrypted artifact writer publishes only ciphertext at mode 0600", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hc-r6-etl-"));
  const plaintext = Buffer.from("PLAINTEXT_MUST_NOT_REACH_DISK");
  const keyring = validateKeyring({
    kekId: "fixture-kek-v1",
    kek: KEK,
    hmacKeyId: "fixture-hmac-v1",
    hmacKey: HMAC,
  });
  const receipt = await writeEncryptedArtifact({
    directory,
    filename: "fixture.s0.enc",
    plaintext,
    keyring,
    artifactType: "S0_FIXTURE",
    contentId: sha256Hex(plaintext),
  });
  const bytes = await readFile(receipt.path);
  assert.equal(bytes.includes(plaintext), false);
  assert.deepEqual(openEnvelope(bytes, {
    expectedArtifactType: "S0_FIXTURE",
    keyring,
  }), plaintext);
  assert.equal((await stat(receipt.path)).mode & 0o777, 0o600);
  await assert.rejects(
    writeEncryptedArtifact({
      directory,
      filename: "../escape.enc",
      plaintext,
      keyring,
      artifactType: "S0_FIXTURE",
      contentId: sha256Hex(plaintext),
    }),
    /unsafe_artifact_filename/,
  );
});
