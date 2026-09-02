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

