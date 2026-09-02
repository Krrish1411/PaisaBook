/** Formatting, crypto, compression and tiny DOM helpers — zero dependencies. */
import { useEffect, useState, useSyncExternalStore } from "react";

/* ---------------- privacy mask (hide all numbers) ---------------- */

let privacyMasked = (() => {
  try {
    return sessionStorage.getItem("pb-privacy") === "1";
  } catch {
    return false;
  }
})();
const privacyListeners = new Set<() => void>();

export const isMasked = (): boolean => privacyMasked;

export function setPrivacyMasked(v: boolean): void {
  privacyMasked = v;
  try {
    if (v) sessionStorage.setItem("pb-privacy", "1");
    else sessionStorage.removeItem("pb-privacy");
  } catch {
    /* session-only anyway */
  }
  privacyListeners.forEach((fn) => fn());
}

const subscribePrivacy = (fn: () => void): (() => void) => {
  privacyListeners.add(fn);
  return () => {
    privacyListeners.delete(fn);
  };
};

/**
 * Reactive privacy store. Any component that calls this re-renders the moment
 * the mask flips — so every screen's numbers hide/unhide instantly, no
 * navigation needed.
 */
export function usePrivacy(): [boolean, (v: boolean) => void] {
  const masked = useSyncExternalStore(subscribePrivacy, isMasked);
  return [masked, setPrivacyMasked];
}

/* ---------------- money + dates ---------------- */

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtINR(v: number, opts?: { paise?: boolean; sign?: boolean }): string {
  if (privacyMasked) return "₹ •••••";
  const paise = opts?.paise ?? Math.abs(v % 1) > 0.004;
  const f = paise ? inr2.format(Math.abs(v)) : inr0.format(Math.abs(v));
  const sign = v < 0 ? "−" : opts?.sign ? "+" : "";
  return `${sign}₹${f}`;
}

export function fmtCompactINR(v: number): string {
  if (privacyMasked) return "₹ ••••";
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${inr0.format(v)}`;
}

export function pct(v: number, digits = 1): string {
  if (privacyMasked) return "••%";
  if (!isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Axis tick formatter that respects the privacy mask. */
export function maskTick(v: number): string {
  if (privacyMasked) return "••";
  const a = Math.abs(v);
  if (a >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}k`;
  return `${v}`;
}

/* ---------------- multi-currency ---------------- */

export const CURRENCIES = [
  { code: "INR", sym: "₹", name: "Indian Rupee" },
  { code: "USD", sym: "$", name: "US Dollar" },
  { code: "EUR", sym: "€", name: "Euro" },
  { code: "GBP", sym: "£", name: "British Pound" },
  { code: "AED", sym: "د.إ", name: "UAE Dirham" },
  { code: "SGD", sym: "S$", name: "Singapore Dollar" },
] as const;

/** Reference rates: 1 unit of currency = X INR. Editable in Settings. */
export const DEFAULT_RATES: Record<string, number> = {
  INR: 1, USD: 83.5, EUR: 90.8, GBP: 106.4, AED: 22.7, SGD: 62.4,
};

export const curSym = (code?: string | null): string =>
  CURRENCIES.find((c) => c.code === (code ?? "INR"))?.sym ?? "₹";

/** Format in the entry/account's own currency (privacy-aware). */
export function fmtMoney(v: number, code?: string | null, opts?: { paise?: boolean; sign?: boolean }): string {
  const sym = curSym(code);
  if (privacyMasked) return `${sym} ••••`;
  const paise = opts?.paise ?? Math.abs(v % 1) > 0.004;
  const f = paise ? inr2.format(Math.abs(v)) : inr0.format(Math.abs(v));
  const sign = v < 0 ? "−" : opts?.sign ? "+" : "";
  return `${sign}${sym}${f}`;
}

export const toINR = (v: number, code: string | undefined | null, rates: Record<string, number>): number =>
  v * (rates[code ?? "INR"] ?? 1);

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}
export const todayISO = () => toISO(new Date());

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return `${`${d.getDate()}`.padStart(2, "0")}/${`${d.getMonth() + 1}`.padStart(2, "0")}/${d.getFullYear()}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthKey = (d: Date) => `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}`;
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISO(d);
}

export function daysUntil(iso: string): number {
  const now = new Date(todayISO() + "T00:00:00");
  return Math.round((new Date(iso + "T00:00:00").getTime() - now.getTime()) / 86400000);
}

export function dueLabel(iso: string): string {
  const n = daysUntil(iso);
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  if (n > 1) return `due in ${n} days`;
  return `overdue ${-n}d`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- base64 / bytes ---------------- */

export function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Tolerant base64url → bytes. Accepts standard (+/) and URL-safe (−_) alphabets, with or without padding. */
export function unb64(s: string): Uint8Array {
  const std = (s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = {
  encode: (s: string) => new TextEncoder().encode(s),
  decode: (b: Uint8Array) => new TextDecoder().decode(b),
};

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/* ---------------- compression ---------------- */

type StreamCtor = new (f: string) => ReadableWritablePair<Uint8Array, Uint8Array>;

export async function gzipBytes(bytes: Uint8Array): Promise<{ bytes: Uint8Array; gz: boolean }> {
  const CS = (globalThis as { CompressionStream?: StreamCtor }).CompressionStream;
  if (!CS) return { bytes, gz: false };
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CS("gzip"));
    return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), gz: true };
  } catch {
    return { bytes, gz: false };
  }
}

export async function gunzipBytes(bytes: Uint8Array, gz: boolean): Promise<Uint8Array> {
  if (!gz) return bytes;
  const DS = (globalThis as { DecompressionStream?: StreamCtor }).DecompressionStream;
  if (!DS) throw new Error("Decompression unsupported in this browser");
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DS("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------------- crypto (Web Crypto, client-side only) ---------------- */

export interface EncPayload {
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function deriveKey(passphrase: string, salt: Uint8Array, iter = 310_000): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJSON(data: unknown, key: CryptoKey): Promise<{ iv: string; ct: string }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(JSON.stringify(data)));
  return { iv: b64(iv), ct: b64(ct) };
}

export async function decryptJSON<T = unknown>(ivB64: string, ctB64: string, key: CryptoKey): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) as BufferSource }, key, unb64(ctB64) as BufferSource);
  return JSON.parse(dec.decode(pt)) as T;
}

export async function sealWithPassphrase(data: unknown, passphrase: string): Promise<EncPayload> {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt, 600_000);
  const { iv, ct } = await encryptJSON(data, key);
  return { kdf: "PBKDF2-SHA256", iter: 600_000, salt: b64(salt), iv, ct };
}

export async function openWithPassphrase<T = unknown>(p: EncPayload, passphrase: string): Promise<T> {
  return decryptJSON<T>(p.iv, p.ct, await deriveKey(passphrase, unb64(p.salt), p.iter));
}

const PHRASE_WORDS = [
  "lotus", "mango", "chai", "rupee", "banyan", "peacock", "saffron", "monsoon",
  "jugaad", "paisa", "haldi", "neem", "diya", "rangoli", "bazaar", "karma",
  "gulab", "masala", "sitar", "vedic", "ganga", "shanti", "artha", "bindi",
  "dholak", "mehndi", "thali", "chakra", "mantra", "tandoor", "jhumka", "peepal",
  "kurta", "lassi", "papad", "mural", "zari", "ghee", "kolam", "suraj",
  "chanda", "mitti", "seva", "utsav", "dhara", "bhor", "shaam", "geet",
  "taal", "rasa", "vayu", "agni", "jala", "prithvi", "akash", "deepak",
  "phool", "patang", "chhatri", "jhula", "shehnai", "tabla", "mor", "koyal",
];

/** 4-word human-verifiable fingerprint of arbitrary bytes. */
export async function syncPhrase(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const n = (h[0] << 16) | (h[1] << 8) | h[2];
  const w = (i: number) => PHRASE_WORDS[(n >> (6 * (3 - i))) & 63];
  return `${w(0)}·${w(1)}·${w(2)}·${w(3)}`;
}

/* ---------------- downloads ---------------- */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const downloadText = (filename: string, text: string, type = "text/plain") =>
  downloadBlob(filename, new Blob([text], { type }));

/* ---------------- preferences ---------------- */

export type ThemeId = "pine" | "ember" | "night" | "ocean" | "dusk" | "sand" | "berry" | "graphite";
export type LayoutEngine = "classic" | "modern" | "compact" | "spacious";
export type FontScale = "100" | "110" | "125" | "150";

export interface Prefs {
  theme: ThemeId;
  layoutEngine: LayoutEngine;
  fontScale: FontScale;
  autoLockMinutes: number;
}

let prefs: Prefs = { theme: "pine", layoutEngine: "classic", fontScale: "100", autoLockMinutes: 5 };
const prefListeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const VALID_THEMES: ThemeId[] = ["pine", "ember", "night", "ocean", "dusk", "sand", "berry", "graphite"];
const VALID_LAYOUTS: LayoutEngine[] = ["classic", "modern", "compact", "spacious"];
const VALID_SCALES: FontScale[] = ["100", "110", "125", "150"];

function applyTheme(theme: ThemeId): void {
  try {
    const doc = document as Document & { startViewTransition?: (fn: () => void) => void };
    const run = () => {
      document.documentElement.dataset.theme = theme;
    };
    if (typeof doc.startViewTransition === "function") doc.startViewTransition(run);
    else run();
  } catch {
    /* no DOM */
  }
}

function applyFontScale(scale: FontScale): void {
  try {
    document.documentElement.style.fontSize = `${scale}%`;
  } catch {
    /* no DOM */
  }
}

function applyLayout(layout: LayoutEngine): void {
  try {
    document.documentElement.dataset.layout = layout;
  } catch {
    /* no DOM */
  }
}

try {
  const raw = storage()?.getItem("pb-prefs");
  if (raw) {
    const p = JSON.parse(raw) as Partial<Prefs>;
    prefs = {
      theme: VALID_THEMES.includes(p.theme as ThemeId) ? (p.theme as ThemeId) : "pine",
      layoutEngine: VALID_LAYOUTS.includes(p.layoutEngine as LayoutEngine) ? (p.layoutEngine as LayoutEngine) : "classic",
      fontScale: VALID_SCALES.includes(p.fontScale as FontScale) ? (p.fontScale as FontScale) : "100",
      autoLockMinutes: typeof p.autoLockMinutes === "number" && p.autoLockMinutes >= 0 ? p.autoLockMinutes : 5,
    };
  }
} catch { /* defaults */ }
applyTheme(prefs.theme);
applyFontScale(prefs.fontScale);
applyLayout(prefs.layoutEngine);

export const getPrefs = () => prefs;

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  prefs = { ...prefs, ...patch };
  applyTheme(prefs.theme);
  applyFontScale(prefs.fontScale);
  applyLayout(prefs.layoutEngine);
  try {
    storage()?.setItem("pb-prefs", JSON.stringify(prefs));
    storage()?.setItem("pb-theme", JSON.stringify(prefs.theme));
  } catch { /* in-memory */ }
  prefListeners.forEach((fn) => fn());
}

export function usePrefs(): [Prefs, (p: Partial<Prefs>) => Promise<void>] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x: number) => x + 1);
    prefListeners.add(fn);
    return () => {
      prefListeners.delete(fn);
    };
  }, []);
  return [prefs, savePrefs];
}
