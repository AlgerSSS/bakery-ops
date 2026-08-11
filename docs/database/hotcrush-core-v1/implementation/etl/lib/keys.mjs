import { execFile as nodeExecFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

const KEYCHAIN = Object.freeze({
  account: "hotcrush-r6-migration",
  hmac: Object.freeze({
    id: "hotcrush-r6-hmac-v1",
    service: "com.hotcrush.r6-migration.hmac.v1",
  }),
  kek: Object.freeze({
    id: "hotcrush-r6-kek-v1",
    service: "com.hotcrush.r6-migration.kek.v1",
  }),
});

function copyKey(value, name) {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError(`invalid_${name}`);
  return Buffer.from(value);
}

function wipeBuffer(value) {
  if (!Buffer.isBuffer(value)) return;
  try {
    value.fill(0);
  } catch {
    // Cleanup is best-effort and must never replace the validation/read error.
  }
}

export function validateKeyring(input) {
  if (!input || typeof input !== "object") throw new TypeError("invalid_keyring");
  let kek;
  let hmacKey;
  try {
    kek = copyKey(input.kek, "kek");
    hmacKey = copyKey(input.hmacKey, "hmac_key");
    if (typeof input.kekId !== "string" || typeof input.hmacKeyId !== "string") {
      throw new TypeError("invalid_key_id");
    }
    if (timingSafeEqual(kek, hmacKey)) throw new TypeError("key_separation_violation");
    return Object.freeze({ kekId: input.kekId, kek, hmacKeyId: input.hmacKeyId, hmacKey });
  } catch (error) {
    wipeBuffer(kek);
    wipeBuffer(hmacKey);
    throw error;
  }
}

function decodeKeychainValue(stdout) {
  const value = String(stdout).trim();
  if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new TypeError("keychain_value_invalid");
  }
  const bytes = Buffer.from(value, "base64");
  const canonical = bytes.toString("base64");
  if (bytes.length !== 32 || canonical !== value) {
    wipeBuffer(bytes);
    throw new TypeError("keychain_value_invalid");
  }
  return bytes;
}

function readKeychainItem(spec, execFileImpl) {
  return new Promise((resolve, reject) => {
    const args = [
      "find-generic-password",
      "-a", KEYCHAIN.account,
      "-s", spec.service,
      "-w",
    ];
    execFileImpl(
      "/usr/bin/security",
      args,
      { encoding: "utf8", maxBuffer: 256, shell: false, timeout: 10_000 },
      (error, stdout) => {
        if (error) return reject(new Error("keychain_read_failed"));
        try {
          resolve(decodeKeychainValue(stdout));
        } catch {
          reject(new Error("keychain_read_failed"));
        }
      },
    );
  });
}

export async function loadMacOSKeychainKeyring({ execFileImpl = nodeExecFile } = {}) {
  let rawKek;
  let rawHmacKey;
  try {
    const [kekResult, hmacResult] = await Promise.allSettled([
      readKeychainItem(KEYCHAIN.kek, execFileImpl),
      readKeychainItem(KEYCHAIN.hmac, execFileImpl),
    ]);
    if (kekResult.status === "fulfilled") rawKek = kekResult.value;
    if (hmacResult.status === "fulfilled") rawHmacKey = hmacResult.value;
    if (kekResult.status === "rejected" || hmacResult.status === "rejected") {
      throw new Error("keychain_read_failed");
    }
    return validateKeyring({
      kekId: KEYCHAIN.kek.id,
      kek: rawKek,
      hmacKeyId: KEYCHAIN.hmac.id,
      hmacKey: rawHmacKey,
    });
  } catch {
    throw new Error("keychain_read_failed");
  } finally {
    wipeBuffer(rawKek);
    wipeBuffer(rawHmacKey);
  }
}

export { KEYCHAIN };
