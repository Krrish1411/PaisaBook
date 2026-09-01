import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, FilterX, Inbox, Lock, Plus, Search, Tag, X } from "lucide-react";
import { addRule, categorizeText, db, getRates, updateEntry } from "../db";
import type { Entry, TxType } from "../types";
import { isRealExpense, isRealIncome } from "../lib/compute";
import { cx, fmtCompactINR, fmtDate, fmtINR, fmtMoney, monthLabel, toINR, usePrivacy } from "../lib/core";
import { Badge, Btn, Card, Chip, EmptyState, ProgressBar, Seg, Sheet, TInput, TSelect, useToast } from "../components/ui";
import EntrySheet from "../components/EntrySheet";

type TypeFilter = "all" | TxType;

export default function Entries({ openAdd }: { openAdd: () => void }) {
  usePrivacy(); // numbers re-mask instantly when privacy flips
  const toast = useToast();

  const data = useLiveQuery(async () => {
    const [entries, accounts, categories, rules, rates] = await Promise.all([
      db.entries.toArray(), db.accounts.toArray(), db.categories.toArray(), db.rules.toArray(), getRates(),
    ]);
    return { entries, accounts, categories, rules, rates };
  }, []);

  const [q, setQ] = useState("");
  const [accF, setAccF] = useState("all");
  const [typeF, setTypeF] = useState<TypeFilter>("all");
  const [monthF, setMonthF] = useState("all");
  const [catF, setCatF] = useState("all");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [tagging, setTagging] = useState<Entry | null>(null);

  const months = useMemo(() => {
    const s = new Set<string>();
    for (const t of data?.entries ?? []) s.add(t.date.slice(0, 7));
    return [...s].sort((a, b) => b.localeCompare(a));
  }, [data]);

  const activeFilterCount = [accF !== "all", typeF !== "all", monthF !== "all", catF !== "all", !!minAmt, !!maxAmt, !!q.trim()].filter(Boolean).length;

  const filtered = useMemo(() => {
    let list = data?.entries ?? [];
    const rate = (t: Entry) => data?.rates[t.currency ?? "INR"] ?? 1;
    if (accF !== "all") list = list.filter((t) => t.accountId === accF || t.toAccountId === accF);
    if (typeF !== "all") list = list.filter((t) => t.type === typeF);
    if (monthF !== "all") list = list.filter((t) => t.date.startsWith(monthF));
    if (catF !== "all") list = list.filter((t) => (catF === "none" ? !t.categoryId : t.categoryId === catF));
    const mn = parseFloat(minAmt);
    const mx = parseFloat(maxAmt);
    if (!isNaN(mn)) list = list.filter((t) => t.amount * rate(t) >= mn);
    if (!isNaN(mx) && mx > 0) list = list.filter((t) => t.amount * rate(t) <= mx);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((t) => (t.note || "").toLowerCase().includes(s) || (t.sourceRef || "").toLowerCase().includes(s) || t.tags.some((x) => x.toLowerCase().includes(s)));
    }
    return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [data, q, accF, typeF, monthF, catF, minAmt, maxAmt]);

  const totals = useMemo(() => {
    let inc = 0, exp = 0;
    for (const t of filtered) {
      const v = toINR(t.amount, t.currency, data?.rates ?? {});
      if (isRealIncome(t)) inc += v;
      else if (isRealExpense(t)) exp += v;
    }
    return { inc, exp };
  }, [filtered, data]);

  const grouped = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const t of filtered) {
      const arr = m.get(t.date) ?? [];
      arr.push(t);
      m.set(t.date, arr);
    }
    return [...m.entries()];
  }, [filtered]);

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) if (isRealExpense(t)) m.set(t.categoryId ?? "uncat", (m.get(t.categoryId ?? "uncat") ?? 0) + toINR(t.amount, t.currency, data?.rates ?? {}));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filtered, data]);

  const byAcc = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of filtered) if (isRealExpense(t)) m.set(t.accountId, (m.get(t.accountId) ?? 0) + toINR(t.amount, t.currency, data?.rates ?? {}));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered, data]);

  const clearAll = () => {
    setQ(""); setAccF("all"); setTypeF("all"); setMonthF("all"); setCatF("all"); setMinAmt(""); setMaxAmt("");
  };

  if (!data) return null;
  const accName = (id: string | null | undefined) => data.accounts.find((a) => a.id === id)?.name ?? "—";
  const accCur = (id: string | null | undefined) => data.accounts.find((a) => a.id === id)?.currency ?? "INR";

  return (
    <div className="px-4">
      <div className="flex items-center justify-between anim-fade-up">
        <div>
          <h1 className="font-display font-extrabold text-[24px] tracking-tight text-ink">Entries</h1>
          <p className="text-[12.5px] text-ink/50 mt-0.5">
            {filtered.length} shown · <span className="text-pine-600 font-semibold num">+{fmtINR(totals.inc)}</span>{" "}
            <span className="text-ink/60 num font-semibold">−{fmtINR(totals.exp)}</span>
            <span className="text-ink/40"> (INR)</span>
          </p>
        </div>
        <Btn size="sm" icon={<Plus size={14} />} onClick={openAdd}>Add</Btn>
      </div>

      {/* ---------- search + filters ---------- */}
      <div className="mt-3 space-y-2.5 anim-fade-up">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/35" />
            <TInput className="pl-10" placeholder="Search note, UPI/UTR ref, tag…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button onClick={() => setQ("")} aria-label="clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 hover:text-ink"><X size={14} /></button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            aria-label="toggle filters"
            className={cx(
              "relative w-11 shrink-0 grid place-items-center rounded-xl border transition-all active:scale-95",
              showFilters || activeFilterCount > 0 ? "bg-pine-700 border-pine-700 text-white" : "bg-card border-line text-pine-700 hover:border-pine-300"
            )}
          >
            <Search size={0} className="hidden" />
            <FilterX size={0} className="hidden" />
            <span className="relative">
              <Tag size={16} />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-mari-500 text-white text-[9px] font-bold grid place-items-center num">{activeFilterCount}</span>
              )}
            </span>
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
          <Seg
            value={typeF}
            onChange={setTypeF}
            options={[
              { v: "all" as TypeFilter, label: "All" },
              { v: "expense" as TypeFilter, label: "Out" },
              { v: "income" as TypeFilter, label: "In" },
              { v: "transfer" as TypeFilter, label: "Move" },
            ]}
          />
          <TSelect className="!w-auto min-w-[120px] !py-2 text-[13px]" value={monthF} onChange={(e) => setMonthF(e.target.value)}>
            <option value="all">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </TSelect>
          {activeFilterCount > 0 && (
            <button onClick={clearAll} className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-flare-500/30 bg-flare-100/50 px-3 py-2 text-[12px] font-semibold text-flare-600 hover:bg-flare-100 transition-colors">
              <FilterX size={12} /> Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="rounded-2xl border border-line bg-card p-3.5 anim-tick space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink/45">Account</span>
                <TSelect className="mt-1 !py-2 text-[13px]" value={accF} onChange={(e) => setAccF(e.target.value)}>
                  <option value="all">All accounts</option>
                  {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </TSelect>
              </label>
              <label className="block">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink/45">Category</span>
                <TSelect className="mt-1 !py-2 text-[13px]" value={catF} onChange={(e) => setCatF(e.target.value)}>
                  <option value="all">All categories</option>
                  <option value="none">Uncategorised</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </TSelect>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="block">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink/45">Min ₹</span>
                <TInput className="mt-1 !py-2 text-[13px] num" inputMode="decimal" value={minAmt} onChange={(e) => setMinAmt(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
              </label>
              <label className="block">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-ink/45">Max ₹</span>
                <TInput className="mt-1 !py-2 text-[13px] num" inputMode="decimal" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value.replace(/[^\d.]/g, ""))} placeholder="any" />
              </label>
            </div>
            <p className="text-[10.5px] text-ink/40">Amount filters compare in INR using your rates. Top categories below narrow on one tap:</p>
            <div className="flex gap-1.5 flex-wrap">
              <Chip active={catF === "none"} onClick={() => setCatF(catF === "none" ? "all" : "none")}>Uncategorised</Chip>
              {byCat.filter(([id]) => id !== "uncat").map(([id, amt]) => {
                const c = data.categories.find((x) => x.id === id);
                return (
                  <Chip key={id} active={catF === id} onClick={() => setCatF(catF === id ? "all" : id)}>
                    {c?.name ?? "?"} · {fmtCompactINR(amt)}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 xl:grid xl:grid-cols-[1fr_300px] xl:gap-4 xl:items-start">
        <div>
          {grouped.length === 0 ? (
            <Card>
              <EmptyState icon={<Inbox size={26} />} title={activeFilterCount > 0 ? "Nothing matches" : "No entries yet"}
                desc={activeFilterCount > 0 ? "Loosen the filters or clear them all." : "Tap the big + button to add your first entry."}
                action={activeFilterCount > 0 ? <Btn size="sm" variant="outline" icon={<FilterX size={13} />} onClick={clearAll}>Clear filters</Btn> : <Btn size="sm" icon={<Plus size={13} />} onClick={openAdd}>Add first entry</Btn>} />
            </Card>
          ) : (
            grouped.map(([date, txs]) => {
              const dayNet = txs.reduce((s, t) => s + (isRealIncome(t) ? toINR(t.amount, t.currency, data.rates) : isRealExpense(t) ? -toINR(t.amount, t.currency, data.rates) : 0), 0);
              return (
                <div key={date} className="mb-3 anim-tick">
                  <div className="flex items-center justify-between px-1 mb-1.5 sticky top-[54px] lg:top-0 z-10">
                    <span className="text-[11.5px] font-bold uppercase tracking-wider text-ink/45 bg-moss/95 backdrop-blur px-1 rounded">{fmtDate(date)}</span>
                    <span className={cx("text-[11.5px] num font-bold bg-moss/95 backdrop-blur px-1.5 rounded", dayNet >= 0 ? "text-pine-600" : "text-ink/50")}>
                      {dayNet >= 0 ? "+" : "−"}{fmtINR(Math.abs(dayNet))}
                    </span>
                  </div>
                  <Card className="px-4 py-0.5">
                    {txs.map((t) => {
                      const c = data.categories.find((x) => x.id === t.categoryId);
                      const income = isRealIncome(t);
                      const cur = t.currency ?? accCur(t.accountId);
                      const uncat = !t.isReserved && t.type !== "transfer" && !t.categoryId;
                      return (
                        <div key={t.id} className="ledger-row flex items-center gap-3 py-2.5">
                          <button onClick={() => setEditing(t)} className="flex items-center gap-3 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
                            <span className={cx("w-9 h-9 rounded-xl grid place-items-center shrink-0 border",
                              t.isReserved ? "bg-mari-100 text-mari-600 border-mari-400/40" : income ? "bg-pine-50 text-pine-600 border-pine-200/60" : t.type === "transfer" ? "bg-moss text-ink/50 border-line" : "bg-moss text-pine-700 border-line")}>
                              {t.isReserved ? <Lock size={15} /> : t.type === "transfer" ? <ArrowLeftRight size={15} /> : income ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[13.5px] font-semibold text-ink/90 truncate">{t.note || c?.name || "Entry"}</span>
                                {uncat && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setTagging(t); }}
                                    className="shrink-0 inline-flex items-center gap-1 rounded-full border border-mari-400/50 bg-mari-100/70 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-mari-700 hover:bg-mari-100 transition-colors"
                                  >
                                    <Tag size={9} /> categorise
                                  </button>
                                )}
                              </span>
                              <span className="block text-[11px] text-ink/45 truncate">
                                {accName(t.accountId)}{t.type === "transfer" ? ` → ${accName(t.toAccountId)}` : ""}
                                {t.sourceRef ? ` · ${t.sourceRef.slice(0, 14)}` : ""}
                                {t.tags.length > 0 ? ` · ${t.tags.join(", ")}` : ""}
                              </span>
                            </span>
                          </button>
                          <span className="text-right shrink-0">
                            <span className={cx("block num font-bold text-[14px]", income ? "text-pine-600" : t.type === "transfer" ? "text-ink/55" : "text-ink")}>
                              {income ? "+" : t.type === "transfer" ? "" : "−"}{fmtMoney(t.amount, cur)}
                            </span>
                            <span className="flex gap-1 justify-end mt-0.5">
                              {t.isReserved && <Badge tone="mari" icon={<Lock size={10} />}>reserved</Badge>}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </Card>
                </div>
              );
            })
          )}
        </div>

        {/* analysis rail (xl+) */}
        <aside className="hidden xl:block sticky top-6 space-y-3">
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-ink/45 mb-2">This view · INR</div>
            <div className="flex items-end justify-between">
              <div><div className="text-[11px] text-ink/50">In</div><div className="num font-display font-bold text-[17px] text-pine-600">+{fmtCompactINR(totals.inc)}</div></div>
              <div><div className="text-[11px] text-ink/50">Out</div><div className="num font-display font-bold text-[17px] text-ink">−{fmtCompactINR(totals.exp)}</div></div>
              <div>
                <div className="text-[11px] text-ink/50">Net</div>
                <div className={cx("num font-display font-bold text-[17px]", totals.inc - totals.exp >= 0 ? "text-pine-600" : "text-flare-600")}>
                  {totals.inc - totals.exp >= 0 ? "+" : "−"}{fmtCompactINR(Math.abs(totals.inc - totals.exp))}
                </div>
              </div>
            </div>
          </Card>
          {byCat.length > 0 && (
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-ink/45 mb-2.5">Top categories</div>
              <div className="space-y-2.5">
                {byCat.map(([cid, amt]) => {
                  const c = data.categories.find((x) => x.id === cid);
                  return (
                    <div key={cid}>
                      <div className="flex justify-between text-[12px] mb-1">
                        <span className="font-medium text-ink/75">{c?.name ?? "Uncategorised"}</span>
                        <span className="num text-ink/55">{fmtCompactINR(amt)}</span>
                      </div>
                      <ProgressBar value={amt} max={byCat[0][1]} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
          {byAcc.length > 0 && (
            <Card className="p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-ink/45 mb-2">By account</div>
              <div className="space-y-1.5">
                {byAcc.map(([aid, amt]) => (
                  <div key={aid} className="flex justify-between text-[12.5px]">
                    <span className="text-ink/70 truncate">{accName(aid)}</span>
                    <span className="num font-semibold text-ink/60">{fmtCompactINR(amt)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>

      <EntrySheet open={!!editing} onClose={() => setEditing(null)} editing={editing} />
      {tagging && <CategorizeSheet entry={tagging} onClose={() => setTagging(null)} onSaved={() => { toast.push("Category saved"); setTagging(null); }} />}
    </div>
  );
}

/* ---------------- quick categorise ---------------- */

function CategorizeSheet({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const data = useLiveQuery(async () => {
    const [categories, rules] = await Promise.all([db.categories.toArray(), db.rules.toArray()]);
    return { categories, rules };
  }, []);
  const [picked, setPicked] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const suggestion = useMemo(
    () => (data && entry.note ? categorizeText(entry.note, data.categories, data.rules) : null),
    [data, entry]
  );

  const save = async () => {
    if (!picked || busy) return;
    setBusy(true);
    await updateEntry(entry.id, { categoryId: picked });
    if (remember && entry.note.trim()) {
      const words = entry.note.trim().split(/\s+/).slice(0, 2).join(" ");
      if (words.length >= 3) await addRule(words, picked);
    }
    onSaved();
  };

  if (!data) return null;
  return (
    <Sheet
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Tag size={17} className="text-pine-600" /> Categorise</span>}
      footer={<Btn className="w-full" size="lg" disabled={!picked || busy} onClick={() => void save()}>{busy ? "Saving…" : remember ? "Save & remember keyword" : "Save category"}</Btn>}
    >
      <p className="text-[12.5px] text-ink/60 mb-3">
        “<b className="text-ink/85">{entry.note || "Entry"}</b>” · {fmtMoney(entry.amount, entry.currency)}
      </p>
      {suggestion && (
        <button
          onClick={() => setPicked(suggestion)}
          className={cx("w-full mb-3 rounded-xl border px-3.5 py-2.5 text-left transition-all", picked === suggestion ? "border-pine-500 bg-pine-50" : "border-line bg-card hover:border-pine-300")}
        >
          <span className="text-[10.5px] uppercase tracking-wider font-bold text-pine-600">Suggested by your rules</span>
          <span className="block text-[13.5px] font-semibold text-ink mt-0.5">{data.categories.find((c) => c.id === suggestion)?.name}</span>
        </button>
      )}
      <div className="flex gap-1.5 flex-wrap">
        {data.categories.filter((c) => c.kind === "expense").map((c) => (
          <Chip key={c.id} active={picked === c.id} onClick={() => setPicked(picked === c.id ? null : c.id)}>{c.name}</Chip>
        ))}
      </div>
      <label className="flex items-center gap-2.5 mt-4 rounded-xl border border-line bg-moss/60 px-3.5 py-2.5 cursor-pointer">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--color-pine-600)] w-4 h-4" />
        <span className="text-[12px] text-ink/65">Remember “<b className="text-ink/85">{entry.note.trim().split(/\s+/).slice(0, 2).join(" ")}</b>” as a keyword rule for next time</span>
      </label>
    </Sheet>
  );
}
