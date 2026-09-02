/**
 * Comprehensive analysis: any period (7D / 30D / 3M / 1Y / custom range),
 * day/week/month granularity, previous-period deltas, budget vs actual,
 * goal pacing, planned-expense execution, and every ratio that helps.
 * Everything recomputes live from the local ledger.
 */
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CalendarRange, Download, Flag, Gauge, PiggyBank, Target, TrendingDown, TrendingUp } from "lucide-react";
import { db, getRates } from "../db";
import type { Entry } from "../types";
import { accountBalance, isRealExpense, isRealIncome } from "../lib/compute";
import { cx, daysUntil, downloadText, downloadAsXLSX, downloadAsPDF, fmtCompactINR, fmtDate, fmtINR, maskTick, monthKey, monthLabel, pct, toISO, todayISO, usePrivacy } from "../lib/core";
import { Badge, Btn, Card, EmptyState, Reveal, SectionTitle, Seg, TInput, useTween } from "../components/ui";

type Period = "7d" | "30d" | "3m" | "1y" | "custom";
type Gran = "auto" | "day" | "week" | "month";

const PALETTE = ["#12855a", "#e8940a", "#2273a8", "#d6455d", "#6cc39d", "#0b3d2e", "#f0a62b", "#962a3d", "#2fa377", "#97600a", "#106a48", "#c47a05"];
const ESSENTIAL = new Set(["food", "food-delivery", "dining", "groceries", "home", "rent", "utilities", "bills", "transport", "health", "insurance", "education", "fees"]);

const tooltipStyle = {
  background: "var(--color-pine-900)",
  border: "1px solid var(--color-pine-700)",
  borderRadius: 10,
  fontSize: 12,
  color: "var(--color-pine-50)",
  fontFamily: "IBM Plex Sans, sans-serif",
} as const;

const shiftDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

interface Bucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

function makeBuckets(start: Date, end: Date, gran: Gran): Bucket[] {
  const span = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const g: Exclude<Gran, "auto"> = gran === "auto" ? (span <= 45 ? "day" : span <= 200 ? "week" : "month") : gran;
  const out: Bucket[] = [];
  if (g === "day") {
    for (let d = new Date(start); d <= end; d = shiftDays(d, 1)) {
      out.push({ key: toISO(d), label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), start: new Date(d), end: new Date(d) });
    }
  } else if (g === "week") {
    let d = new Date(start);
    const dow = (d.getDay() + 6) % 7; // Monday-first
    d = shiftDays(d, -dow);
    while (d <= end) {
      const we = shiftDays(d, 6);
      out.push({ key: toISO(d), label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), start: new Date(d), end: we < end || we <= shiftDays(end, 6) ? we : end });
      d = shiftDays(d, 7);
    }
  } else {
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= end) {
      const me = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      out.push({
        key: monthKey(d),
        label: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ${`${d.getFullYear()}`.slice(2)}`,
        start: new Date(d),
        end: me,
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return out;
}

interface Metrics {
  income: number;
  expense: number;
  net: number;
  txCount: number;
  avgTx: number;
  largest: number;
  largestNote: string;
  transferVol: number;
  reservedIn: number;
  reservedOut: number;
  essentials: number;
  discretionary: number;
  invest: number;
  byCat: Map<string, number>;
  byNote: Map<string, number>;
  byDay: Map<string, number>;
  monthlyIncome: number[];
  monthlyExpense: number[];
}

function metricsOf(entries: Entry[], startISO: string, endISO: string, rates: Record<string, number>): Metrics {
  const m: Metrics = {
    income: 0, expense: 0, net: 0, txCount: 0, avgTx: 0, largest: 0, largestNote: "—",
    transferVol: 0, reservedIn: 0, reservedOut: 0, essentials: 0, discretionary: 0, invest: 0,
    byCat: new Map(), byNote: new Map(), byDay: new Map(), monthlyIncome: [], monthlyExpense: [],
  };
  const inr = (t: Entry) => t.amount * (rates[t.currency ?? "INR"] ?? 1);
  const monthInc = new Map<string, number>();
  const monthExp = new Map<string, number>();
  for (const t of entries) {
    if (t.date < startISO || t.date > endISO) continue;
    const v = inr(t);
    if (t.type === "transfer") { m.transferVol += v; continue; }
    if (t.isReserved) {
      if (t.type === "income") m.reservedIn += v;
      else m.reservedOut += v;
      continue;
    }
    m.txCount++;
    if (t.type === "income") {
      m.income += v;
      monthInc.set(t.date.slice(0, 7), (monthInc.get(t.date.slice(0, 7)) ?? 0) + v);
    } else {
      m.expense += v;
      monthExp.set(t.date.slice(0, 7), (monthExp.get(t.date.slice(0, 7)) ?? 0) + v);
      if (v > m.largest) { m.largest = v; m.largestNote = t.note || "Entry"; }
      m.byCat.set(t.categoryId ?? "uncat", (m.byCat.get(t.categoryId ?? "uncat") ?? 0) + v);
      const noteKey = (t.note || "Uncategorised").trim();
      if (noteKey) m.byNote.set(noteKey, (m.byNote.get(noteKey) ?? 0) + v);
      m.byDay.set(t.date, (m.byDay.get(t.date) ?? 0) + v);
      if (t.categoryId === "invest") m.invest += v;
      if (ESSENTIAL.has(t.categoryId ?? "")) m.essentials += v;
      else m.discretionary += v;
    }
  }
  m.net = m.income - m.expense;
  m.avgTx = m.txCount > 0 ? m.expense / Math.max(1, [...m.byDay.keys()].length ? m.txCount : m.txCount) : 0;
  m.monthlyIncome = [...monthInc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  m.monthlyExpense = [...monthExp.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  return m;
}

const stddev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
};

/* ---------------- tiny presentational helpers ---------------- */

function Delta({ cur, prev, invert, suffix = "%" }: { cur: number; prev: number; invert?: boolean; suffix?: string }) {
  if (!prev) return <span className="text-[10px] font-bold text-ink/35">new</span>;
  const ch = (cur - prev) / Math.abs(prev);
  const good = invert ? ch <= 0 : ch >= 0;
  const Icon = ch >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cx("inline-flex items-center gap-0.5 text-[10.5px] font-bold num", good ? "text-pine-600" : "text-flare-600")}>
      <Icon size={11} /> {Math.abs(ch * 100).toFixed(0)}{suffix}
    </span>
  );
}

function RatioTile({ label, value, ok, hint, delay }: { label: string; value: string; ok: boolean | null; hint: string; delay: number }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3.5 hover:border-pine-300 hover:-translate-y-0.5 transition-all anim-tick" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between gap-1">
        <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45 leading-tight">{label}</div>
        {ok !== null && <span className={cx("w-2 h-2 rounded-full shrink-0", ok ? "bg-pine-500" : "bg-mari-500")} title={ok ? "on track" : "needs attention"} />}
      </div>
      <div className={cx("font-display font-extrabold text-[20px] num mt-1", ok === null ? "text-ink" : ok ? "text-pine-700" : "text-mari-600")}>{value}</div>
      <div className="text-[10.5px] text-ink/40 mt-0.5 leading-snug">{hint}</div>
    </div>
  );
}

/* ================= main ================= */

export default function Reports({ go }: { go: (t: string) => void }) {
  usePrivacy(); // subscribe → every number re-masks instantly when privacy flips
  const data = useLiveQuery(async () => {
    const [entries, accounts, categories, budgets, goals, plans, funds, rates] = await Promise.all([
      db.entries.toArray(), db.accounts.toArray(), db.categories.toArray(),
      db.budgets.toArray(), db.goals.toArray(), db.plannedExpenses.toArray(), db.funds.toArray(), getRates(),
    ]);
    return { entries, accounts, categories, budgets, goals, plans, funds, rates };
  }, []);

  const [period, setPeriod] = useState<Period>("30d");
  const [gran, setGran] = useState<Gran>("auto");
  const [customStart, setCustomStart] = useState(toISO(shiftDays(new Date(), -29)));
  const [customEnd, setCustomEnd] = useState(todayISO());

  const today = new Date();
  const win = useMemo((): { start: Date; end: Date } => {
    if (period === "custom") {
      const s = new Date(customStart + "T00:00:00");
      const e = new Date(customEnd + "T00:00:00");
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || s > e) return { start: shiftDays(today, -29), end: today };
      return { start: s, end: e };
    }
    const days = period === "7d" ? 6 : period === "30d" ? 29 : period === "3m" ? 89 : 364;
    return { start: shiftDays(today, -days), end: today };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customStart, customEnd]);

  const prevWin = useMemo(() => {
    const len = Math.round((win.end.getTime() - win.start.getTime()) / 86400000) + 1;
    return { start: shiftDays(win.start, -len), end: shiftDays(win.start, -1) };
  }, [win]);

  const buckets = useMemo(() => makeBuckets(win.start, win.end, gran), [win, gran]);
  const startISO = toISO(win.start);
  const endISO = toISO(win.end);
  const prevStartISO = toISO(prevWin.start);
  const prevEndISO = toISO(prevWin.end);

  const cur = useMemo(() => (data ? metricsOf(data.entries, startISO, endISO, data.rates) : null), [data, startISO, endISO]);
  const prev = useMemo(() => (data ? metricsOf(data.entries, prevStartISO, prevEndISO, data.rates) : null), [data, prevStartISO, prevEndISO]);

  const tIncome = useTween(cur?.income ?? 0);
  const tExpense = useTween(cur?.expense ?? 0);
  const tNet = useTween(cur?.net ?? 0);

  /* ----- chart series ----- */
  const flowSeries = useMemo(() => {
    if (!data) return [];
    return buckets.map((b) => {
      const s = toISO(b.start);
      const e = toISO(b.end);
      let income = 0, expense = 0;
      for (const t of data.entries) {
        if (t.date < s || t.date > e) continue;
        if (isRealIncome(t)) income += t.amount;
        else if (isRealExpense(t)) expense += t.amount;
      }
      return { label: b.label, Income: Math.round(income), Expense: Math.round(expense) };
    });
  }, [data, buckets]);

  const nwSeries = useMemo(() => {
    if (!data) return [];
    const all = data.accounts; // include archived accounts in net worth
    const activeFunds = data.funds.filter((f) => f.status === "active");
    const reservedHolding = activeFunds.filter((f) => f.direction === "holding_for_them").reduce((s, f) => s + f.amount, 0);
    const reservedBorrowed = activeFunds.filter((f) => f.direction === "borrowed_from_them").reduce((s, f) => s + f.amount, 0);
    const givenOutTotal = activeFunds.filter((f) => f.direction === "given_out").reduce((s, f) => s + f.amount, 0);
    
    return buckets.map((b) => {
      const e = toISO(b.end);
      let raw = 0;
      for (const a of all) {
        const bal = accountBalance(a, data.entries.filter((t) => t.date <= e));
        raw += bal * (data.rates[a.currency ?? "INR"] ?? 1);
      }
      // net worth = assets − liabilities − others' money + your money with others
      const nw = raw - reservedHolding - reservedBorrowed + givenOutTotal;
      return { label: b.label, netWorth: Math.round(nw) };
    });
  }, [data, buckets]);

  const catRows = useMemo(() => {
    if (!cur || !prev || !data) return [];
    const rows = [...cur.byCat.entries()].map(([cid, amount]) => {
      const c = data.categories.find((x) => x.id === cid);
      const prevAmt = prev.byCat.get(cid) ?? 0;
      return {
        id: cid,
        name: c?.name ?? "Uncategorised",
        amount,
        prev: prevAmt,
        share: cur.expense > 0 ? amount / cur.expense : 0,
        delta: prevAmt > 0 ? (amount - prevAmt) / prevAmt : null,
      };
    });
    return rows.sort((a, b) => b.amount - a.amount);
  }, [cur, prev, data]);

  /* ----- budget vs actual (months overlapping the window) ----- */
  const budgetRows = useMemo(() => {
    if (!data || !cur) return { rows: [] as Array<{ id: string; name: string; limit: number | null; actual: number; ratio: number; over: boolean; rollover: boolean }>, adherence: null as number | null };
    const months = new Set<string>();
    for (const b of buckets) {
      let d = new Date(Math.max(b.start.getTime(), win.start.getTime()));
      const stop = new Date(Math.min(b.end.getTime(), win.end.getTime()));
      while (d <= stop) {
        months.add(monthKey(d));
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      }
    }
    const limits = new Map<string, { limit: number; rollover: boolean }>();
    for (const b of data.budgets) {
      if (!months.has(b.monthYear)) continue;
      const ex = limits.get(b.categoryId);
      limits.set(b.categoryId, { limit: (ex?.limit ?? 0) + b.limitAmount, rollover: b.rollover || (ex?.rollover ?? false) });
    }
    const ids = new Set([...limits.keys(), ...[...cur.byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id)]);
    const rows = [...ids].map((id) => {
      const c = data.categories.find((x) => x.id === id);
      const limit = limits.get(id)?.limit ?? null;
      const actual = cur.byCat.get(id) ?? 0;
      return {
        id,
        name: c?.name ?? "Uncategorised",
        limit,
        actual,
        ratio: limit ? actual / limit : 0,
        over: limit ? actual > limit : false,
        rollover: limits.get(id)?.rollover ?? false,
      };
    }).sort((a, b) => (b.limit === null ? 0 : b.ratio) - (a.limit === null ? 0 : a.ratio));
    const withBudget = rows.filter((r) => r.limit !== null);
    const adherence = withBudget.length > 0 ? withBudget.filter((r) => !r.over).length / withBudget.length : null;
    return { rows, adherence };
  }, [data, cur, buckets, win]);

  /* ----- plans ----- */
  const planStats = useMemo(() => {
    if (!data || !cur) return null;
    const dueInWindow = data.plans.filter((p) => p.dueDate >= startISO && p.dueDate <= endISO);
    const plannedSum = dueInWindow.reduce((s, p) => s + p.amount, 0);
    let paidSum = 0;
    for (const t of data.entries) {
      if (t.date >= startISO && t.date <= endISO && t.tags?.includes("planned") && !t.isReserved) paidSum += t.amount;
    }
    const committed = data.plans.filter((p) => p.status === "pending" && daysUntil(p.dueDate) <= 30);
    const committedSum = committed.reduce((s, p) => s + p.amount, 0);
    return { dueInWindow, plannedSum, paidSum, execution: plannedSum > 0 ? paidSum / plannedSum : null, committed, committedSum };
  }, [data, cur, startISO, endISO]);

  /* ----- ratios ----- */
  const ratios = useMemo(() => {
    if (!data || !cur) return [];
    const active = data.accounts.filter((a) => !a.archived);
    const liquid = active.filter((a) => a.type !== "credit").reduce((s, a) => s + accountBalance(a, data.entries), 0);
    const creditOut = Math.max(0, -active.filter((a) => a.type === "credit").reduce((s, a) => s + accountBalance(a, data.entries), 0));
    const borrowed = 0; // reserved-borrowed tracked separately in Funds
    const days = Math.max(1, Math.round((win.end.getTime() - win.start.getTime()) / 86400000) + 1);
    const burn = cur.expense / days;
    const avgMonthlyExp = cur.monthlyExpense.length > 0 ? cur.monthlyExpense.reduce((s, v) => s + v, 0) / cur.monthlyExpense.length : 0;
    const avgMonthlyInc = cur.monthlyIncome.length > 0 ? cur.monthlyIncome.reduce((s, v) => s + v, 0) / cur.monthlyIncome.length : 0;
    const cvIncome = avgMonthlyInc > 0 ? stddev(cur.monthlyIncome) / avgMonthlyInc : 0;
    const totalBudgeted = budgetRows.rows.filter((r) => r.limit !== null).reduce((s, r) => s + (r.limit ?? 0), 0);

    return [
      { l: "Savings rate", v: cur.income > 0 ? pct(cur.net / cur.income, 0) : "—", ok: cur.income > 0 ? cur.net / cur.income >= 0.2 : null, h: "net ÷ income · aim ≥ 20%" },
      { l: "Expense ratio", v: cur.income > 0 ? pct(cur.expense / cur.income, 0) : "—", ok: cur.income > 0 ? cur.expense / cur.income <= 0.7 : null, h: "spend ÷ income · keep ≤ 70%" },
      { l: "Burn / day", v: fmtCompactINR(burn), ok: null, h: `avg daily spend over ${days}d` },
      { l: "Runway", v: burn > 0 ? `${Math.round(liquid / burn)}d` : "∞", ok: burn > 0 ? liquid / burn >= 90 : true, h: "days liquid cash lasts" },
      { l: "Liquidity", v: avgMonthlyExp > 0 ? `${(liquid / avgMonthlyExp).toFixed(1)}×` : "∞", ok: avgMonthlyExp > 0 ? liquid / avgMonthlyExp >= 3 : true, h: "months of expenses covered" },
      { l: "Emergency cover", v: avgMonthlyExp > 0 ? `${(liquid / (3 * avgMonthlyExp)).toFixed(1)}×` : "∞", ok: avgMonthlyExp > 0 ? liquid / (3 * avgMonthlyExp) >= 1 : true, h: "vs 3-month safety target" },
      { l: "Debt ÷ income", v: avgMonthlyInc > 0 ? pct((creditOut + borrowed) / avgMonthlyInc, 0) : "—", ok: avgMonthlyInc > 0 ? (creditOut + borrowed) / avgMonthlyInc <= 0.35 : null, h: "credit outstanding vs income" },
      { l: "Investing ratio", v: cur.income > 0 ? pct(cur.invest / cur.income, 0) : "—", ok: cur.income > 0 ? cur.invest / cur.income >= 0.1 : null, h: "SIPs & investments ÷ income" },
      { l: "Essentials share", v: cur.expense > 0 ? pct(cur.essentials / cur.expense, 0) : "—", ok: null, h: "needs: food, home, transport, health…" },
      { l: "Discretionary", v: cur.expense > 0 ? pct(cur.discretionary / cur.expense, 0) : "—", ok: cur.expense > 0 ? cur.discretionary / cur.expense <= 0.45 : null, h: "wants · keep ≤ 45%" },
      { l: "Budget adherence", v: budgetRows.adherence !== null ? pct(budgetRows.adherence, 0) : "—", ok: budgetRows.adherence !== null ? budgetRows.adherence >= 0.8 : null, h: "envelopes stayed within limit" },
      { l: "Plan execution", v: planStats?.execution != null ? pct(planStats.execution, 0) : "—", ok: planStats?.execution != null ? planStats.execution >= 0.7 : null, h: "planned bills actually paid" },
      { l: "Reserved out", v: cur.income > 0 ? pct(cur.reservedOut / cur.income, 0) : "—", ok: null, h: "money moved to reserves/holds" },
      { l: "Income stability", v: cur.monthlyIncome.length > 1 ? cvIncome.toFixed(2) : "—", ok: cur.monthlyIncome.length > 1 ? cvIncome <= 0.3 : null, h: "lower = steadier (CV)" },
      { l: "Biggest expense", v: cur.largest > 0 ? pct(cur.largest / Math.max(1, cur.expense), 0) : "—", ok: cur.expense > 0 ? cur.largest / cur.expense <= 0.25 : null, h: `“${cur.largestNote.slice(0, 22)}”` },
      { l: "Budget load", v: totalBudgeted > 0 && cur.income > 0 ? pct(totalBudgeted / cur.income, 0) : "—", ok: totalBudgeted > 0 && cur.income > 0 ? totalBudgeted / cur.income <= 0.8 : null, h: "envelope limits ÷ income" },
    ] as Array<{ l: string; v: string; ok: boolean | null; h: string }>;
  }, [data, cur, win, budgetRows, planStats]);

  const topNotes = useMemo(() => (cur ? [...cur.byNote.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) : []), [cur]);
  const noteMax = topNotes.length > 0 ? topNotes[0][1] : 1;

  const exportCsv = () => {
    if (!data) return;
    const rows = data.entries
      .filter((t) => t.date >= startISO && t.date <= endISO)
      .sort((a, b) => a.date.localeCompare(b.date));
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [
      "Date,Type,Amount,Category,Note,Account,Ref",
      ...rows.map((t) => [
        t.date, t.type, `${t.amount}`,
        esc(data.categories.find((c) => c.id === t.categoryId)?.name ?? ""),
        esc(t.note), esc(data.accounts.find((a) => a.id === t.accountId)?.name ?? ""), t.sourceRef ?? "",
      ].join(",")),
    ].join("\n");
    downloadText(`paisabook-report-${startISO}-to-${endISO}.csv`, "\ufeff" + csv, "text/csv;charset=utf-8");
  };

  const exportXLSX = () => {
    if (!data) return;
    const rows = data.entries
      .filter((t) => t.date >= startISO && t.date <= endISO)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        Date: t.date,
        Type: t.type,
        Amount: t.amount,
        Category: data.categories.find((c) => c.id === t.categoryId)?.name ?? "",
        Note: t.note || "",
        Account: data.accounts.find((a) => a.id === t.accountId)?.name ?? "",
        Ref: t.sourceRef ?? "",
      }));
    downloadAsXLSX(`paisabook-report-${startISO}-to-${endISO}.xlsx`, rows, ["Date", "Type", "Amount", "Category", "Note", "Account", "Ref"]);
  };

  const exportPDF = () => {
    if (!data) return;
    const rows = data.entries
      .filter((t) => t.date >= startISO && t.date <= endISO)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        Date: t.date,
        Type: t.type,
        Amount: fmtINR(t.amount),
        Category: data.categories.find((c) => c.id === t.categoryId)?.name ?? "",
        Note: t.note || "",
        Account: data.accounts.find((a) => a.id === t.accountId)?.name ?? "",
      }));
    downloadAsPDF(`paisabook-report-${startISO}-to-${endISO}.pdf`, `Transaction Report (${startISO} to ${endISO})`, rows, ["Date", "Type", "Amount", "Category", "Note", "Account"]);
  };

  if (!data) return null;
  if (data.entries.length === 0) {
    return (
      <div className="px-4 pt-8">
        <h1 className="font-display font-extrabold text-[24px] tracking-tight">Reports</h1>
        <Card className="mt-2">
          <EmptyState icon={<Gauge size={26} />} title="Charts need numbers" desc="Add entries or load demo data — every ratio here draws itself from your ledger."
            action={<Btn size="sm" onClick={() => go("home")}>Go add entries</Btn>} />
        </Card>
      </div>
    );
  }
  if (!cur || !prev) return null;

  const heatMax = Math.max(1, ...[...cur.byDay.values()]);
  const heatDays: string[] = [];
  for (let d = new Date(win.start); d <= win.end; d = shiftDays(d, 1)) heatDays.push(toISO(d));

  return (
    <div className="px-4">
      {/* ---------- header + period controls ---------- */}
      <div className="flex items-start justify-between gap-2 anim-fade-up">
        <div>
          <h1 className="font-display font-extrabold text-[24px] tracking-tight">Reports</h1>
          <p className="text-[12.5px] text-ink/50 mt-0.5">{fmtDate(startISO)} → {fmtDate(endISO)} · vs previous {Math.round((win.end.getTime() - win.start.getTime()) / 86400000) + 1} days</p>
        </div>
        <div className="flex gap-2">
          <Btn size="sm" variant="outline" icon={<Download size={13} />} onClick={exportCsv}>CSV</Btn>
          <Btn size="sm" variant="outline" icon={<Download size={13} />} onClick={exportXLSX}>Excel</Btn>
          <Btn size="sm" variant="outline" icon={<Download size={13} />} onClick={exportPDF}>PDF</Btn>
        </div>
      </div>

      <div className="sticky top-[54px] lg:top-0 z-20 -mx-4 px-4 pt-2.5 pb-2 bg-moss/90 backdrop-blur anim-fade-up">
        <div className="flex items-center gap-2 flex-wrap">
          <Seg
            value={period}
            onChange={setPeriod}
            options={[
              { v: "7d" as Period, label: "7D" },
              { v: "30d" as Period, label: "30D" },
              { v: "3m" as Period, label: "3M" },
              { v: "1y" as Period, label: "1Y" },
              { v: "custom" as Period, label: "Custom", icon: <CalendarRange size={12} /> },
            ]}
          />
          <Seg
            value={gran}
            onChange={setGran}
            options={[
              { v: "auto" as Gran, label: "Auto" },
              { v: "day" as Gran, label: "Day" },
              { v: "week" as Gran, label: "Wk" },
              { v: "month" as Gran, label: "Mo" },
            ]}
          />
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2 mt-2 anim-tick">
            <TInput type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="!py-1.5 text-[12.5px] !w-auto" />
            <span className="text-ink/40 text-[12px] font-semibold">to</span>
            <TInput type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="!py-1.5 text-[12.5px] !w-auto" />
          </div>
        )}
      </div>

      {/* ---------- headline ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mt-3">
        {[
          { l: "Money in", v: fmtCompactINR(tIncome), d: <Delta cur={cur.income} prev={prev.income} />, cls: "text-pine-600" },
          { l: "Money out", v: fmtCompactINR(tExpense), d: <Delta cur={cur.expense} prev={prev.expense} invert />, cls: "text-ink" },
          { l: "Net", v: `${tNet >= 0 ? "+" : "−"}${fmtCompactINR(Math.abs(tNet))}`, d: <Delta cur={cur.net} prev={prev.net} />, cls: cur.net >= 0 ? "text-pine-600" : "text-flare-600" },
          { l: "Entries", v: `${cur.txCount}`, d: <Delta cur={cur.txCount} prev={prev.txCount} suffix="" />, cls: "text-ink" },
          { l: "Avg / entry", v: cur.txCount > 0 ? fmtCompactINR(cur.expense / cur.txCount) : "—", d: <Delta cur={cur.txCount > 0 ? cur.expense / cur.txCount : 0} prev={prev.txCount > 0 ? prev.expense / prev.txCount : 0} invert />, cls: "text-ink" },
          { l: "Transfers", v: fmtCompactINR(cur.transferVol), d: <Delta cur={cur.transferVol} prev={prev.transferVol} suffix="" />, cls: "text-ink" },
        ].map((s, i) => (
          <Card key={s.l} className="p-3.5 anim-tick hover:-translate-y-0.5 transition-transform" >
            <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">{s.l}</div>
            <div className={cx("font-display font-extrabold text-[19px] num mt-0.5", s.cls)}>{s.v}</div>
            <div className="mt-0.5">{s.d}</div>
            <span className="hidden">{i}</span>
          </Card>
        ))}
      </div>

      {/* ---------- net worth + cashflow ---------- */}
      <div className="grid lg:grid-cols-5 gap-2.5 mt-2.5">
        <Reveal className="lg:col-span-3">
          <Card className="p-4 h-full">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-display font-bold text-[15px] flex items-center gap-2"><TrendingUp size={16} className="text-pine-600" /> Net worth trajectory</h3>
              <Badge tone="pine">{fmtCompactINR(nwSeries[nwSeries.length - 1]?.netWorth ?? 0)}</Badge>
            </div>
            <div className="h-[210px] lg:h-[250px] -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={nwSeries} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwR" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-pine-500)" stopOpacity={0.34} />
                      <stop offset="100%" stopColor="var(--color-pine-500)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-ink)", fillOpacity: 0.55 }} axisLine={false} tickLine={false} minTickGap={28} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--color-ink)", fillOpacity: 0.45 }} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]}
                    tickFormatter={maskTick} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtINR(Number(v)), "Net worth"]} />
                  <Area type="monotone" dataKey="netWorth" stroke="var(--color-pine-600)" strokeWidth={2.4} fill="url(#nwR)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Reveal>
        <Reveal delay={60} className="lg:col-span-2">
          <Card className="p-4 h-full">
            <h3 className="font-display font-bold text-[15px] flex items-center gap-2 mb-1"><Gauge size={16} className="text-pine-600" /> Cash flow</h3>
            <div className="h-[210px] lg:h-[250px] -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flowSeries} margin={{ top: 6, right: 4, left: -10, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 4" />
                  <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: "var(--color-ink)", fillOpacity: 0.55 }} axisLine={false} tickLine={false} minTickGap={22} />
                  <YAxis tick={{ fontSize: 9.5, fill: "var(--color-ink)", fillOpacity: 0.45 }} axisLine={false} tickLine={false} width={40}
                    tickFormatter={maskTick} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(18,133,90,0.06)" }} formatter={(v) => fmtINR(Number(v))} />
                  <Bar dataKey="Income" fill="#12855a" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="Expense" fill="#e8940a" radius={[3, 3, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Reveal>
      </div>

      {/* ---------- categories ---------- */}
      <Reveal className="mt-2.5">
        <Card className="p-4">
          <h3 className="font-display font-bold text-[15px] mb-2">Where it went</h3>
          {catRows.length === 0 ? (
            <p className="text-[13px] text-ink/50">No expenses in this period.</p>
          ) : (
            <div className="grid md:grid-cols-[220px_1fr] gap-5 items-center">
              <div className="relative w-[190px] h-[190px] mx-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={catRows.slice(0, 9)} dataKey="amount" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2.5} strokeWidth={0}>
                      {catRows.slice(0, 9).map((c, i) => <Cell key={c.id} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtINR(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center text-center pointer-events-none">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-ink/40">spent</div>
                    <div className="font-display font-extrabold text-[17px] num text-ink leading-tight">{fmtCompactINR(cur.expense)}</div>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                {catRows.slice(0, 8).map((c, i) => (
                  <div key={c.id} className="grid grid-cols-[14px_1fr_auto_auto] items-center gap-2.5 text-[12.5px] group">
                    <span className="w-3 h-3 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="truncate text-ink/80 font-medium">{c.name}</span>
                    <span className="num text-ink/45 w-11 text-right">{pct(c.share, 0)}</span>
                    <span className="num font-semibold text-ink/85 w-20 text-right">{fmtCompactINR(c.amount)}</span>
                    <span className="col-start-2 col-span-3 h-1.5 rounded-full bg-line/60 overflow-hidden -mt-0.5">
                      <span className="block h-full rounded-full transition-all duration-500 group-hover:opacity-80" style={{ width: `${c.share * 100}%`, background: PALETTE[i % PALETTE.length] }} />
                    </span>
                    <span className="col-start-2 -mt-0.5">{c.delta !== null ? <Delta cur={c.amount} prev={c.prev} invert /> : <span className="text-[10px] text-ink/30 font-bold">new</span>}</span>
                  </div>
                ))}
                {catRows.length > 8 && <div className="text-[11px] text-ink/40 pt-1">+{catRows.length - 8} more categories</div>}
              </div>
            </div>
          )}
        </Card>
      </Reveal>

      {/* ---------- budget vs actual + goals ---------- */}
      <div className="grid lg:grid-cols-5 gap-2.5 mt-2.5">
        <Reveal className="lg:col-span-3">
          <Card className="p-4 h-full">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-display font-bold text-[15px] flex items-center gap-2"><PiggyBank size={16} className="text-pine-600" /> Budget vs actual</h3>
              {budgetRows.adherence !== null && <Badge tone={budgetRows.adherence >= 0.8 ? "pine" : "mari"}>{pct(budgetRows.adherence, 0)} on track</Badge>}
            </div>
            {budgetRows.rows.length === 0 ? (
              <p className="text-[13px] text-ink/50">No budgets overlap this period — create envelopes in Funds → Budgets.</p>
            ) : (
              <div className="space-y-2.5">
                {budgetRows.rows.slice(0, 8).map((r) => (
                  <div key={r.id}>
                    <div className="flex justify-between text-[12.5px] mb-1 items-baseline gap-2">
                      <span className="font-medium text-ink/80 truncate">{r.name} {r.rollover && <Badge tone="sky" className="!text-[9px]">rollover</Badge>}</span>
                      <span className="num text-ink/55 shrink-0">
                        {fmtCompactINR(r.actual)}{r.limit !== null ? ` / ${fmtCompactINR(r.limit)}` : " · no envelope"}
                        {r.over && <span className="text-flare-600 font-bold ml-1">▲ over</span>}
                      </span>
                    </div>
                    {r.limit !== null ? (
                      <div className="h-2 rounded-full bg-line/60 overflow-hidden">
                        <div className={cx("h-full rounded-full transition-all duration-700", r.over ? "bg-flare-500" : r.ratio > 0.85 ? "bg-mari-500" : "bg-pine-500")} style={{ width: `${Math.min(100, r.ratio * 100)}%` }} />
                      </div>
                    ) : (
                      <div className="h-2 rounded-full bg-line/40" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Reveal>
        <Reveal delay={60} className="lg:col-span-2">
          <Card className="p-4 h-full">
            <h3 className="font-display font-bold text-[15px] flex items-center gap-2 mb-2.5"><Target size={16} className="text-pine-600" /> Goal progress</h3>
            {data.goals.length === 0 ? (
              <p className="text-[13px] text-ink/50">No goals yet — start one in Funds → Goals.</p>
            ) : (
              <div className="space-y-3.5">
                {data.goals.map((g) => {
                  const p = Math.min(1, g.targetAmount > 0 ? g.currentAmount / g.targetAmount : 0);
                  const inPeriod = g.contributions.filter((c) => c.date >= startISO && c.date <= endISO).reduce((s, c) => s + c.amount, 0);
                  const monthsLeft = g.targetDate ? Math.max(1, daysUntil(g.targetDate) / 30) : null;
                  const need = monthsLeft && p < 1 ? (g.targetAmount - g.currentAmount) / monthsLeft : null;
                  return (
                    <div key={g.id}>
                      <div className="flex justify-between text-[12.5px] mb-1">
                        <span className="font-medium text-ink/80 truncate">{g.name}</span>
                        <span className="num text-ink/55 shrink-0">{fmtCompactINR(g.currentAmount)} / {fmtCompactINR(g.targetAmount)}</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-line/60 overflow-hidden">
                        <div className={cx("h-full rounded-full transition-all duration-700", p >= 1 ? "bg-pine-500" : "bg-skyx-600")} style={{ width: `${p * 100}%` }} />
                      </div>
                      <div className="flex justify-between text-[10.5px] mt-1 text-ink/45 num">
                        <span>{pct(p, 0)} funded{inPeriod > 0 && <b className="text-pine-600"> · +{fmtCompactINR(inPeriod)} this period</b>}</span>
                        {need !== null && need > 0 && <span>needs {fmtCompactINR(Math.ceil(need))}/mo</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      {/* ---------- plans + top merchants ---------- */}
      <div className="grid lg:grid-cols-5 gap-2.5 mt-2.5">
        <Reveal className="lg:col-span-2">
          <Card className="p-4 h-full">
            <h3 className="font-display font-bold text-[15px] flex items-center gap-2 mb-2.5"><Flag size={16} className="text-pine-600" /> Planned expenses</h3>
            {planStats ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-line bg-moss/60 p-3">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">due in period</div>
                    <div className="font-display font-extrabold text-[17px] num text-ink mt-0.5">{fmtCompactINR(planStats.plannedSum)}</div>
                    <div className="text-[10.5px] text-ink/40">{planStats.dueInWindow.length} bills</div>
                  </div>
                  <div className="rounded-xl border border-line bg-moss/60 p-3">
                    <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">paid (tagged)</div>
                    <div className="font-display font-extrabold text-[17px] num text-pine-600 mt-0.5">{fmtCompactINR(planStats.paidSum)}</div>
                    <div className="text-[10.5px] text-ink/40">{planStats.execution !== null ? `${pct(planStats.execution, 0)} execution` : "—"}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-mari-400/40 bg-mari-100/50 p-3">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-mari-700">committed · next 30 days</div>
                  <div className="font-display font-extrabold text-[17px] num text-ink mt-0.5">{fmtCompactINR(planStats.committedSum)}</div>
                  <div className="text-[10.5px] text-ink/45">already kept out of “available to spend”</div>
                </div>
                {planStats.dueInWindow.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex justify-between text-[12.5px]">
                    <span className="text-ink/70 truncate">{p.name} <span className="text-ink/40">· {fmtDate(p.dueDate)}</span></span>
                    <span className="num font-semibold text-ink/80">{fmtINR(p.amount)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </Reveal>
        <Reveal delay={60} className="lg:col-span-3">
          <Card className="p-4 h-full">
            <h3 className="font-display font-bold text-[15px] mb-2.5">Top merchants & notes</h3>
            {topNotes.length === 0 ? (
              <p className="text-[13px] text-ink/50">Nothing to rank this period.</p>
            ) : (
              <div className="space-y-2">
                {topNotes.map(([note, amt], i) => (
                  <div key={note} className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5">
                    <span className={cx("w-6 h-6 rounded-lg grid place-items-center text-[11px] font-display font-extrabold border", i === 0 ? "bg-mari-500 text-white border-mari-500" : "bg-moss text-ink/50 border-line")}>{i + 1}</span>
                    <div className="min-w-0">
                      <div className="flex justify-between text-[12.5px] mb-0.5 gap-2">
                        <span className="truncate font-medium text-ink/80">{note}</span>
                        <span className="num text-ink/55 shrink-0">{fmtCompactINR(amt)} · {cur.expense > 0 ? pct(amt / cur.expense, 0) : "—"}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-line/60 overflow-hidden">
                        <div className={cx("h-full rounded-full", i === 0 ? "bg-mari-500" : "bg-pine-400")} style={{ width: `${(amt / noteMax) * 100}%` }} />
                      </div>
                    </div>
                    <span className="hidden" />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      {/* ---------- ratio wall ---------- */}
      <SectionTitle right={<Badge tone="gray" icon={<Gauge size={11} />}>live · recomputes on every entry</Badge>}>Every ratio that matters</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {ratios.map((r, i) => <RatioTile key={r.l} label={r.l} value={r.v} ok={r.ok} hint={r.h} delay={i * 35} />)}
      </div>

      {/* ---------- daily heat ---------- */}
      <Reveal className="mt-2.5">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-display font-bold text-[15px]">Spending heat · {monthLabel(monthKey(win.start))}{monthKey(win.start) !== monthKey(win.end) ? ` – ${monthLabel(monthKey(win.end))}` : ""}</h3>
            <span className="text-[10.5px] text-ink/40 flex items-center gap-1.5">quiet <span className="inline-flex gap-[2px]">{[0.15, 0.35, 0.6, 0.85, 1].map((o, i) => <span key={i} className="w-2.5 h-2.5 rounded-[3px]" style={{ background: `rgba(18,133,90,${o})` }} />)}</span> heavy</span>
          </div>
          <div className="flex flex-wrap gap-[3px]">
            {heatDays.map((day) => {
              const v = cur.byDay.get(day) ?? 0;
              return (
                <span
                  key={day}
                  title={`${fmtDate(day)}: ${fmtINR(v)}`}
                  className="w-[13px] h-[13px] rounded-[3.5px] transition-transform hover:scale-125 cursor-default"
                  style={{ background: v > 0 ? `rgba(18,133,90,${0.18 + 0.82 * (v / heatMax)})` : "var(--color-line)", opacity: v > 0 ? 1 : 0.5 }}
                />
              );
            })}
          </div>
        </Card>
      </Reveal>

      <p className="text-[11px] text-ink/40 px-1 mt-3 mb-1">
        Ratios ignore transfers and reserved-fund movements so lending money never distorts them. Period: {fmtDate(startISO)} – {fmtDate(endISO)}.
      </p>
    </div>
  );
}
