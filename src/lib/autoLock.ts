/**
 * Auto-lock manager - locks the vault after configurable inactivity
 * or when the tab becomes hidden.
 * 
 * Configurable timeouts: 2 minutes, 5 minutes, or immediate on tab switch.
 */

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleTimeoutMs = 2 * 60 * 1000; // default 2 minutes
let lockOnTabSwitch = true;
let isEnabled = true;
let lastActivity = Date.now();

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'mousemove'];

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
    const { vaultLocked, instantLock, vaultEnabled } = await import('./vault');
    const enabled = await vaultEnabled();
    if (!enabled) return; // vault not enabled, nothing to lock
    const locked = await vaultLocked();
    if (!locked) {
      await instantLock();
      console.log('[autoLock] Vault auto-locked due to inactivity');
      // Dispatch custom event for UI notification
      window.dispatchEvent(new CustomEvent('vault-auto-locked'));
    }
  } catch (e) {
    console.error('[autoLock] Failed to auto-lock:', e);
  }
}

async function handleVisibilityChange(): Promise<void> {
  if (!isEnabled || !lockOnTabSwitch) return;
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    await tryAutoLock();
  }
}

export function initAutoLock(): void {
  if (typeof window === 'undefined') return;
  
  // Load saved settings from localStorage
  try {
    const saved = localStorage.getItem('pb-autolock-ms');
    if (saved) {
      idleTimeoutMs = parseInt(saved, 10) || 2 * 60 * 1000;
    }
    const enabledStr = localStorage.getItem('pb-autolock-enabled');
    isEnabled = enabledStr !== 'false';
    const tabSwitchStr = localStorage.getItem('pb-autolock-tabswitch');
    lockOnTabSwitch = tabSwitchStr !== 'false';
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

export function setLockOnTabSwitch(enabled: boolean): void {
  lockOnTabSwitch = enabled;
  try {
    localStorage.setItem('pb-autolock-tabswitch', enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}

export function getAutoLockSettings(): { timeoutMs: number; enabled: boolean; lockOnTabSwitch: boolean } {
  return { timeoutMs: idleTimeoutMs, enabled: isEnabled, lockOnTabSwitch };
}

/** Get human-readable timeout label */
export function getTimeoutLabel(): string {
  if (idleTimeoutMs <= 60000) return '1 min';
  if (idleTimeoutMs <= 2 * 60 * 1000) return '2 min';
  if (idleTimeoutMs <= 5 * 60 * 1000) return '5 min';
  if (idleTimeoutMs <= 15 * 60 * 1000) return '15 min';
  return '30+ min';
}
