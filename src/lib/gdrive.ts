/**
 * Google Drive cloud sync — zero-knowledge.
 *
 * NOTHING plaintext ever leaves the device. What's uploaded is exactly the
 * same sealed vault blob the encrypted backups use: the whole ledger as one
 * AES-256-GCM ciphertext under a key derived from the vault passphrase
 * (PBKDF2-SHA256 @ 600k). The envelope adds only transport metadata
 * (opaque device id, monotonic rev, timestamp) for conflict detection —
 * no notes, amounts, categories or account names appear outside the cipher.
 *
 * Storage location: the appDataFolder — a hidden folder only this app's
 * OAuth scope (drive.appdata, the narrowest Drive scope) can touch.
 *
 * The OAuth Client ID is yours (created in Google Cloud Console) and is the
 * only thing stored locally; access tokens live in memory for one hour and
 * are never persisted.
 */
import { db, kvGet, kvSet } from "../db";
import type { SnapshotData } from "../types";
import { decryptJSON, uid, type EncPayload } from "./core";
import { isLive, restoreTables } from "./vault";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "paisabook-vault.paisa.json";
const GIS_SRC = "https://accounts.google.com/gsi/client";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export interface CloudState {
  enabled: boolean;
  clientId: string;
  fileId: string | null;
  /** highest rev this device knows about on Drive */
  rev: number;
  lastSyncAt: string | null;
  auto: boolean;
}

export interface CloudEnvelope {
  app: "paisabook";
  kind: "cloud-vault";
  v: 1;
  /** opaque random id — never a name/model/account */
  device: string;
  rev: number;
  updatedAt: string;
  payload: EncPayload;
}

const DEFAULT_STATE: CloudState = { enabled: false, clientId: "", fileId: null, rev: 0, lastSyncAt: null, auto: true };

export async function getCloudState(): Promise<CloudState> {
  const s = await kvGet<CloudState>("cloud.state");
  return { ...DEFAULT_STATE, ...(s ?? {}) };
}
export async function saveCloudState(patch: Partial<CloudState>): Promise<CloudState> {
  const next = { ...(await getCloudState()), ...patch };
  await kvSet("cloud.state", next);
  cloudListeners.forEach((f) => f());
  return next;
}

async function deviceId(): Promise<string> {
  let id = await kvGet<string>("cloud.device");
  if (!id) {
    id = uid();
    await kvSet("cloud.device", id);
  }
  return id;
}

/* ---------------- Google Identity Services ---------------- */

interface GISTokenResponse { access_token?: string; error?: string; expires_in?: number }
interface GISTokenClient { requestAccessToken: (opts?: { prompt?: string }) => void }
interface GIS {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: { client_id: string; scope: string; callback: (r: GISTokenResponse) => void }) => GISTokenClient;
    };
  };
}

let gisPromise: Promise<GIS> | null = null;
function loadGIS(): Promise<GIS> {
  const w = window as { google?: GIS };
  if (w.google?.accounts?.oauth2) return Promise.resolve(w.google);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise<GIS>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => {
      const g = (window as { google?: GIS }).google;
      if (g?.accounts?.oauth2) resolve(g);
      else { gisPromise = null; reject(new Error("Google sign-in library failed to initialise.")); }
    };
    s.onerror = () => { gisPromise = null; reject(new Error("Could not reach Google sign-in — are you offline?")); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

let tokenCache: { value: string; expiresAt: number } | null = null;

function requestToken(clientId: string, interactive: boolean): Promise<string> {
  return loadGIS().then(
    (gis) =>
      new Promise<string>((resolve, reject) => {
        const client = gis.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (r) => {
            if (r.access_token) {
              tokenCache = { value: r.access_token, expiresAt: Date.now() + ((r.expires_in ?? 3600) - 120) * 1000 };
              resolve(r.access_token);
            } else {
              reject(new Error(r.error === "popup_closed" ? "The Google sign-in window was closed." : `Google sign-in failed (${r.error ?? "unknown"}). Check the Client ID and authorized origins.`));
            }
          },
        });
        client.requestAccessToken({ prompt: interactive ? "consent" : "" });
      })
  );
}

/** Silent first; falls back to an interactive consent popup. Token lives in memory only. */
export async function ensureToken(clientId: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  try {
    return await requestToken(clientId, false);
  } catch {
    return await requestToken(clientId, true);
  }
}

export function disconnectToken(): void {
  tokenCache = null;
}

/* ---------------- Drive REST (appDataFolder) ---------------- */

class DriveError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function api(token: string, url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let msg = `Drive request failed (${res.status})`;
    if (res.status === 401) msg = "Google session expired — connect again.";
    if (res.status === 404) msg = "not-found";
    throw new DriveError(res.status, msg);
  }
  return res;
}

interface DriveFileMeta { id: string; modifiedTime?: string }

async function findVaultFile(token: string): Promise<DriveFileMeta | null> {
  const q = new URLSearchParams({ spaces: "appDataFolder", q: `name = '${FILE_NAME}'`, fields: "files(id,modifiedTime)" });
  const res = await api(token, `${API}/files?${q.toString()}`);
  const body = (await res.json()) as { files?: DriveFileMeta[] };
  return body.files?.[0] ?? null;
}

async function downloadEnvelope(token: string, fileId: string): Promise<CloudEnvelope> {
  const res = await api(token, `${API}/files/${fileId}?alt=media`);
  return (await res.json()) as CloudEnvelope;
}

async function uploadEnvelope(token: string, envelope: CloudEnvelope, fileId: string | null): Promise<string> {
  const boundary = `pb${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${JSON.stringify(envelope)}\r\n` +
    `--${boundary}--`;
  const url = fileId
    ? `${UPLOAD}/files/${fileId}?uploadType=multipart`
    : `${UPLOAD}/files?uploadType=multipart`;
  const res = await api(token, url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const out = (await res.json()) as DriveFileMeta;
  return out.id;
}

/* ---------------- sync operations ---------------- */

export interface RemoteInfo {
  envelope: CloudEnvelope;
  fileId: string;
}

export async function fetchRemote(clientId: string): Promise<RemoteInfo | null> {
  const token = await ensureToken(clientId);
  const file = await findVaultFile(token);
  if (!file) return null;
  const envelope = await downloadEnvelope(token, file.id);
  return { envelope, fileId: file.id };
}

/** Seal the live ledger and push it. Returns the new rev. */
export async function pushCloud(state: CloudState): Promise<number> {
  const { sealForCloud } = await import("./vault");
  const payload = await sealForCloud(); // throws unless the vault is unlocked this session
  const me = await deviceId();
  const remote = await fetchRemote(state.clientId).catch(() => null);
  const baseRev = Math.max(state.rev, remote?.envelope.rev ?? 0);
  const envelope: CloudEnvelope = {
    app: "paisabook", kind: "cloud-vault", v: 1,
    device: me, rev: baseRev + 1, updatedAt: new Date().toISOString(), payload,
  };
  const token = await ensureToken(state.clientId);
  const fileId = await uploadEnvelope(token, envelope, remote?.fileId ?? state.fileId);
  await saveCloudState({ fileId, rev: envelope.rev, lastSyncAt: envelope.updatedAt });
  return envelope.rev;
}

/**
 * Pull & restore. Tries the in-memory session key first (instant when this
 * device pushed it); otherwise the caller supplies the vault passphrase.
 */
export async function pullCloud(state: CloudState, passphrase: string | null): Promise<{ applied: boolean; rev: number; neededPassphrase: boolean }> {
  const remote = await fetchRemote(state.clientId);
  if (!remote) throw new Error("No PaisaBook vault on Drive yet.");
  let data: SnapshotData;
  let neededPassphrase = false;
  try {
    if (!isLive()) throw new Error("no session key");
    data = await decryptJSON<SnapshotData>(remote.envelope.payload.iv, remote.envelope.payload.ct, await sessionKey());
  } catch {
    if (!passphrase) return { applied: false, rev: remote.envelope.rev, neededPassphrase: true };
    const key = await import("./core").then((c) => c.deriveKey(passphrase, c.unb64(remote.envelope.payload.salt), remote.envelope.payload.iter));
    data = await decryptJSON<SnapshotData>(remote.envelope.payload.iv, remote.envelope.payload.ct, key);
    neededPassphrase = true;
  }
  setCloudSuppress(true);
  try {
    await restoreTables(data);
  } finally {
    setCloudSuppress(false);
  }
  await saveCloudState({ fileId: remote.fileId, rev: remote.envelope.rev, lastSyncAt: new Date().toISOString() });
  return { applied: true, rev: remote.envelope.rev, neededPassphrase };
}

async function sessionKey(): Promise<CryptoKey> {
  const v = await import("./vault");
  const k = v.sessionKeyMaterial();
  if (!k) throw new Error("no session key");
  return k;
}

export async function clearCloudVault(clientId: string): Promise<void> {
  const token = await ensureToken(clientId);
  const file = await findVaultFile(token);
  if (file) {
    const res = await fetch(`${API}/files/${file.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 404) throw new DriveError(res.status, `Could not delete the Drive vault (${res.status}).`);
  }
}

/* ---------------- automatic background sync ---------------- */

let suppress = false;
export function setCloudSuppress(v: boolean): void {
  suppress = v;
}

let dirty = false;
let watcherStarted = false;
let watcherTimer = 0;

function markDirty(): void {
  if (!suppress) dirty = true;
}

/** Hooks the ledger tables once; pushes debounced changes when enabled + online. */
export function startCloudWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  for (const t of [db.accounts, db.entries, db.rules, db.reservedFunds, db.plannedExpenses, db.goals, db.budgets]) {
    t.hook("creating", () => markDirty());
    t.hook("updating", () => markDirty());
    t.hook("deleting", () => markDirty());
  }
  watcherTimer = window.setInterval(() => void autoTick(), 20_000);
  void autoTick();
}

export function stopCloudWatcher(): void {
  if (watcherTimer) window.clearInterval(watcherTimer);
  watcherStarted = false;
}

async function autoTick(): Promise<void> {
  try {
    if (!dirty || suppress || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    const state = await getCloudState();
    if (!state.enabled || !state.auto || !state.clientId) return;
    const locked = (await kvGet<boolean>("vault.locked")) ?? true;
    if (locked || !isLive()) return; // vault must be set up AND unlocked this session
    dirty = false;
    await pushCloud(state);
  } catch {
    dirty = true; // retry next tick
  }
}

/** Convenience for the UI: is there a signed-in, usable session right now? */
export function hasToken(): boolean {
  return !!tokenCache && tokenCache.expiresAt > Date.now();
}

/* ---------------- tiny reactive hook ---------------- */

const cloudListeners = new Set<() => void>();
export function subscribeCloud(fn: () => void): () => void {
  cloudListeners.add(fn);
  return () => {
    cloudListeners.delete(fn);
  };
}
