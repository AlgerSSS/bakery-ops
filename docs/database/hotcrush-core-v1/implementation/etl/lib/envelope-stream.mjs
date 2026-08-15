import {
  createCipheriv,
  createDecipheriv,
  createHash,
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

import { canonicalizeJcs, parseCanonicalJcs } from "./canonical.mjs";
import { validateKeyring } from "./keys.mjs";

const FORMAT = "hotcrush.aes256gcm-stream.v1";
const MAGIC = Buffer.from("HOTCRUSH-AES256GCM-STREAM-V1\n", "ascii");
const TAG_BYTES = 16;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_GCM_PLAINTEXT_BYTES = 68_719_476_704;
const HEADER_KEYS = [
  "alg",
  "artifact_type_sha256",
  "format",
  "hmac_key_id",
  "kek_id",
  "payload_iv",
  "wrap_iv",
  "wrap_tag",
  "wrapped_dek",
];
const DESCRIPTOR_KEYS = [
  "alg",
  "artifact_type_sha256",
  "format",
  "hmac_key_id",
  "kek_id",
  "payload_iv",
  "wrap_iv",
];

function b64(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function unb64(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid_stream_envelope_encoding");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedLength || b64(bytes) !== value) {
    throw new TypeError("invalid_stream_envelope_encoding");
  }
  return bytes;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("invalid_stream_envelope_header");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError("invalid_stream_envelope_header");
  }
}

function descriptorFromHeader(header) {
  return Object.fromEntries(DESCRIPTOR_KEYS.map((key) => [key, header[key]]));
}

function encryptGcm(key, iv, plaintext, aad) {
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decryptGcm(key, iv, ciphertext, tag, aad) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function safeFilename(filename) {
  return typeof filename === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/.test(filename) &&
    path.basename(filename) === filename &&
    !filename.includes("..") &&
    !filename.includes("\0");
}

export async function assertSafeArtifactDirectory(directory) {
  let info;
  try {
    info = await lstat(directory);
  } catch {
    throw new Error("unsafe_artifact_directory");
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe_artifact_directory");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("unsafe_artifact_directory");
  }
  if ((info.mode & 0o077) !== 0) throw new Error("unsafe_artifact_directory");
  return Object.freeze({ dev: info.dev, ino: info.ino });
}

async function assertSameDirectory(directory, expected) {
  const actual = await assertSafeArtifactDirectory(directory);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("unsafe_artifact_directory");
  }
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes.subarray(offset));
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("encrypted_stream_write_failed");
    }
    offset += bytesWritten;
  }
}

export async function syncArtifactDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function validateArtifactTypeHash(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError("invalid_artifact_type_hash");
  }
}

export async function writeStreamingEncryptedArtifact({
  artifactTypeHash,
  directory,
  filename,
  keyring: keyringInput,
  plaintextChunks,
}) {
  validateArtifactTypeHash(artifactTypeHash);
  if (!safeFilename(filename)) throw new Error("unsafe_artifact_filename");
  if (!plaintextChunks || typeof plaintextChunks[Symbol.asyncIterator] !== "function") {
    throw new TypeError("plaintext_stream_required");
  }
  const directoryIdentity = await assertSafeArtifactDirectory(directory);
  const finalPath = path.join(directory, filename);
  const relative = path.relative(directory, finalPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("unsafe_artifact_filename");
  }

  let keyring;
  let dek;
  let cipher;
  let contentHash;
  let artifactHash;
  let headerBytes;
  let headerLength;
  let temporaryPath;
  let handle;
  let temporaryCreated = false;
  let published = false;
  let artifactBytes = 0;
  let contentBytes = 0;

  async function writeArtifact(bytes) {
    if (bytes.length === 0) return;
    await writeAll(handle, bytes);
    artifactHash.update(bytes);
    artifactBytes += bytes.length;
  }

  try {
    keyring = validateKeyring(keyringInput);
    dek = randomBytes(32);
    const payloadIv = randomBytes(12);
    const wrapIv = randomBytes(12);
    const descriptor = {
      alg: "AES-256-GCM",
      artifact_type_sha256: artifactTypeHash,
      format: FORMAT,
      hmac_key_id: keyring.hmacKeyId,
      kek_id: keyring.kekId,
      payload_iv: b64(payloadIv),
      wrap_iv: b64(wrapIv),
    };
    const wrapped = encryptGcm(keyring.kek, wrapIv, dek, canonicalizeJcs(descriptor));
    const header = {
      ...descriptor,
      wrap_tag: b64(wrapped.tag),
      wrapped_dek: b64(wrapped.ciphertext),
    };
    headerBytes = canonicalizeJcs(header);
    if (headerBytes.length > MAX_HEADER_BYTES) {
      throw new Error("stream_envelope_header_too_large");
    }
    headerLength = Buffer.alloc(4);
    headerLength.writeUInt32BE(headerBytes.length);
    cipher = createCipheriv("aes-256-gcm", dek, payloadIv, { authTagLength: TAG_BYTES });
    cipher.setAAD(headerBytes);
    contentHash = createHash("sha256");
    artifactHash = createHash("sha256");
    const temporaryName = `.${filename}.${randomBytes(12).toString("hex")}.partial`;
    temporaryPath = path.join(directory, temporaryName);
    const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW ?? 0);
    handle = await open(temporaryPath, flags, 0o600);
    temporaryCreated = true;
    await writeArtifact(MAGIC);
    await writeArtifact(headerLength);
    await writeArtifact(headerBytes);
    for await (const chunkInput of plaintextChunks) {
      if (!(Buffer.isBuffer(chunkInput) || chunkInput instanceof Uint8Array)) {
        throw new TypeError("invalid_plaintext_stream_chunk");
      }
      const chunk = Buffer.from(chunkInput.buffer, chunkInput.byteOffset, chunkInput.byteLength);
      if (chunk.length > MAX_GCM_PLAINTEXT_BYTES - contentBytes) {
        throw new Error("stream_envelope_plaintext_too_large");
      }
      contentHash.update(chunk);
      contentBytes += chunk.length;
      await writeArtifact(cipher.update(chunk));
    }
    await writeArtifact(cipher.final());
    await writeArtifact(cipher.getAuthTag());
    await handle.sync();
    await handle.close();
    handle = null;
    const partial = await lstat(temporaryPath);
    if (!partial.isFile() || partial.isSymbolicLink() || partial.nlink !== 1 ||
        (partial.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && partial.uid !== process.getuid())) {
      throw new Error("unsafe_partial_artifact");
    }
    await assertSameDirectory(directory, directoryIdentity);
    await link(temporaryPath, finalPath);
    published = true;
    await unlink(temporaryPath);
    temporaryCreated = false;
    const final = await lstat(finalPath);
    if (!final.isFile() || final.isSymbolicLink() || final.nlink !== 1 ||
        (final.mode & 0o777) !== 0o600 || final.size !== artifactBytes) {
      throw new Error("unsafe_encrypted_artifact");
    }
    await assertSameDirectory(directory, directoryIdentity);
    await syncArtifactDirectory(directory);
    return Object.freeze({
      artifact_sha256: artifactHash.digest("hex"),
      bytes: artifactBytes,
      content_bytes: contentBytes,
      content_sha256: contentHash.digest("hex"),
      path: finalPath,
    });
  } catch (error) {
    try { await handle?.close(); } catch { /* best effort */ }
    if (temporaryCreated) {
      try { await unlink(temporaryPath); } catch { /* best effort */ }
    }
    if (published) {
      try {
        await unlink(finalPath);
        await syncArtifactDirectory(directory);
      } catch {
        throw new Error("artifact_cleanup_failed");
      }
    }
    throw error;
  } finally {
    dek?.fill(0);
    keyring?.kek.fill(0);
    keyring?.hmacKey.fill(0);
  }
}

async function readExact(handle, length, position) {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(output, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new Error("stream_envelope_truncated");
    offset += bytesRead;
  }
  return output;
}

export async function verifyStreamingEncryptedArtifact({
  expectedArtifactTypeHash,
  keyring: keyringInput,
  maxBytes = 1024 * 1024 * 1024,
  openFileImpl = open,
  path: artifactPath,
}) {
  validateArtifactTypeHash(expectedArtifactTypeHash);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("invalid_max_bytes");
  if (typeof openFileImpl !== "function") throw new TypeError("invalid_open_file_implementation");
  const keyring = validateKeyring(keyringInput);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  let dek;
  let operationError;
  let closeError;
  let result;
  try {
    handle = await openFileImpl(artifactPath, flags);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 ||
        info.size <= MAGIC.length + 4 + TAG_BYTES || info.size > maxBytes ||
        (typeof process.getuid === "function" && info.uid !== process.getuid())) {
      throw new Error("unsafe_encrypted_artifact");
    }
    const magic = await readExact(handle, MAGIC.length, 0);
    if (!magic.equals(MAGIC)) throw new Error("invalid_stream_envelope_magic");
    const encodedLength = await readExact(handle, 4, MAGIC.length);
    const headerLength = encodedLength.readUInt32BE();
    if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
      throw new Error("invalid_stream_envelope_header");
    }
    const headerOffset = MAGIC.length + 4;
    const headerBytes = await readExact(handle, headerLength, headerOffset);
    const header = parseCanonicalJcs(headerBytes, { maxBytes: MAX_HEADER_BYTES });
    exactKeys(header, HEADER_KEYS);
    if (header.format !== FORMAT || header.alg !== "AES-256-GCM" ||
        header.artifact_type_sha256 !== expectedArtifactTypeHash ||
        header.kek_id !== keyring.kekId || header.hmac_key_id !== keyring.hmacKeyId) {
      throw new Error("invalid_stream_envelope_header");
    }
    const descriptor = descriptorFromHeader(header);
    exactKeys(descriptor, DESCRIPTOR_KEYS);
    dek = decryptGcm(
      keyring.kek,
      unb64(header.wrap_iv, 12),
      unb64(header.wrapped_dek, 32),
      unb64(header.wrap_tag, TAG_BYTES),
      canonicalizeJcs(descriptor),
    );
    const payloadOffset = headerOffset + headerLength;
    const ciphertextBytes = info.size - payloadOffset - TAG_BYTES;
    if (ciphertextBytes < 0) throw new Error("stream_envelope_truncated");
    const payloadTag = await readExact(handle, TAG_BYTES, payloadOffset + ciphertextBytes);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dek,
      unb64(header.payload_iv, 12),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(payloadTag);
    const contentHash = createHash("sha256");
    const artifactHash = createHash("sha256");
    artifactHash.update(magic);
    artifactHash.update(encodedLength);
    artifactHash.update(headerBytes);
    let position = payloadOffset;
    let remaining = ciphertextBytes;
    let contentBytes = 0;
    while (remaining > 0) {
      const length = Math.min(64 * 1024, remaining);
      const encrypted = await readExact(handle, length, position);
      artifactHash.update(encrypted);
      const plaintext = decipher.update(encrypted);
      contentHash.update(plaintext);
      contentBytes += plaintext.length;
      position += length;
      remaining -= length;
    }
    const final = decipher.final();
    contentHash.update(final);
    contentBytes += final.length;
    artifactHash.update(payloadTag);
    result = Object.freeze({
      artifact_sha256: artifactHash.digest("hex"),
      bytes: info.size,
      content_bytes: contentBytes,
      content_sha256: contentHash.digest("hex"),
    });
  } catch {
    operationError = new Error("stream_envelope_authentication_failed");
  } finally {
    dek?.fill(0);
    keyring.kek.fill(0);
    keyring.hmacKey.fill(0);
    try {
      await handle?.close();
    } catch {
      closeError = new Error("stream_envelope_close_failed");
    }
  }
  if (operationError) {
    if (closeError) {
      Object.defineProperty(operationError, "closeFailure", {
        configurable: false,
        enumerable: false,
        value: closeError,
        writable: false,
      });
    }
    throw operationError;
  }
  if (closeError) throw closeError;
  return result;
}

export { FORMAT as STREAM_ENVELOPE_FORMAT };
