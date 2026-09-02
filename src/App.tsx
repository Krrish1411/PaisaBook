import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, BarChart3, Eye, EyeOff, Home, IndianRupee, KeyRound, Lock, Palette, List, Plus, RefreshCw, Settings as SettingsIcon, ShieldCheck, Smartphone, UnlockKeyhole, Wallet, PieChart,
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
const Insights = lazy(() => import("./screens/Insights"));

type Tab = "home" | "txns" | "funds" | "reports" | "insights" | "settings";

const NAV: Array<{ id: Tab; label: string; icon: ReactNode; kbd: string }> = [
  { id: "home", label: "Home", icon: <Home size={17} />, kbd: "1" },
  { id: "txns", label: "Entries", icon: <List size={17} />, kbd: "2" },
  { id: "funds", label: "Funds & Plans", icon: <Wallet size={17} />, kbd: "3" },
  { id: "reports", label: "Reports", icon: <BarChart3 size={17} />, kbd: "4" },
  { id: "insights", label: "Insights", icon: <PieChart size={17} />, kbd: "5" },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={17} />, kbd: "6" },
];

const MOBILE_TABS = NAV.slice(0, 5);

const TITLES: Record<Tab, string> = { home: "PaisaBook", txns: "Entries", funds: "Funds", reports: "Reports", insights: "Insights", settings: "Settings" };

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prefs, updatePrefs] = usePrefs();
  const [privacy, setPrivacy] = usePrivacy();
  const toast = useToast();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key >= "1" && e.key <= "6") {
        const idx = parseInt(e.key) - 1;
        if (NAV[idx]) setTab(NAV[idx].id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    void (async () => {
      const cats = await db.categories.count();
      if (cats === 0) await seedCategories();
    })();
  }, []);

  const renderContent = () => {
    switch (tab) {
      case "home":
        return <Dashboard go={(t) => setTab(t as Tab)} openAdd={() => setSheetOpen(true)} />;
      case "txns":
        return <Entries openAdd={() => setSheetOpen(true)} />;
      case "funds":
        return <Funds go={(t) => setTab(t as Tab)} />;
      case "reports":
        return <Reports go={(t) => setTab(t as Tab)} />;
      case "insights":
        return <Insights />;
      case "settings":
        return <Settings />;
      default:
        return null;
    }
  };

  return (
    <ToastProvider>
      <div className={cx("min-h-screen bg-moss text-ink antialiased", prefs.theme === "dark" && "dark")}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-line bg-moss/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pine-600 text-white shadow-lg shadow-pine-900/20">
                <IndianRupee size={18} strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-base font-bold tracking-tight text-ink">{TITLES[tab]}</h1>
                <p className="text-[11px] text-ink/50 -mt-0.5">Your money · Your rules</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Btn variant="ghost" size="sm" onClick={() => setPrivacy((p) => !p)} aria-label="Toggle privacy">
                {privacy ? <EyeOff size={16} className="text-ink/60" /> : <Eye size={16} className="text-ink/60" />}
              </Btn>
              <Btn variant="ghost" size="sm" onClick={() => updatePrefs((p) => ({ ...p, theme: p.theme === "light" ? "dark" : "light" }))} aria-label="Toggle theme">
                <Palette size={16} className="text-ink/60" />
              </Btn>
              <Btn className="hidden sm:inline-flex" size="sm" icon={<Plus size={16} />} onClick={() => setSheetOpen(true)}>Add</Btn>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 pb-24">
          <Suspense fallback={<div className="grid place-items-center py-20 text-ink/40"><RefreshCw className="animate-spin" size={24} /></Suspense>}>
            {renderContent()}
          </Suspense>
        </main>

        {/* Mobile nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-line bg-moss/90 backdrop-blur sm:hidden">
          <div className="grid grid-cols-5">
            {MOBILE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cx(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10.5px] font-medium transition-colors",
                  tab === t.id ? "text-pine-600" : "text-ink/50 hover:text-ink/70"
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Desktop nav */}
        <aside className="hidden sm:block fixed right-6 top-1/2 -translate-y-1/2 z-10">
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-1.5 shadow-xl shadow-black/5">
            {NAV.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                title={`${t.label} (${t.kbd})`}
                className={cx(
                  "grid place-items-center rounded-xl p-2 transition-all",
                  tab === t.id ? "bg-pine-600 text-white shadow-md shadow-pine-900/20" : "text-ink/50 hover:text-ink hover:bg-moss"
                )}
              >
                {t.icon}
              </button>
            ))}
          </div>
        </aside>

        {/* Entry sheet */}
        <EntrySheet open={sheetOpen} onClose={() => setSheetOpen(false)} />

        {/* Command palette */}
        <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      </div>
    </ToastProvider>
  );
}
