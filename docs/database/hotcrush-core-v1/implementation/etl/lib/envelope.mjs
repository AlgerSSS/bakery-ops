import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  link,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { canonicalizeJcs, parseCanonicalJcs, sha256Hex } from "./canonical.mjs";
import { validateKeyring } from "./keys.mjs";

const FORMAT = "hotcrush.aes256gcm-envelope.v1";
const ENVELOPE_KEYS = ["ciphertext", "header", "payload_tag", "wrap_tag", "wrapped_dek"];
const HEADER_KEYS = [
  "alg", "artifact_type", "content_id", "format", "hmac_key_id", "kek_id",
  "payload_iv", "plaintext_sha256", "wrap_iv",
];

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function unb64(value, expectedLength = null) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid_envelope_encoding");
  }
  const bytes = Buffer.from(value, "base64url");
  if (b64(bytes) !== value || (expectedLength !== null && bytes.length !== expectedLength)) {
    throw new TypeError("invalid_envelope_encoding");
  }
  return bytes;
}

function encryptGcm(key, iv, plaintext, aad) {
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decryptGcm(key, iv, ciphertext, tag, aad) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16,
  });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function exactKeys(value, expected, error) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(error);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    throw new TypeError(error);
  }
}

export function sealEnvelope(plaintext, options) {
  const keyring = validateKeyring(options.keyring);
  if (typeof options.artifactType !== "string" || typeof options.contentId !== "string") {
    throw new TypeError("invalid_envelope_metadata");
  }
  const plaintextBytes = Buffer.from(plaintext);
  const plaintextSha256 = sha256Hex(plaintextBytes);
  if (options.contentId !== plaintextSha256) throw new TypeError("content_id_mismatch");
  const dek = randomBytes(32);
  const payloadIv = randomBytes(12);
  const wrapIv = randomBytes(12);
  const header = {
    alg: "AES-256-GCM",
    artifact_type: options.artifactType,
    content_id: options.contentId,
    format: FORMAT,
    hmac_key_id: keyring.hmacKeyId,
    kek_id: keyring.kekId,
    payload_iv: b64(payloadIv),
    plaintext_sha256: plaintextSha256,
    wrap_iv: b64(wrapIv),
  };
  const payloadAad = canonicalizeJcs({
    alg: header.alg,
    artifact_type: header.artifact_type,
    content_id: header.content_id,
    format: header.format,
    hmac_key_id: header.hmac_key_id,
    payload_iv: header.payload_iv,
    plaintext_sha256: header.plaintext_sha256,
  });
  const wrapAad = canonicalizeJcs(header);
  const payload = encryptGcm(dek, payloadIv, plaintextBytes, payloadAad);
  const wrapped = encryptGcm(keyring.kek, wrapIv, dek, wrapAad);
  dek.fill(0);
  return canonicalizeJcs({
    ciphertext: b64(payload.ciphertext),
    header,
    payload_tag: b64(payload.tag),
    wrap_tag: b64(wrapped.tag),
    wrapped_dek: b64(wrapped.ciphertext),
  });
}

export function openEnvelope(envelopeBytes, options) {
  const keyring = validateKeyring(options.keyring);
  try {
    const envelope = parseCanonicalJcs(envelopeBytes);
    exactKeys(envelope, ENVELOPE_KEYS, "invalid_envelope_shape");
    exactKeys(envelope.header, HEADER_KEYS, "invalid_envelope_header");
    const header = envelope.header;
    if (
      header.format !== FORMAT || header.alg !== "AES-256-GCM" ||
      header.kek_id !== keyring.kekId || header.hmac_key_id !== keyring.hmacKeyId ||
      typeof options.expectedArtifactType !== "string" ||
      header.artifact_type !== options.expectedArtifactType
    ) {
      throw new TypeError("invalid_envelope_header");
    }
    const payloadIv = unb64(header.payload_iv, 12);
    const wrapIv = unb64(header.wrap_iv, 12);
    const wrapAad = canonicalizeJcs(header);
    const dek = decryptGcm(
      keyring.kek,
      wrapIv,
      unb64(envelope.wrapped_dek, 32),
      unb64(envelope.wrap_tag, 16),
      wrapAad,
    );
    try {
      const payloadAad = canonicalizeJcs({
        alg: header.alg,
        artifact_type: header.artifact_type,
        content_id: header.content_id,
        format: header.format,
        hmac_key_id: header.hmac_key_id,
        payload_iv: header.payload_iv,
        plaintext_sha256: header.plaintext_sha256,
      });
      const plaintext = decryptGcm(
        dek,
        payloadIv,
        unb64(envelope.ciphertext),
        unb64(envelope.payload_tag, 16),
        payloadAad,
      );
      if (sha256Hex(plaintext) !== header.plaintext_sha256 || header.content_id !== header.plaintext_sha256) {
        throw new TypeError("content_id_mismatch");
      }
      return plaintext;
    } finally {
      dek.fill(0);
    }
  } catch {
    throw new Error("envelope_authentication_failed");
  }
}

function safeFilename(filename) {
  return typeof filename === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(filename) &&
    path.basename(filename) === filename && !filename.includes("..") && !filename.includes("\0");
}

async function validateDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe_artifact_directory");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("unsafe_artifact_directory");
  }
  if ((info.mode & 0o077) !== 0) throw new Error("unsafe_artifact_directory");
}

export async function writeEncryptedArtifact(options) {
  if (!safeFilename(options.filename)) throw new Error("unsafe_artifact_filename");
  await validateDirectory(options.directory);
  const finalPath = path.join(options.directory, options.filename);
  const relative = path.relative(options.directory, finalPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("unsafe_artifact_filename");
  const envelope = sealEnvelope(options.plaintext, options);
  const temporaryName = `.${options.filename}.${randomBytes(12).toString("hex")}.partial`;
  const temporaryPath = path.join(options.directory, temporaryName);
  let handle;
  let published = false;
  try {
    const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(temporaryPath, flags, 0o600);
    await handle.writeFile(envelope);
    await handle.sync();
    await handle.close();
    handle = null;
    const info = await lstat(temporaryPath);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) {
      throw new Error("unsafe_partial_artifact");
    }
    await link(temporaryPath, finalPath);
    published = true;
    await unlink(temporaryPath);
    const directoryHandle = await open(options.directory, fsConstants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return {
      bytes: envelope.length,
      path: finalPath,
      sha256: sha256Hex(envelope),
    };
  } catch (error) {
    try { await handle?.close(); } catch { /* best effort */ }
    try { await unlink(temporaryPath); } catch { /* best effort */ }
    if (published) throw new Error("artifact_publish_outcome_unknown");
    throw error;
  }
}

export async function readEncryptedArtifact({
  path: artifactPath,
  keyring,
  expectedArtifactType,
  maxBytes = 64 * 1024 * 1024,
}) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(artifactPath, flags);
    const info = await handle.stat();
    if (
      !info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 ||
      info.size <= 0 || info.size > maxBytes ||
      (typeof process.getuid === "function" && info.uid !== process.getuid())
    ) {
      throw new Error("unsafe_encrypted_artifact");
    }
    const bytes = await handle.readFile();
    return openEnvelope(bytes, { expectedArtifactType, keyring });
  } finally {
    await handle?.close();
  }
}

export { FORMAT as ENVELOPE_FORMAT };
