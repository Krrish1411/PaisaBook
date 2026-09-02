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

/* ---------------- app ---------------- */

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [showEntry, setShowEntry] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const toast = useToast();
  const [, force] = useState(0);
  const prefs = usePrefs();

  useEffect(() => {
    initAutoLock(prefs.autoLockMinutes, () => setTab("settings"));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowEntry(true); }
      if (e.altKey && !isNaN(Number(e.key))) { const t = NAV[Number(e.key) - 1]; if (t) setTab(t.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.autoLockMinutes]);

  // Load categories if empty
  useLiveQuery(async () => {
    const cats = await db.categories.toArray();
    if (cats.length === 0) await seedCategories();
  }, []);

  return (
    <ToastProvider>
      <div className={cx("min-h-screen bg-moss text-ink antialiased selection:bg-pine-500/20", `scale-${prefs.fontScale}`)}>
        <header className="sticky top-0 z-30 border-b border-line bg-moss/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 lg:px-6">
            <div className="flex items-center gap-3">
              <button className="lg:hidden p-2 -ml-2 hover:bg-pine-100 dark:hover:bg-pine-900/30 rounded-xl" onClick={() => setSheetOpen(true)}>
                <List size={20} />
              </button>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pine-500 to-emerald-600 grid place-items-center text-white shadow-lg shadow-pine-500/20">
                  <IndianRupee size={16} strokeWidth={2.5} />
                </div>
                <div>
                  <div className="font-display font-black text-[18px] tracking-tight leading-none">{TITLES[tab]}</div>
                  <div className="text-[10.5px] text-ink/40 font-medium">Personal Finance Ledger</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-pine-100 dark:bg-pine-900/30 text-pine-700 dark:text-pine-300 text-[11.5px] font-bold hover:bg-pine-200 dark:hover:bg-pine-900/50 transition-colors" onClick={() => setShowEntry(true)}>
                <Plus size={14} /> Add Entry
                <span className="ml-1 px-1.5 py-0.5 rounded-md bg-pine-200 dark:bg-pine-800 text-[9px]">Ctrl+K</span>
              </button>
              <button className="lg:hidden p-2 hover:bg-pine-100 dark:hover:bg-pine-900/30 rounded-xl" onClick={() => setShowEntry(true)}>
                <Plus size={20} />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6 lg:py-8">
          <Boundary label={TITLES[tab]} onRetry={() => force(f => f + 1)}>
            <Suspense fallback={<div className="grid place-items-center py-20"><div className="w-8 h-8 border-2 border-pine-500 border-t-transparent rounded-full animate-spin" /></div>}>
              {tab === "home" && <Dashboard go={(t) => setTab(t as Tab)} />}
              {tab === "txns" && <Entries go={(t) => setTab(t as Tab)} />}
              {tab === "funds" && <Funds go={(t) => setTab(t as Tab)} />}
              {tab === "reports" && <Reports go={(t) => setTab(t as Tab)} />}
              {tab === "settings" && <Settings go={(t) => setTab(t as Tab)} />}
            </Suspense>
          </Boundary>
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-moss/90 backdrop-blur pb-safe">
          <div className="grid grid-cols-4">
            {MOBILE_TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={cx("flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors", tab === t.id ? "text-pine-600" : "text-ink/50")}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Mobile sidebar sheet */}
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Navigation">
          <div className="space-y-1 py-2">
            {NAV.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setSheetOpen(false); }}
                className={cx("w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors", tab === t.id ? "bg-pine-100 dark:bg-pine-900/40 text-pine-700 dark:text-pine-300 font-bold" : "hover:bg-pine-50 dark:hover:bg-pine-900/20")}
              >
                {t.icon}
                <span className="text-[13px]">{t.label}</span>
                <span className="ml-auto text-[10px] opacity-40">{t.kbd}</span>
              </button>
            ))}
          </div>
        </Sheet>

        <EntrySheet open={showEntry} onClose={() => setShowEntry(false)} />
      </div>
    </ToastProvider>
  );
}
