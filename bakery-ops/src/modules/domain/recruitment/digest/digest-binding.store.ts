// digest-binding.store.ts
//
// Lightweight, file-backed store for the 23:00 trial digest's "pending binding": when we send a manager
// or chef a numbered digest of tomorrow's trials, we remember what each numbered option maps to so the
// pre-router can interpret their 1-tap reply. Mirrors the existing notification-state.ts file pattern
// (no new migration this pass).
//
// Idempotency key = `${storeId}|${recipientPhone}|${localDate}`: re-running the digest for the same
// store/recipient/day overwrites (never duplicates), so a restart won't double-send.

import * as fs from "fs";
import * as path from "path";
import { logger } from "../../../shared/logger";
import { localDate } from "../../../channel/whatsapp/outbound.config";

const STATE_FILE = path.resolve(process.cwd(), "digest-bindings.json");

/** Which digest a binding belongs to. Defaults to 'trial' when absent (back-compat with old files). */
export type DigestKind = "trial" | "interview" | "offer";

/** One numbered option in a digest: the trial appointment it refers to + its candidate. */
export interface DigestOption {
  optionIndex: number; // 1-based, matches the number shown to the recipient
  appointmentId: string;
  applicationId: string;
  larkRecordId?: string;
  candidateName: string;
  roleArea?: "FOH" | "BOH";
  offerId?: string; // set for kind='offer' bindings (the draft offer awaiting approval)
}

export interface DigestBinding {
  storeId: string;
  recipientPhone: string;
  recipientUserId: string;
  recipientRole: "store_manager" | "kitchen_manager" | "owner";
  localDate: string; // YYYY-MM-DD (Asia/Kuala_Lumpur)
  kind?: DigestKind; // 'trial' (default) | 'interview' | 'offer'
  options: DigestOption[];
  createdAt: string;
}

type BindingMap = Record<string, DigestBinding>;

function keyFor(
  storeId: string,
  recipientPhone: string,
  localDateStr: string,
  kind: DigestKind = "trial",
): string {
  return `${storeId}|${recipientPhone}|${localDateStr}|${kind}`;
}

function loadAll(): BindingMap {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as BindingMap;
    }
  } catch (err) {
    logger.warn("digest-binding: failed to load, starting empty", { error: String(err) });
  }
  return {};
}

function saveAll(map: BindingMap): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(map, null, 2));
  } catch (err) {
    logger.error("digest-binding: failed to save", { error: String(err) });
  }
}

/** Returns true if a binding already exists for (store, recipient, date, kind) — i.e. digest already sent. */
export function hasBinding(
  storeId: string,
  recipientPhone: string,
  localDateStr: string,
  kind: DigestKind = "trial",
): boolean {
  const map = loadAll();
  return Boolean(map[keyFor(storeId, recipientPhone, localDateStr, kind)]);
}

/** Idempotently store the binding for (store, recipient, date, kind). Overwrites any existing entry. */
export function putBinding(binding: DigestBinding): void {
  const map = loadAll();
  // Opportunistic prune: drop bindings from earlier local days so the file doesn't grow unbounded.
  const today = localDate();
  for (const k of Object.keys(map)) {
    if (map[k].localDate < today) delete map[k];
  }
  map[keyFor(binding.storeId, binding.recipientPhone, binding.localDate, binding.kind ?? "trial")] =
    binding;
  saveAll(map);
}

/**
 * Find the most recent active binding for a recipient phone, restricted to TODAY (Asia/Kuala_Lumpur).
 * The date guard prevents a stale binding from a previous day permanently intercepting a manager's
 * normal ops messages. Used by the pre-router to interpret a manager/chef's numbered reply.
 */
export function findBindingByPhone(recipientPhone: string): DigestBinding | null {
  const map = loadAll();
  const today = localDate();
  const matches = Object.values(map).filter(
    (b) => b.recipientPhone === recipientPhone && b.localDate === today,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matches[0];
}

/** Remove a binding once its reply has been handled (keeps the file from growing unbounded). */
export function clearBinding(
  storeId: string,
  recipientPhone: string,
  localDateStr: string,
  kind: DigestKind = "trial",
): void {
  const map = loadAll();
  delete map[keyFor(storeId, recipientPhone, localDateStr, kind)];
  saveAll(map);
}
