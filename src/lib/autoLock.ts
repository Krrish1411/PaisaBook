/**
 * Auto-lock manager - locks the vault after configurable inactivity
 * or when the tab becomes hidden.
 */

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimeoutMs = 5 * 60 * 1000; // default 5 minutes
let isEnabled = true;
let lastActivity = Date.now();

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

function resetTimer(): void {
  if (!isEnabled) return;
  lastActivity = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void tryAutoLock();
  }, idleTimeoutMs);
}

async function tryAutoLock(): Promise<void> {
  try {
    const { vaultLocked, instantLock } = await import('./vault');
    const locked = await vaultLocked();
    if (!locked) {
      await instantLock();
      // Notify user somehow - could use a toast
      console.log('[autoLock] Vault auto-locked due to inactivity');
    }
  } catch (e) {
    console.error('[autoLock] Failed to auto-lock:', e);
  }
}

async function handleVisibilityChange(): Promise<void> {
  if (!isEnabled) return;
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    await tryAutoLock();
  }
}

export function initAutoLock(): void {
  if (typeof window === 'undefined') return;
  
  // Load saved timeout from localStorage
  try {
    const saved = localStorage.getItem('pb-autolock-ms');
    if (saved) {
      idleTimeoutMs = parseInt(saved, 10) || 5 * 60 * 1000;
    }
    const enabledStr = localStorage.getItem('pb-autolock-enabled');
    isEnabled = enabledStr !== 'false';
  } catch { /* ignore */ }

  if (!isEnabled) return;

  // Activity listeners
  ACTIVITY_EVENTS.forEach((evt) => {
    window.addEventListener(evt, resetTimer, { passive: true });
  });

  // Visibility change listener
  document.addEventListener('visibilitychange', () => void handleVisibilityChange());

  // Initial timer start
  resetTimer();
}

export function setAutoLockTimeout(ms: number): void {
  idleTimeoutMs = ms;
  try {
    localStorage.setItem('pb-autolock-ms', String(ms));
  } catch { /* ignore */ }
  resetTimer();
}

export function setAutoLockEnabled(enabled: boolean): void {
  isEnabled = enabled;
  try {
    localStorage.setItem('pb-autolock-enabled', enabled ? 'true' : 'false');
  } catch { /* ignore */ }
  if (!enabled && idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  } else if (enabled) {
    resetTimer();
  }
}

export function getAutoLockSettings(): { timeoutMs: number; enabled: boolean } {
  return { timeoutMs: idleTimeoutMs, enabled: isEnabled };
}
