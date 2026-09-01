/**
 * Vault Lock — mandatory encryption at rest for the local database.
 *
 * Sealed state: the whole ledger lives as one AES-256-GCM blob (key derived
 * from the passphrase with PBKDF2-SHA256 @ 600k rounds) and the plaintext
 * working tables are wiped. Unlocked state: the snapshot is restored for
 * normal use, and the derived key is held in memory for the session so the
 * app can (a) re-seal instantly on "Lock now" without re-typing the
 * passphrase and (b) verify the passphrase for privacy-mode unlocks.
 *
 *   locked   → IndexedDB holds ciphertext only
 *   unlocked → working tables in use (open session, like any client app)
 *
 * Sync traffic / sync files / backups each have their own separate E2EE.
 */
import { db, kvGet, kvSet, restoreAll, snapshotAll } from "../db";
import type { SnapshotData } from "../types";
import { decryptJSON, deriveKey, encryptJSON, openWithPassphrase, randomBytes, b64, unb64, type EncPayload } from "./core";

const BLOB_KEY = "vault.blob";
const LOCK_KEY = "vault.locked";
const KDF_ITER = 600_000;

/** Session-only key material (never persisted). */
let liveKey: CryptoKey | null = null;
let liveSalt: string | null = null;

export async function vaultLocked(): Promise<boolean> {
  return (await kvGet<boolean>(LOCK_KEY)) === true;
}

export async function vaultEnabled(): Promise<boolean> {
  return (await kvGet<EncPayload>(BLOB_KEY)) !== undefined;
}

async function sealSnapshot(snap: SnapshotData, key: CryptoKey, saltB64: string): Promise<EncPayload> {
  const { iv, ct } = await encryptJSON(snap, key);
  return { kdf: "PBKDF2-SHA256", iter: KDF_ITER, salt: saltB64, iv, ct };
}

/** Mandatory first-run setup: seal the current ledger, wipe plaintext, lock. */
export async function enableVault(passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, KDF_ITER);
  const blob = await sealSnapshot(await snapshotAll(), key, b64(salt));
  await kvSet(BLOB_KEY, blob);
  await kvSet(LOCK_KEY, true);
  liveKey = null;
  liveSalt = null;
  await clearLedgerTables();
}

/** Unlock: decrypt (verifies the passphrase), restore tables, keep key in memory. */
export async function unlockVault(passphrase: string): Promise<void> {
  const blob = await kvGet<EncPayload>(BLOB_KEY);
  if (!blob) throw new Error("No vault on this device.");
  const key = await deriveKey(passphrase, unb64(blob.salt), blob.iter);
  const data = await decryptJSON<SnapshotData>(blob.iv, blob.ct, key); // throws on wrong passphrase
  await restoreAll(data);
  await kvSet(LOCK_KEY, false);
  liveKey = key;
  liveSalt = blob.salt;
}

/** Passphrase check without restoring anything (privacy-mode unlock). */
export async function verifyVaultPassphrase(passphrase: string): Promise<boolean> {
  try {
    const blob = await kvGet<EncPayload>(BLOB_KEY);
    if (!blob) return false;
    await openWithPassphrase<unknown>(blob, passphrase);
    return true;
  } catch {
    return false;
  }
}

/** "Lock now": re-seal the CURRENT state with a fresh salt, wipe, lock. */
export async function resealAndLock(passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, KDF_ITER);
  const blob = await sealSnapshot(await snapshotAll(), key, b64(salt));
  await kvSet(BLOB_KEY, blob);
  await kvSet(LOCK_KEY, true);
  liveKey = null;
  liveSalt = null;
  await clearLedgerTables();
}

/** Instant lock using the in-memory session key — no passphrase prompt. */
export async function instantLock(): Promise<void> {
  if (!liveKey || !liveSalt) {
    // no live session key (e.g. vault disabled or never unlocked) — fall back to a plain lock flag only if a blob exists
    if (await vaultEnabled()) {
      await kvSet(LOCK_KEY, true);
      await clearLedgerTables();
    }
    return;
  }
  const blob = await sealSnapshot(await snapshotAll(), liveKey, liveSalt);
  await kvSet(BLOB_KEY, blob);
  await kvSet(LOCK_KEY, true);
  liveKey = null;
  liveSalt = null;
  await clearLedgerTables();
}

/* ---------------- cloud-sync integration ---------------- */

/** True while an unlocked session holds the derived key in memory. */
export function isLive(): boolean {
  return liveKey !== null;
}

/** The in-memory session key (never persisted) — lets Drive pulls decrypt instantly. */
export function sessionKeyMaterial(): CryptoKey | null {
  return liveKey;
}

/** Seal the live ledger for upload WITHOUT locking the app. */
export async function sealForCloud(): Promise<EncPayload> {
  if (!liveKey || !liveSalt) throw new Error("The vault is locked — unlock it first.");
  return sealSnapshot(await snapshotAll(), liveKey, liveSalt);
}

/** Restore ledger tables from decrypted cloud data (app keeps running). */
export async function restoreTables(snap: SnapshotData): Promise<void> {
  await restoreAll(snap);
}

async function clearLedgerTables(): Promise<void> {
  await db.transaction("rw", [db.accounts, db.entries, db.categories, db.reservedFunds, db.plannedExpenses, db.goals, db.budgets], async () => {
    await Promise.all([
      db.accounts.clear(), db.entries.clear(), db.categories.clear(),
      db.reservedFunds.clear(), db.plannedExpenses.clear(), db.goals.clear(), db.budgets.clear(),
    ]);
  });
}
