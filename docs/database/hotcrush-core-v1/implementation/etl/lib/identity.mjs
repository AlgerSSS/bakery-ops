import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SOURCE_ROW_NAMESPACE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";
const HMAC_DIGESTS = new WeakSet();

function frame(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function domainHmac(key, context, payload) {
  const secret = Buffer.from(key);
  if (secret.length !== 32 || typeof context !== "string" || context.length === 0) {
    throw new TypeError("invalid_hmac_input");
  }
  const digest = createHmac("sha256", secret)
    .update(frame(Buffer.from(context, "utf8")))
    .update(frame(Buffer.from(payload)))
    .digest();
  HMAC_DIGESTS.add(digest);
  return digest;
}

export function verifyDomainHmac(key, context, payload, expected) {
  const actual = domainHmac(key, context, payload);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function uuidV5(namespace, nameBytes) {
  if (typeof namespace !== "string" || !UUID_PATTERN.test(namespace)) {
    throw new TypeError("invalid_uuid_namespace");
  }
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(Buffer.from(nameBytes)).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function privateDeterministicUuid(namespace, hmacKey, context, canonicalPayload) {
  const privateName = domainHmac(hmacKey, context, canonicalPayload);
  return uuidV5FromIdentityHmac(privateName, namespace);
}

export function uuidV5FromIdentityHmac(identityHmac, namespace = SOURCE_ROW_NAMESPACE) {
  if (!Buffer.isBuffer(identityHmac) || identityHmac.length !== 32 || !HMAC_DIGESTS.has(identityHmac)) {
    throw new TypeError("identity_hmac_required");
  }
  return uuidV5(namespace, Buffer.from(`hmac-sha256:${identityHmac.toString("hex")}`, "ascii"));
}
