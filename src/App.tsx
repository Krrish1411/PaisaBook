import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, BarChart3, Eye, EyeOff, Home, IndianRupee, KeyRound, Lock, Palette, List, Plus, RefreshCw, Settings as SettingsIcon, ShieldCheck, Smartphone, UnlockKeyhole, Wallet,
} from "lucide-react";
import { db, seedCategories } from "./db";
import { cx, fmtCompactINR, usePrefs, usePrivacy } from "./lib/core";
import { Btn, Sheet, ThemePicker, ToastProvider, useToast } from "./components/ui";
import EntrySheet from "./components/EntrySheet";
import { initAutoLock } from "./lib/autoLock";

const Dashboard = lazy(() => import("./screens/Dashboard"));
const Entries = lazy(() => import("./screens/Entries"));
const Funds = lazy(() => import("./screens/Funds"));
const Reports = lazy(() => import("./screens/Reports"));
const Settings = lazy(() => import("./screens/Settings"));

type Tab = "home" | "txns" | "funds" | "reports" | "settings";

const NAV: Array<{ id: Tab; label: string; icon: ReactNode; kbd: string }> = [
  { id: "home", label: "Home", icon: <Home size={17} />, kbd: "1" },
  { id: "txns", label: "Entries", icon: <List size={17} />, kbd: "2" },
  { id: "funds", label: "Funds & Plans", icon: <Wallet size={17} />, kbd: "3" },
  { id: "reports", label: "Reports", icon: <BarChart3 size={17} />, kbd: "4" },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={17} />, kbd: "5" },
];

const MOBILE_TABS = NAV.slice(0, 4);

const TITLES: Record<Tab, string> = { home: "PaisaBook", txns: "Entries", funds: "Funds", reports: "Reports", settings: "Settings" };

/* ---------------- resilience ---------------- */

class Boundary extends Component<{ label: string; onRetry: () => void; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-4 my-8 rounded-2xl border border-flare-500/30 bg-card p-6 text-center anim-pop">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-flare-100 text-flare-600 grid place-items-center mb-3"><AlertTriangle size={22} /></div>
          <h2 className="font-display font-bold text-[17px] text-ink">The {this.props.label} screen hit a snag</h2>
          <p className="text-[12.5px] text-ink/55 mt-1.5 max-w-md mx-auto break-words">{String(this.state.error?.message ?? this.state.error)}</p>
          <p className="text-[11.5px] text-ink/40 mt-1">Your ledger is safe — nothing was lost.</p>
          <div className="flex justify-center gap-2 mt-4">
            <Btn onClick={() => { this.setState({ error: null }); this.props.onRetry(); }}>Try again</Btn>
            <Btn variant="outline" onClick={() => location.reload()}>Reload app</Btn>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ScreenFallback() {
  return (
    <div className="px-4 pt-6">
      <div className="h-32 rounded-2xl bg-pine-100/60 animate-pulse" />
      <div className="grid grid-cols-2 gap-2.5 mt-3">
        <div className="h-24 rounded-xl bg-pine-100/50 animate-pulse" />
        <div className="h-24 rounded-xl bg-pine-100/50 animate-pulse" />
      </div>
      <div className="h-40 rounded-xl bg-pine-100/40 animate-pulse mt-3" />
    </div>
  );
}

function BootGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "nostorage">("loading");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await seedCategories();
        if (live) setState("ready");
      } catch {
        if (live) setState("nostorage");
      }
    })();
    return () => { live = false; };
  }, []);
  if (state === "loading") return <Splash />;
  return (
    <>
      {state === "nostorage" && (
        <div className="mx-4 mt-4 flex items-start gap-2.5 rounded-xl border border-mari-400/50 bg-mari-100/80 px-3.5 py-3 text-[12.5px] text-mari-700 font-medium anim-fade-up">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Browser storage is unavailable here, so entries can’t be saved. The app still opens — check that storage isn’t blocked for this site.
        </div>
      )}
      {children}
    </>
  );
}

function Splash() {
  return (
    <div className="min-h-dvh hero-weave grid place-items-center">
      <div className="flex flex-col items-center gap-3 anim-fade">
        <span className="w-16 h-16 rounded-2xl bg-mari-500 text-white grid place-items-center shadow-2xl shadow-mari-600/40 animate-pulse">
          <IndianRupee size={32} />
        </span>
        <span className="font-display font-extrabold text-pine-100 text-[19px] tracking-tight">PaisaBook</span>
        <span className="text-[11.5px] text-pine-200/70">Opening your ledger…</span>
      </div>
    </div>
  );
}

/* ---------------- media ---------------- */

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setMatch(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [query]);
  return match;
}

/* ---------------- app ---------------- */

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [add, setAdd] = useState(false);
  const [themeSheet, setThemeSheet] = useState(false);
  const [prefs, updatePrefs] = usePrefs();
  const isDesktop = useMedia("(min-width: 1024px)");

  const [locked, setLocked] = useState<boolean | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await import("./lib/vault").catch(() => null);
      const enabled = (await v?.vaultEnabled()) ?? false;
      if (!enabled) {
        setNeedsSetup(true);
        setBooted(true);
        return;
      }
      const isLocked = (await v?.vaultLocked()) ?? false;
      setLocked(isLocked);
      if (!isLocked) {
        await seedCategories().catch(() => undefined);
        initAutoLock();
      }
      setBooted(true);
    })();
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  /* keyboard shortcuts */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!booted) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        setAdd(true);
      } else {
        const idx = ["1", "2", "3", "4", "5"].indexOf(k);
        if (idx >= 0) setTab(NAV[idx].id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [booted]);

  if (!booted) return <Splash />;
  if (needsSetup) return <VaultSetupGate />;
  if (locked) return <VaultLock />;

  const go = (t: string) => setTab(t as Tab);

  return (
    <div className="page-bg min-h-dvh">
      {isDesktop && <Sidebar tab={tab} setTab={setTab} openAdd={() => setAdd(true)} prefs={prefs} updatePrefs={updatePrefs} />}

      <div className={cx(isDesktop && "lg:pl-64")}>
        {/* mobile header */}
        <header className="sticky top-0 z-30 bg-moss/85 backdrop-blur border-b border-line/80 lg:hidden">
          <div className="px-4 h-[54px] flex items-center gap-3">
            <button onClick={() => setTab("home")} className="flex items-center gap-2.5 group" aria-label="PaisaBook home">
              <span className="w-9 h-9 rounded-xl hero-weave border border-pine-700 grid place-items-center text-mari-400 shadow-sm shadow-pine-900/30 group-active:scale-95 transition-transform">
                <IndianRupee size={17} />
              </span>
              <span className="font-display font-extrabold text-[17px] tracking-tight text-ink">
                {tab === "home" ? <>Paisa<span className="text-pine-700">Book</span></> : TITLES[tab]}
              </span>
            </button>
            <span className="ml-auto flex items-center gap-1.5">
              <PrivacyButton />
              <LockNowButton />
              <HeaderIcon icon={<Palette size={16} />} label="Theme" onClick={() => setThemeSheet(true)} />
              <HeaderIcon icon={<SettingsIcon size={16} />} label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
            </span>
          </div>
        </header>

        <main className="max-w-content safe-bottom pt-4 lg:pt-8">
          <BootGate>
            <Boundary label={TITLES[tab]} onRetry={() => setTab(tab)}>
              <div key={tab} className="page-enter">
                <Suspense fallback={<ScreenFallback />}>
                  {tab === "home" && <Dashboard go={go} openAdd={() => setAdd(true)} />}
                  {tab === "txns" && <Entries openAdd={() => setAdd(true)} />}
                  {tab === "funds" && <Funds go={go} />}
                  {tab === "reports" && <Reports go={go} />}
                  {tab === "settings" && <Settings />}
                </Suspense>
              </div>
            </Boundary>
          </BootGate>
        </main>
      </div>

      {/* mobile bottom nav + FAB */}
      <nav className="fixed bottom-0 inset-x-0 z-40 pointer-events-none lg:hidden">
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+10px)]">
          <div className="pointer-events-auto relative grid grid-cols-[1fr_1fr_64px_1fr_1fr] items-end rounded-2xl border border-pine-800/70 bg-pine-950/95 backdrop-blur px-2 pt-1.5 pb-2 shadow-2xl shadow-pine-950/50">
            <TabBtn t={MOBILE_TABS[0]} active={tab === "home"} onClick={() => setTab("home")} />
            <TabBtn t={MOBILE_TABS[1]} active={tab === "txns"} onClick={() => setTab("txns")} />
            <div className="relative h-12">
              <button
                onClick={() => setAdd(true)}
                aria-label="Quick add"
                className="fab-ring absolute left-1/2 -translate-x-1/2 -top-7 w-14 h-14 rounded-full bg-mari-500 hover:bg-mari-400 text-white grid place-items-center border-4 border-moss shadow-lg shadow-mari-600/40 active:scale-90 transition-transform"
              >
                <Plus size={24} />
              </button>
            </div>
            <TabBtn t={MOBILE_TABS[2]} active={tab === "funds"} onClick={() => setTab("funds")} />
            <TabBtn t={MOBILE_TABS[3]} active={tab === "reports"} onClick={() => setTab("reports")} />
          </div>
        </div>
      </nav>

      <EntrySheet open={add} onClose={() => setAdd(false)} />

      <Sheet open={themeSheet} onClose={() => setThemeSheet(false)} title={<span className="flex items-center gap-2"><Palette size={17} className="text-pine-600" /> Theme</span>}>
        <ThemePicker value={prefs.theme} onChange={(t) => void updatePrefs({ theme: t })} />
        <p className="text-[11.5px] text-ink/45 mt-3">Saved on this device. Four light, four dark — all tuned for contrast.</p>
      </Sheet>
    </div>
  );
}

/* ---------------- desktop sidebar ---------------- */

function Sidebar({ tab, setTab, openAdd, prefs, updatePrefs }: {
  tab: Tab;
  setTab: (t: Tab) => void;
  openAdd: () => void;
  prefs: ReturnType<typeof usePrefs>[0];
  updatePrefs: ReturnType<typeof usePrefs>[1];
}) {
  const stats = useLiveQuery(async () => {
    const [accounts, entries, funds, plans] = await Promise.all([
      db.accounts.toArray(), db.entries.toArray(), db.reservedFunds.toArray(), db.plannedExpenses.toArray(),
    ]);
    const { computeDerived } = await import("./lib/compute");
    const d = computeDerived(accounts, entries, funds, plans);
    return { available: d.available };
  }, []);

  const layout = prefs.layoutEngine;
  const isMasked = usePrivacy()[0];

  // Classic layout - traditional sidebar
  if (layout === "classic") {
    return (
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r border-line bg-card/85 backdrop-blur">
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl hero-weave border border-pine-700 grid place-items-center text-mari-400 shadow-sm shadow-pine-900/30">
              <IndianRupee size={19} />
            </span>
            <div>
              <div className="font-display font-extrabold text-[17px] tracking-tight text-ink leading-none">
                Paisa<span className="text-pine-700">Book</span>
              </div>
              <div className="text-[10.5px] text-ink/45 font-medium mt-1">har paisa, hisaab mein</div>
            </div>
          </div>
          <button
            onClick={openAdd}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-pine-700 hover:bg-pine-600 text-white font-semibold text-sm py-2.5 shadow-sm shadow-pine-900/20 transition-all active:scale-[0.98]"
          >
            <Plus size={16} /> New entry
            <span className="kbd text-pine-100/80 ml-1">N</span>
          </button>
        </div>

        <nav className="px-3 space-y-0.5">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cx(
                "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-all group",
                tab === n.id ? "bg-pine-700 text-white shadow-sm shadow-pine-900/25" : "text-ink/65 hover:bg-pine-100/60 hover:text-ink"
              )}
            >
              <span className={tab === n.id ? "text-mari-300" : "text-pine-700/70 group-hover:text-pine-700"}>{n.icon}</span>
              <span className="flex-1 text-left">{n.label}</span>
              <span className={cx("kbd", tab === n.id ? "text-pine-100/70" : "text-ink/35")}>{n.kbd}</span>
            </button>
          ))}
        </nav>

        <div className="mx-4 mt-4 rounded-xl hero-weave text-pine-50 px-3.5 py-3 relative overflow-hidden">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-pine-200/80 flex items-center gap-1"><Wallet size={11} /> Available to spend</div>
          <div className="font-display font-extrabold text-[21px] num tracking-tight mt-0.5">
            {isMasked ? "•••••" : fmtCompactINR(stats?.available ?? 0)}
          </div>
          <div className="text-[9px] text-pine-200/60 mt-0.5">{isMasked ? "Hidden for privacy" : "Live balance"}</div>
        </div>

        <div className="flex-1" />

        <div className="px-4 pb-3">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-ink/40 mb-2">Appearance</div>
          <ThemePicker value={prefs.theme} onChange={(t) => void updatePrefs({ theme: t })} />
        </div>

        <div className="px-5 py-3 border-t border-line/80">
          <div className="flex items-center gap-1.5 mb-2.5">
            <PrivacyButton sidebar />
            <LockNowButton sidebar />
            <span className="flex-1" />
            <span className="kbd text-ink/50">1–5</span>
            <span className="kbd text-ink/50">N</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink/45">
            <RefreshCw size={12} />
            <span className="flex-1">Ledger lives on this device</span>
          </div>
        </div>
      </aside>
    );
  }

  // Modern layout - wider sidebar with more info
  if (layout === "modern") {
    return (
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-72 flex-col border-r border-line bg-card/95 backdrop-blur-md shadow-xl shadow-pine-900/10">
        <div className="px-6 pt-6 pb-5 border-b border-line/50">
          <div className="flex items-center gap-3">
            <span className="w-12 h-12 rounded-2xl hero-weave border border-pine-700 grid place-items-center text-mari-400 shadow-lg shadow-pine-900/20">
              <IndianRupee size={22} />
            </span>
            <div>
              <div className="font-display font-extrabold text-[19px] tracking-tight text-ink leading-none">
                Paisa<span className="text-pine-700">Book</span>
              </div>
              <div className="text-[11px] text-ink/50 font-medium mt-0.5">har paisa, hisaab mein</div>
            </div>
          </div>
          <button
            onClick={openAdd}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pine-700 to-pine-600 hover:from-pine-600 hover:to-pine-500 text-white font-bold text-[14px] py-3 shadow-lg shadow-pine-900/25 transition-all active:scale-[0.98]"
          >
            <Plus size={18} /> Add Transaction
            <span className="kbd text-pine-100/70 ml-1">N</span>
          </button>
        </div>

        <nav className="px-4 py-4 space-y-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cx(
                "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-[14px] font-semibold transition-all group",
                tab === n.id 
                  ? "bg-gradient-to-r from-pine-700 to-pine-600 text-white shadow-md shadow-pine-900/20" 
                  : "text-ink/70 hover:bg-pine-100/70 hover:text-ink"
              )}
            >
              <span className={cx("transition-transform group-hover:scale-110", tab === n.id ? "text-mari-300" : "text-pine-700/70")}>{n.icon}</span>
              <span className="flex-1 text-left">{n.label}</span>
              <span className={cx("kbd", tab === n.id ? "text-pine-100/70" : "text-ink/35")}>{n.kbd}</span>
            </button>
          ))}
        </nav>

        <div className="mx-5 mt-2 rounded-2xl bg-gradient-to-br from-pine-700 to-pine-800 text-white px-5 py-4 relative overflow-hidden shadow-lg">
          <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
          <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-pine-200/90 flex items-center gap-2">
            <Wallet size={12} /> Spendable Balance
          </div>
          <div className="font-display font-extrabold text-[26px] num tracking-tight mt-1">{fmtCompactINR(stats?.available ?? 0)}</div>
          <div className="text-[10px] text-pine-200/60 mt-1">{isMasked ? "Hidden for privacy" : "Updated live"}</div>
        </div>

        <div className="flex-1" />

        <div className="px-5 pb-4">
          <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45 mb-3">Theme</div>
          <ThemePicker value={prefs.theme} onChange={(t) => void updatePrefs({ theme: t })} />
        </div>

        <div className="px-6 py-4 border-t border-line/60 bg-pine-50/50">
          <div className="flex items-center gap-2 mb-3">
            <PrivacyButton sidebar />
            <LockNowButton sidebar />
            <span className="flex-1" />
            <span className="kbd text-ink/50">1–5</span>
            <span className="kbd text-ink/50">N</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-ink/50">
            <ShieldCheck size={12} />
            <span className="flex-1 font-medium">AES-256 encrypted on device</span>
          </div>
        </div>
      </aside>
    );
  }

  // Compact layout - minimal sidebar
  if (layout === "compact") {
    return (
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-20 flex-col border-r border-line bg-card/80 backdrop-blur items-center py-4">
        <div className="w-10 h-10 rounded-xl hero-weave border border-pine-700 grid place-items-center text-mari-400 shadow-sm shadow-pine-900/30 mb-6">
          <IndianRupee size={18} />
        </div>
        
        <nav className="flex-1 space-y-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={cx(
                "w-14 h-14 flex flex-col items-center justify-center gap-1 rounded-xl transition-all group",
                tab === n.id 
                  ? "bg-pine-700 text-white shadow-md shadow-pine-900/20" 
                  : "text-ink/60 hover:bg-pine-100/60 hover:text-ink"
              )}
              title={n.label}
            >
              <span className={tab === n.id ? "text-mari-300" : "text-pine-700/70"}>{n.icon}</span>
              <span className="text-[9px] font-semibold">{n.kbd}</span>
            </button>
          ))}
        </nav>

        <div className="space-y-3">
          <PrivacyButton sidebar />
          <LockNowButton sidebar />
        </div>
      </aside>
    );
  }

  // Spacious layout - full-width header style
  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-80 flex-col border-r border-line bg-gradient-to-b from-card to-pine-50/30 backdrop-blur">
      <div className="px-7 pt-7 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-14 h-14 rounded-2xl hero-weave border-2 border-pine-700 grid place-items-center text-mari-400 shadow-xl shadow-pine-900/25">
            <IndianRupee size={26} />
          </span>
          <div>
            <div className="font-display font-extrabold text-[22px] tracking-tight text-ink leading-none">
              Paisa<span className="text-pine-700">Book</span>
            </div>
            <div className="text-[11.5px] text-ink/50 font-medium mt-1">Complete money manager</div>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="mt-6 w-full inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-mari-500 to-mari-400 hover:from-mari-400 hover:to-mari-300 text-white font-bold text-[15px] py-3.5 shadow-xl shadow-mari-600/30 transition-all active:scale-[0.97]"
        >
          <Plus size={19} /> Quick Add Entry
          <span className="kbd text-white/80 ml-1">N</span>
        </button>
      </div>

      <nav className="px-5 py-3 space-y-1.5">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setTab(n.id)}
            className={cx(
              "w-full flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-[14.5px] font-bold transition-all group border",
              tab === n.id 
                ? "bg-gradient-to-r from-pine-700 to-pine-600 border-pine-600 text-white shadow-lg shadow-pine-900/25" 
                : "border-transparent text-ink/70 hover:border-pine-300 hover:bg-white/70 hover:text-ink"
            )}
          >
            <span className={cx("transition-transform group-hover:scale-110", tab === n.id ? "text-mari-300" : "text-pine-700/70")}>{n.icon}</span>
            <span className="flex-1 text-left">{n.label}</span>
            <span className={cx("kbd", tab === n.id ? "text-pine-100/70" : "text-ink/30")}>{n.kbd}</span>
          </button>
        ))}
      </nav>

      <div className="mx-5 mt-3 p-5 rounded-2xl bg-gradient-to-br from-pine-800 via-pine-700 to-pine-600 text-white relative overflow-hidden shadow-2xl">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
        <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-mari-400/20 rounded-full blur-xl" />
        <div className="relative">
          <div className="text-[10.5px] uppercase tracking-[0.18em] font-bold text-pine-200/90 flex items-center gap-2 mb-2">
            <Wallet size={13} /> Available Funds
          </div>
          <div className="font-display font-black text-[32px] num tracking-tight leading-none">{fmtCompactINR(stats?.available ?? 0)}</div>
          <div className="text-[11px] text-pine-200/70 mt-2 flex items-center gap-1.5">
            {isMasked ? <EyeOff size={11} /> : <Eye size={11} />}
            {isMasked ? "Amounts hidden" : "Live balance"}
          </div>
        </div>
      </div>

      <div className="flex-1" />

      <div className="px-6 pb-5">
        <div className="text-[10px] uppercase tracking-wider font-bold text-ink/50 mb-3">Appearance</div>
        <ThemePicker value={prefs.theme} onChange={(t) => void updatePrefs({ theme: t })} />
      </div>

      <div className="px-7 py-5 border-t border-line/70 bg-white/50">
        <div className="flex items-center gap-2.5 mb-3">
          <PrivacyButton sidebar />
          <LockNowButton sidebar />
          <span className="flex-1" />
          <span className="kbd text-ink/50">1–5</span>
          <span className="kbd text-ink/50">N</span>
        </div>
        <div className="flex items-center gap-2.5 text-[11.5px] text-ink/55">
          <div className="w-2 h-2 rounded-full bg-pine-500 animate-pulse" />
          <span className="flex-1 font-medium">All data encrypted locally</span>
        </div>
      </div>
    </aside>
  );
}

function HeaderIcon({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "relative w-9 h-9 grid place-items-center rounded-xl border transition-all active:scale-95",
        active ? "bg-pine-700 border-pine-700 text-white shadow-sm" : "bg-card border-line text-pine-700 hover:border-pine-300 hover:bg-pine-50"
      )}
    >
      {icon}
    </button>
  );
}

/* ---------------- mandatory first-run vault setup ---------------- */

function VaultSetupGate() {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= 6 && p1 === p2;

  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const { enableVault } = await import("./lib/vault");
      await enableVault(p1);
      location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh hero-weave hero-sheen relative overflow-hidden flex flex-col items-center justify-center px-6 py-10">
      <div className="rupee-watermark">₹</div>
      <div className="relative w-full max-w-[380px] anim-fade-up">
        <div className="flex flex-col items-center mb-6 text-center">
          <span className="w-16 h-16 rounded-2xl bg-mari-500 text-white grid place-items-center shadow-xl shadow-black/30 mb-4">
            <ShieldCheck size={30} />
          </span>
          <h1 className="font-display font-extrabold text-pine-50 text-[26px] tracking-tight">Seal your ledger</h1>
          <p className="text-[13px] text-pine-200/85 mt-2 max-w-[320px] leading-relaxed">
            PaisaBook encrypts its local database on every device — it's mandatory. Choose the vault passphrase you'll use to open the app, lock it instantly, and un-hide numbers.
          </p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            autoFocus
            value={p1}
            onChange={(e) => setP1(e.target.value)}
            placeholder="Vault passphrase (min 6 characters)"
            className="w-full rounded-2xl bg-white/10 border border-white/20 text-pine-50 placeholder:text-pine-200/50 px-4 py-3.5 text-[15px] outline-none focus:border-mari-400 focus:bg-white/15 transition-colors"
          />
          <input
            type="password"
            value={p2}
            onChange={(e) => setP2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void go()}
            placeholder="Repeat passphrase"
            className={cx(
              "w-full rounded-2xl bg-white/10 border text-pine-50 placeholder:text-pine-200/50 px-4 py-3.5 text-[15px] outline-none transition-colors",
              p2 && p1 !== p2 ? "border-flare-500/70" : "border-white/20 focus:border-mari-400 focus:bg-white/15"
            )}
          />
          {p2 && p1 !== p2 && <p className="text-[12px] text-mari-300 font-semibold text-center -mt-1">Passphrases don't match yet.</p>}
          <button
            onClick={() => void go()}
            disabled={!ok || busy}
            className={cx(
              "w-full rounded-2xl py-3.5 font-display font-bold text-[15px] flex items-center justify-center gap-2 transition-all",
              ok ? "bg-mari-500 hover:bg-mari-400 text-white shadow-lg shadow-black/30 active:scale-[0.98]" : "bg-white/5 text-pine-200/40 border border-white/10"
            )}
          >
            <Lock size={17} /> {busy ? "Sealing ledger…" : "Encrypt & enter"}
          </button>
        </div>
        <div className="mt-6 space-y-1.5 text-[11.5px] text-pine-200/75">
          <p className="flex items-center gap-2"><KeyRound size={12} className="text-mari-300 shrink-0" /> AES-256-GCM · PBKDF2-SHA256 @ 600k rounds — derived on this device only.</p>
          <p className="flex items-center gap-2"><EyeOff size={12} className="text-mari-300 shrink-0" /> Un-hiding amounts and locking the app use this passphrase.</p>
          <p className="flex items-center gap-2"><AlertTriangle size={12} className="text-mari-300 shrink-0" /> No recovery. Forget it and the sealed ledger is unreadable — write it down somewhere safe.</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- privacy eye + instant lock ---------------- */

function PrivacyButton({ sidebar }: { sidebar?: boolean }) {
  const toast = useToast();
  const [masked, setMasked] = usePrivacy();
  const [ask, setAsk] = useState(false);
  const [pass, setPass] = useState("");
  const [errKey, setErrKey] = useState(0);

  const toggle = () => {
    if (!masked) {
      setMasked(true);
      toast.push("Amounts hidden");
    } else {
      setAsk(true);
    }
  };

  const unlock = async () => {
    const ok = await import("./lib/vault").then((v) => v.verifyVaultPassphrase(pass)).catch(() => false);
    if (ok) {
      setMasked(false);
      setAsk(false);
      setPass("");
      toast.push("Amounts visible");
    } else {
      setErrKey((e) => e + 1);
      setPass("");
      toast.push("Wrong vault passphrase", "err");
    }
  };

  return (
    <>
      <button
        onClick={toggle}
        aria-label={masked ? "Show amounts" : "Hide amounts"}
        title={masked ? "Show amounts (vault passphrase)" : "Privacy mode — hide all amounts"}
        className={cx(
          "grid place-items-center rounded-xl border transition-all active:scale-95",
          sidebar ? "w-8 h-8 text-ink/55 border-line bg-card hover:border-pine-300 hover:text-ink" : "w-9 h-9 bg-card border-line text-pine-700 hover:border-pine-300 hover:bg-pine-50",
          masked && "bg-pine-700 border-pine-700 text-white hover:bg-pine-600 hover:text-white"
        )}
      >
        {masked ? <EyeOff size={sidebar ? 14 : 16} /> : <Eye size={sidebar ? 14 : 16} />}
      </button>
      <Sheet
        open={ask}
        onClose={() => { setAsk(false); setPass(""); }}
        title={<span className="flex items-center gap-2"><Eye size={17} className="text-pine-600" /> Un-hide amounts</span>}
        footer={
          <Btn className="w-full" size="lg" icon={<Eye size={16} />} disabled={!pass} onClick={() => void unlock()}>Verify & show</Btn>
        }
      >
        <p className="text-[13px] text-ink/65 mb-3 leading-relaxed">Amounts stay masked until you prove it's you. Enter your vault passphrase — the same one that opens the app.</p>
        <div key={errKey} className={cx(errKey > 0 && "anim-shake")}>
          <input
            type="password"
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pass && void unlock()}
            placeholder="Vault passphrase"
            className="w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink/30 outline-none focus:border-pine-400 focus:ring-2 focus:ring-pine-400/20"
          />
        </div>
      </Sheet>
    </>
  );
}

function LockNowButton({ sidebar }: { sidebar?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = async () => {
    setBusy(true);
    try {
      const { instantLock } = await import("./lib/vault");
      await instantLock();
      location.reload();
    } catch {
      toast.push("Could not lock", "err");
      setBusy(false);
    }
  };
  return (
    <button
      onClick={() => void lock()}
      disabled={busy}
      aria-label="Lock now"
      title="Instant lock — re-seal the ledger and lock the app"
      className={cx(
        "grid place-items-center rounded-xl border transition-all active:scale-95 disabled:opacity-50",
        sidebar ? "w-8 h-8 text-ink/55 border-line bg-card hover:border-flare-500/40 hover:text-flare-600" : "w-9 h-9 bg-card border-line text-pine-700 hover:border-flare-500/40 hover:text-flare-600"
      )}
    >
      <Lock size={sidebar ? 14 : 16} />
    </button>
  );
}

/* ---------------- vault lock screen (data sealed at rest) ---------------- */

function VaultLock() {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(0);

  const unlock = async () => {
    if (!pass || busy) return;
    setBusy(true);
    try {
      const { unlockVault } = await import("./lib/vault");
      await unlockVault(pass);
      location.reload();
      return;
    } catch {
      setErr((e) => e + 1);
      setPass("");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-dvh hero-weave hero-sheen relative overflow-hidden flex flex-col items-center justify-center px-6">
      <div className="rupee-watermark">₹</div>
      <div key={err} className={cx("relative w-full max-w-[340px] anim-fade-up", err > 0 && "anim-shake")}>
        <div className="flex flex-col items-center mb-6">
          <span className="w-14 h-14 rounded-2xl bg-mari-500 text-white grid place-items-center shadow-xl shadow-black/30 mb-3">
            <Lock size={26} />
          </span>
          <h1 className="font-display font-extrabold text-pine-50 text-[22px] tracking-tight">Vault is sealed</h1>
          <p className="text-[12.5px] text-pine-200/80 mt-1 text-center max-w-[280px]">
            Your ledger is stored as ciphertext on this device. Enter the vault passphrase to decrypt it.
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void unlock()}
          placeholder="Vault passphrase"
          className="w-full rounded-2xl bg-white/10 border border-white/20 text-pine-50 placeholder:text-pine-200/50 px-4 py-3.5 text-[15px] outline-none focus:border-mari-400 focus:bg-white/15 transition-colors"
        />
        {err > 0 && <p className="text-center text-[12px] text-mari-300 font-semibold mt-2">Wrong passphrase — the vault stays sealed.</p>}
        <button
          onClick={() => void unlock()}
          disabled={!pass || busy}
          className={cx(
            "mt-4 w-full rounded-2xl py-3.5 font-display font-bold text-[15px] flex items-center justify-center gap-2 transition-all",
            pass ? "bg-mari-500 hover:bg-mari-400 text-white shadow-lg shadow-black/30 active:scale-[0.98]" : "bg-white/5 text-pine-200/40 border border-white/10"
          )}
        >
          <UnlockKeyhole size={17} /> {busy ? "Decrypting…" : "Unlock ledger"}
        </button>
        <p className="text-center text-[11px] text-pine-200/60 mt-4 flex items-center justify-center gap-1.5">
          <Lock size={11} /> AES-256-GCM · PBKDF2 600k rounds · keys never leave this device
        </p>
      </div>
    </div>
  );
}

function TabBtn({ t, active, onClick }: { t: { id: Tab; label: string; icon: ReactNode }; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx("relative flex flex-col items-center gap-0.5 py-1 rounded-xl transition-colors", active ? "text-mari-400" : "text-pine-200/55 hover:text-pine-100")}>
      {t.icon}
      <span className="text-[10px] font-semibold tracking-wide">{t.label}</span>
      <span className={cx("absolute -top-0.5 h-1 w-6 rounded-full bg-mari-400 transition-all", active ? "opacity-100 scale-100" : "opacity-0 scale-50")} />
    </button>
  );
}
