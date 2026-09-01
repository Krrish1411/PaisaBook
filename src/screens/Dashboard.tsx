import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Banknote, Bell, CalendarClock, ChevronDown, ChevronUp, CreditCard,
  Landmark, LayoutGrid, Lock, PiggyBank, Send, SlidersHorizontal, TrendingDown, TrendingUp, Users, Wallet, Plus,
} from "lucide-react";
import { db, getRates } from "../db";
import { computeBudgetLines } from "../lib/compute";
import { computeDerived, isRealExpense, isRealIncome } from "../lib/compute";
import { cx, daysUntil, dueLabel, fmtCompactINR, fmtDate, fmtINR, fmtMoney, maskTick, monthLabel, monthKey, pct, usePrivacy } from "../lib/core";
import { Badge, Btn, Card, EmptyState, Reveal, SectionTitle, Sheet, Toggle, useToast, useTween } from "../components/ui";

const ACC_ICON: Record<string, typeof Landmark> = { bank: Landmark, cash: Banknote, wallet: Wallet, credit: CreditCard };

type WidgetId = "accounts" | "funds" | "ratios" | "recent";
const WIDGET_LABEL: Record<WidgetId, string> = {
  accounts: "Accounts strip",
  funds: "Not your money",
  ratios: "Money vitals",
  recent: "Recent entries",
};
const DEFAULT_LAYOUT: WidgetId[] = ["accounts", "funds", "ratios", "recent"];

interface DashLayout { order: WidgetId[]; hidden: WidgetId[] }

export default function Dashboard({ go, openAdd }: { go: (t: string) => void; openAdd: () => void }) {
  usePrivacy(); // subscribe → every number re-masks instantly when privacy flips
  const [customize, setCustomize] = useState(false);

  const data = useLiveQuery(async () => {
    const [accounts, entries, funds, plans, categories, budgets, rates, layout] = await Promise.all([
      db.accounts.toArray(), db.entries.toArray(), db.reservedFunds.toArray(), db.plannedExpenses.toArray(),
      db.categories.toArray(), db.budgets.toArray(), getRates(), db.kv.get("dash.layout"),
    ]);
    return { accounts, entries, funds, plans, categories, budgets, rates, layout: (layout?.value as DashLayout | undefined) ?? null };
  }, []);

  const d = useMemo(
    () => (data ? computeDerived(data.accounts, data.entries, data.funds, data.plans, data.rates) : null),
    [data]
  );

  const tAvail = useTween(d?.available ?? 0);
  const tIn = useTween(d?.monthIncome ?? 0);
  const tOut = useTween(d?.monthExpense ?? 0);
  const tNW = useTween(d?.netWorth ?? 0);

  const alerts = useMemo(() => {
    if (!data || !d) return [] as Array<{ id: string; icon: typeof Bell; tone: "warn" | "over"; text: string }>;
    const out: Array<{ id: string; icon: typeof Bell; tone: "warn" | "over"; text: string }> = [];
    const mk = monthKey(new Date());
    const prevKey = monthKey(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
    const prevSpent = (cid: string) => data.entries.filter((t) => t.type === "expense" && !t.isReserved && t.categoryId === cid && t.date.startsWith(prevKey)).reduce((s, t) => s + t.amount, 0);
    for (const l of computeBudgetLines(data.budgets, data.entries, data.categories, mk, prevSpent)) {
      if (l.over) out.push({ id: `b-${l.budget.id}`, icon: PiggyBank, tone: "over", text: `${l.category?.name ?? "Budget"} is over by ${fmtINR(Math.abs(l.remaining))}` });
      else if (l.ratio >= 0.85) out.push({ id: `b-${l.budget.id}`, icon: PiggyBank, tone: "warn", text: `${l.category?.name ?? "Budget"} at ${Math.round(l.ratio * 100)}% — ${fmtINR(l.remaining)} left` });
    }
    for (const p of data.plans.filter((x) => x.status === "pending")) {
      const du = daysUntil(p.dueDate);
      if (du < 0) out.push({ id: `p-${p.id}`, icon: CalendarClock, tone: "over", text: `${p.name} is overdue (${dueLabel(p.dueDate)})` });
      else if (du <= 7) out.push({ id: `p-${p.id}`, icon: CalendarClock, tone: "warn", text: `${p.name} — ${dueLabel(p.dueDate)} · ${fmtINR(p.amount)}` });
    }
    for (const f of data.funds.filter((x) => x.status === "active" && x.expectedReturnDate)) {
      if (daysUntil(f.expectedReturnDate!) < 0) out.push({ id: `f-${f.id}`, icon: Lock, tone: "over", text: `${f.personName}'s money is overdue` });
    }
    return out;
  }, [data, d]);

  if (!data || !d) return null;
  const activeAccounts = data.accounts.filter((a) => !a.archived);

  if (activeAccounts.length === 0) {
    return (
      <div className="px-4 pt-8">
        <Card>
          <EmptyState
            icon={<Landmark size={26} />}
            title="Set up your first account"
            desc="Add a bank account, cash or wallet — everything else (funds, plans, budgets) hangs off it."
            action={<Btn icon={<Plus size={14} />} onClick={() => go("settings")}>Go to Settings</Btn>}
          />
        </Card>
      </div>
    );
  }

  const activeFunds = data.funds.filter((f) => f.status === "active");
  const recent = [...data.entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  const accName = (id: string | null | undefined) => data.accounts.find((a) => a.id === id)?.name ?? "—";
  const accCur = (id: string | null | undefined) => data.accounts.find((a) => a.id === id)?.currency ?? "INR";
  const catOf = (id: string | null) => data.categories.find((c) => c.id === id);

  const layout: DashLayout = data.layout ?? { order: DEFAULT_LAYOUT, hidden: [] };
  const visible = layout.order.filter((w) => !layout.hidden.includes(w));

  const saveLayout = async (next: DashLayout) => {
    await db.kv.put({ key: "dash.layout", value: next });
  };

  const widgets: Record<WidgetId, React.ReactNode> = {
    accounts: (
      <Reveal key="accounts">
        <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4">
          {activeAccounts.map((a) => {
            const Icon = ACC_ICON[a.type] ?? Landmark;
            const bal = d.balances[a.id] ?? 0;
            const reserved = d.reservedPerAccount[a.id] ?? 0;
            const foreign = (a.currency ?? "INR") !== "INR";
            return (
              <div key={a.id} className="min-w-[172px] rounded-2xl border border-line bg-card p-3.5 shadow-sm hover:border-pine-300 hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-pine-50 border border-pine-200/60 grid place-items-center text-pine-600"><Icon size={15} /></span>
                  <span className="text-[12px] font-semibold text-ink/70 truncate">{a.name}</span>
                  {foreign && <Badge tone="sky">{a.currency}</Badge>}
                </div>
                <div className={cx("font-display font-extrabold text-[19px] num mt-2", a.type === "credit" ? "text-flare-600" : "text-ink")}>{fmtMoney(bal, a.currency)}</div>
                <div className="text-[10.5px] text-ink/45 mt-0.5">
                  {a.type === "credit" ? "outstanding" : reserved > 0 ? <span className="text-mari-600 font-semibold">{fmtCompactINR(reserved)} reserved inside</span> : foreign ? <span className="num">≈ {fmtCompactINR(bal * (data.rates[a.currency ?? "INR"] ?? 1))}</span> : a.type}
                </div>
              </div>
            );
          })}
        </div>
      </Reveal>
    ),
    funds: activeFunds.length > 0 ? (
      <div key="funds">
        <SectionTitle right={<Badge tone="mari" icon={<Lock size={11} />}>kept honest</Badge>}>Not your money</SectionTitle>
        <Reveal>
          <div className="space-y-2.5">
            {activeFunds.map((f) => {
              const overdue = f.expectedReturnDate ? daysUntil(f.expectedReturnDate) < 0 : false;
              const soon = f.expectedReturnDate ? daysUntil(f.expectedReturnDate) <= 7 && !overdue : false;
              const cfg = f.direction === "holding_for_them"
                ? { icon: Lock, label: "holding for them", cls: "bg-mari-100 text-mari-600 border-mari-400/40", badge: "mari" as const }
                : f.direction === "borrowed_from_them"
                  ? { icon: Users, label: "borrowed from them", cls: "bg-skyx-100 text-skyx-600 border-skyx-600/20", badge: "sky" as const }
                  : { icon: Send, label: "yours, with them", cls: "bg-pine-50 text-pine-600 border-pine-200/70", badge: "pine" as const };
              const Icon = cfg.icon;
              return (
                <button key={f.id} onClick={() => go("funds")} className={cx("w-full text-left rounded-2xl border bg-card p-3.5 flex items-center gap-3 hover:-translate-y-0.5 hover:shadow-md transition-all", overdue ? "border-flare-500/40" : "border-line")}>
                  <span className={cx("w-10 h-10 rounded-xl grid place-items-center shrink-0 border", cfg.cls)}><Icon size={17} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-[14.5px] text-ink">{f.personName}</span>
                      <Badge tone={cfg.badge}>{cfg.label}</Badge>
                    </span>
                    <span className="block text-[11.5px] text-ink/50 mt-0.5 truncate">
                      {f.notes || `${fmtINR(f.amount)} · received ${fmtDate(f.dateReceived)}`}
                      {f.expectedReturnDate && <span className={cx("font-semibold", overdue ? "text-flare-600" : soon ? "text-mari-600" : "text-ink/45")}> · {dueLabel(f.expectedReturnDate)}</span>}
                    </span>
                  </span>
                  <span className="font-display font-extrabold text-[16px] num text-ink shrink-0">{fmtINR(f.amount)}</span>
                </button>
              );
            })}
          </div>
        </Reveal>
      </div>
    ) : null,
    ratios: (
      <div key="ratios">
        <SectionTitle right={<button className="text-[11.5px] font-semibold text-pine-700 hover:underline" onClick={() => go("reports")}>full reports →</button>}>Money vitals</SectionTitle>
        <Reveal>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { l: "Savings rate", v: pct(d.savingsRate, 0), ok: d.savingsRate >= 0.2, hint: "of this month's income" },
              { l: "Spend ÷ income", v: pct(d.expenseRatio, 0), ok: d.expenseRatio <= 0.7, hint: "under 70% is healthy" },
              { l: "Liquidity", v: d.liquidityRatio > 0 ? `${d.liquidityRatio.toFixed(1)}×` : "∞", ok: d.liquidityRatio >= 3, hint: "months of expenses covered" },
              { l: "Debt ÷ income", v: pct(d.debtToIncome, 0), ok: d.debtToIncome <= 0.35, hint: "credit + borrowed funds" },
            ].map((r, i) => (
              <div key={r.l} className="rounded-2xl border border-line bg-card p-3.5 hover:border-pine-300 transition-colors anim-tick" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-ink/45">{r.l}</div>
                <div className={cx("font-display font-extrabold text-[22px] num mt-0.5", r.ok ? "text-pine-700" : "text-mari-600")}>{r.v}</div>
                <div className="text-[10.5px] text-ink/40 mt-0.5">{r.hint}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    ),
    recent: (
      <div key="recent">
        <SectionTitle right={<button className="text-[11.5px] font-semibold text-pine-700 hover:underline" onClick={() => go("txns")}>all entries →</button>}>Recent</SectionTitle>
        <Reveal>
          <Card className="px-4 py-0.5">
            {recent.length === 0 ? (
              <EmptyState icon={<PiggyBank size={26} />} title="Nothing yet" desc="Add your first entry with the + button — or load demo data from Settings." action={<Btn size="sm" icon={<Plus size={13} />} onClick={openAdd}>Add entry</Btn>} />
            ) : (
              recent.map((t) => {
                const c = catOf(t.categoryId);
                const income = isRealIncome(t);
                const cur = t.currency ?? accCur(t.accountId);
                return (
                  <div key={t.id} className="ledger-row flex items-center gap-3 py-2.5">
                    <span className={cx("w-9 h-9 rounded-xl grid place-items-center shrink-0 border",
                      t.isReserved ? "bg-mari-100 text-mari-600 border-mari-400/40" : income ? "bg-pine-50 text-pine-600 border-pine-200/60" : t.type === "transfer" ? "bg-moss text-ink/50 border-line" : "bg-moss text-pine-700 border-line")}>
                      {t.isReserved ? <Lock size={15} /> : t.type === "transfer" ? <ArrowLeftRight size={15} /> : income ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-ink/90 truncate">{t.note || c?.name || "Entry"}</span>
                      <span className="block text-[11px] text-ink/45 truncate">{accName(t.accountId)}{t.type === "transfer" ? ` → ${accName(t.toAccountId)}` : ""} · {fmtDate(t.date)}</span>
                    </span>
                    <span className={cx("num font-bold text-[14px]", income ? "text-pine-600" : t.type === "transfer" ? "text-ink/55" : "text-ink")}>
                      {income ? "+" : t.type === "transfer" ? "" : "−"}{fmtMoney(t.amount, cur)}
                    </span>
                  </div>
                );
              })
            )}
          </Card>
        </Reveal>
      </div>
    ),
  };

  return (
    <div className="px-4">
      {/* ---------- alerts ---------- */}
      {alerts.length > 0 && (
        <button onClick={() => go("funds")} className="w-full text-left mb-3 rounded-2xl border border-mari-400/50 bg-mari-100/70 px-4 py-3 flex items-start gap-2.5 hover:-translate-y-0.5 hover:shadow-md transition-all anim-fade-up">
          <Bell size={16} className={cx("shrink-0 mt-0.5", alerts.some((a) => a.tone === "over") ? "text-flare-600" : "text-mari-600")} />
          <span className="flex-1 min-w-0">
            <span className="block text-[12.5px] font-bold text-ink/85">
              {alerts.length} thing{alerts.length > 1 ? "s" : ""} need{alerts.length === 1 ? "s" : ""} attention
            </span>
            <span className="block text-[12px] text-ink/60 truncate mt-0.5">{alerts[0].text}{alerts.length > 1 ? ` · +${alerts.length - 1} more` : ""}</span>
          </span>
        </button>
      )}

      {/* ---------- hero ---------- */}
      <section className="hero-weave hero-sheen relative overflow-hidden rounded-2xl text-pine-50 px-5 py-5 anim-fade-up shadow-lg shadow-pine-900/25">
        <div className="rupee-watermark">₹</div>
        <div className="relative">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] font-semibold text-pine-200">
              <CalendarClock size={12} /> {monthLabel(monthKey(new Date()))} · available to spend
            </div>
            <button
              onClick={() => setCustomize(true)}
              aria-label="Customize dashboard"
              title="Customize dashboard"
              className="w-8 h-8 grid place-items-center rounded-lg bg-white/10 border border-white/15 text-pine-100 hover:bg-white/20 active:scale-90 transition-all"
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>
          <div className="font-display font-extrabold text-[38px] num tracking-tight leading-tight mt-1">{fmtINR(tAvail)}</div>
          <div className="flex gap-5 mt-2 text-[12.5px]">
            <span className="flex items-center gap-1.5 text-pine-200"><ArrowDownLeft size={13} className="text-pine-300" /> In <b className="num text-pine-50">{fmtCompactINR(tIn)}</b></span>
            <span className="flex items-center gap-1.5 text-pine-200"><ArrowUpRight size={13} className="text-mari-300" /> Out <b className="num text-pine-50">{fmtCompactINR(tOut)}</b></span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3.5">
            <Badge tone="mari" icon={<Lock size={11} />}>{fmtCompactINR(d.reservedTotal)} not yours</Badge>
            <Badge tone="sky" icon={<Send size={11} />}>{fmtCompactINR(d.givenOutTotal)} given out</Badge>
            <Badge tone="gray" className="!bg-white/10 !text-pine-100 !border-white/20" icon={<CalendarClock size={11} />}>{fmtCompactINR(d.committedTotal)} committed</Badge>
          </div>
        </div>
      </section>

      {/* ---------- net worth (top chart) ---------- */}
      <Reveal className="mt-3">
        <Card className="p-4 overflow-hidden relative">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-ink/45 flex items-center gap-1.5">
                {(() => {
                  const s = d.series;
                  const delta = s.length > 1 ? s[s.length - 1].netWorth - s[s.length - 2].netWorth : 0;
                  return delta >= 0 ? <TrendingUp size={13} className="text-pine-600" /> : <TrendingDown size={13} className="text-flare-600" />;
                })()}
                Net worth · 8 months
              </div>
              <div className="font-display font-extrabold text-[26px] num text-ink tracking-tight leading-tight mt-0.5">{fmtINR(tNW)}</div>
              {(() => {
                const s = d.series;
                const delta = s.length > 1 ? s[s.length - 1].netWorth - s[s.length - 2].netWorth : 0;
                return (
                  <div className={cx("text-[11.5px] font-bold num mt-0.5", delta >= 0 ? "text-pine-600" : "text-flare-600")}>
                    {delta >= 0 ? "▲" : "▼"} {fmtCompactINR(Math.abs(delta))} vs last month
                  </div>
                );
              })()}
              {/* the exact formula */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] num">
                <span className="font-bold text-pine-700">+{fmtCompactINR(d.totalAssets)} assets</span>
                <span className="text-ink/40">−</span>
                <span className="font-semibold text-flare-600">{fmtCompactINR(d.totalLiabilities)} owed</span>
                {(d.reservedHolding > 0 || d.reservedBorrowed > 0) && (
                  <>
                    <span className="text-ink/40">−</span>
                    <span className="font-semibold text-mari-600">{fmtCompactINR(d.reservedHolding + d.reservedBorrowed)} others' money</span>
                  </>
                )}
                {d.givenOutTotal > 0 && (
                  <>
                    <span className="text-ink/40">+</span>
                    <span className="font-semibold text-skyx-600">{fmtCompactINR(d.givenOutTotal)} given out</span>
                  </>
                )}
              </div>
            </div>
            <Badge tone="pine" icon={<TrendingUp size={11} />}>{fmtCompactINR(d.liquidBalance)} liquid</Badge>
          </div>
          <div className="h-[168px] -mx-1 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.series} margin={{ top: 6, right: 6, left: -6, bottom: 0 }}>
                <defs>
                  <linearGradient id="nwHome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-pine-500)" stopOpacity={0.34} />
                    <stop offset="100%" stopColor="var(--color-pine-500)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 4" />
                <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "var(--color-ink)", fillOpacity: 0.55 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--color-ink)", fillOpacity: 0.45 }} axisLine={false} tickLine={false} width={46} domain={["auto", "auto"]} tickFormatter={maskTick} />
                <Tooltip
                  contentStyle={{ background: "var(--color-pine-900)", border: "1px solid var(--color-pine-700)", borderRadius: 10, fontSize: 12, color: "var(--color-pine-50)" }}
                  formatter={(v) => [fmtINR(Number(v)), "Net worth"]}
                />
                <Area type="monotone" dataKey="netWorth" stroke="var(--color-pine-600)" strokeWidth={2.4} fill="url(#nwHome)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Reveal>

      {/* ---------- customizable widgets ---------- */}
      <div className="mt-3 space-y-1">
        {visible.map((w) => widgets[w])}
      </div>
      <div className="h-2" />

      {customize && (
        <CustomizeSheet
          layout={layout}
          onSave={async (next) => { await saveLayout(next); }}
          onClose={() => setCustomize(false)}
        />
      )}
    </div>
  );
}

function CustomizeSheet({ layout, onSave, onClose }: { layout: DashLayout; onSave: (l: DashLayout) => Promise<void>; onClose: () => void }) {
  const toast = useToast();
  const [order, setOrder] = useState<WidgetId[]>([...layout.order, ...DEFAULT_LAYOUT.filter((w) => !layout.order.includes(w))]);
  const [hidden, setHidden] = useState<WidgetId[]>([...layout.hidden]);

  const move = (w: WidgetId, dir: -1 | 1) => {
    const i = order.indexOf(w);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2"><LayoutGrid size={17} className="text-pine-600" /> Customize home</span>}
      footer={
        <Btn className="w-full" size="lg" onClick={async () => { await onSave({ order, hidden }); toast.push("Dashboard layout saved"); onClose(); }}>Save layout</Btn>
      }
    >
      <p className="text-[12.5px] text-ink/60 mb-3 leading-relaxed">The hero and net-worth chart always stay on top. Reorder or hide the blocks below — saved on this device.</p>
      <div className="space-y-2">
        {order.map((w, i) => {
          const off = hidden.includes(w);
          return (
            <div key={w} className={cx("flex items-center gap-2.5 rounded-xl border border-line bg-card px-3 py-2.5 transition-opacity", off && "opacity-50")}>
              <span className="flex flex-col gap-0.5">
                <button aria-label="move up" disabled={i === 0} onClick={() => move(w, -1)} className="text-ink/40 hover:text-ink disabled:opacity-30 transition-colors"><ChevronUp size={14} /></button>
                <button aria-label="move down" disabled={i === order.length - 1} onClick={() => move(w, 1)} className="text-ink/40 hover:text-ink disabled:opacity-30 transition-colors"><ChevronDown size={14} /></button>
              </span>
              <span className="flex-1 text-[13.5px] font-semibold text-ink/85">{WIDGET_LABEL[w]}</span>
              <Toggle on={!off} onChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== w) : [...h, w]))} label={`show ${WIDGET_LABEL[w]}`} />
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

void isRealExpense;
