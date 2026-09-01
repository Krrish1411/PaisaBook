import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import confetti from "canvas-confetti";
import {
  CalendarClock, Check, ChevronLeft, ChevronRight, Lock, Pencil, PiggyBank, Plus, Send, Target, Trash2, Undo2, Users, Wallet,
} from "lucide-react";
import {
  addBudget, addGoal, addPlan, addReservedFund, contributeToGoal, db, deleteBudget, deleteGoal, deletePlan, payPlan, reopenFund, settleFund, updatePlan,
} from "../db";
import type { Account, Budget, Category, Entry, FundDirection, Goal, PlannedExpense, Recurrence, ReservedFund } from "../types";
import { computeBudgetLines } from "../lib/compute";
import { addDaysISO, cx, daysUntil, dueLabel, fmtDate, fmtINR, monthKey, monthLabel, pct, todayISO, usePrivacy } from "../lib/core";
import { Badge, Btn, Card, Chip, Confirm, EmptyState, Field, ProgressBar, Seg, Sheet, TInput, TSelect, TArea, Toggle, useToast, useTween } from "../components/ui";

type FundsTab = "reserved" | "planned" | "goals" | "budgets";

const pop = () => confetti({ particleCount: 150, spread: 80, origin: { y: 0.72 }, colors: ["#12855a", "#e8940a", "#6cc39d", "#f0a62b", "#0b3d2e"] });

export default function Funds({ go }: { go: (t: string) => void }) {
  usePrivacy(); // subscribe → every number re-masks instantly when privacy flips
  const data = useLiveQuery(async () => {
    const [accounts, entries, funds, plans, goals, budgets, categories] = await Promise.all([
      db.accounts.toArray(), db.entries.toArray(), db.reservedFunds.toArray(),
      db.plannedExpenses.toArray(), db.goals.toArray(), db.budgets.toArray(), db.categories.toArray(),
    ]);
    return { accounts, entries, funds, plans, goals, budgets, categories };
  }, []);

  const [tab, setTab] = useState<FundsTab>("reserved");
  const holding = useTween(data?.funds.filter((f) => f.status === "active" && f.direction === "holding_for_them").reduce((s, f) => s + f.amount, 0) ?? 0);
  const borrowed = useTween(data?.funds.filter((f) => f.status === "active" && f.direction === "borrowed_from_them").reduce((s, f) => s + f.amount, 0) ?? 0);
  const givenOut = useTween(data?.funds.filter((f) => f.status === "active" && f.direction === "given_out").reduce((s, f) => s + f.amount, 0) ?? 0);

  if (!data) return null;
  if (data.accounts.filter((a) => !a.archived).length === 0) {
    return (
      <div className="px-4 pt-8">
        <h1 className="font-display font-extrabold text-[24px] tracking-tight">Funds</h1>
        <EmptyState icon={<Wallet size={26} />} title="No account yet" desc="Reserved funds, plans, goals and budgets all attach to an account. Create one first."
          action={<Btn size="sm" onClick={() => go("settings")}>Go to Settings</Btn>} />
      </div>
    );
  }

  return (
    <div className="px-4">
      <div className="anim-fade-up">
        <h1 className="font-display font-extrabold text-[24px] tracking-tight">Funds</h1>
        <p className="text-[12.5px] text-ink/50 mt-0.5">Money that isn't yours, bills that are coming, and the pots you're building.</p>
      </div>

      <div className="sticky top-[54px] lg:top-0 z-20 -mx-4 px-4 pt-2.5 pb-2 bg-moss/90 backdrop-blur anim-fade-up">
        <Seg
          className="w-full grid grid-cols-4 [&>button]:justify-center [&>button]:px-1"
          value={tab}
          onChange={setTab}
          options={[
            { v: "reserved" as FundsTab, label: "Reserved", icon: <Lock size={13} /> },
            { v: "planned" as FundsTab, label: "Planned", icon: <CalendarClock size={13} /> },
            { v: "goals" as FundsTab, label: "Goals", icon: <Target size={13} /> },
            { v: "budgets" as FundsTab, label: "Budgets", icon: <PiggyBank size={13} /> },
          ]}
        />
      </div>

      {tab === "reserved" && <ReservedTab funds={data.funds} accounts={data.accounts} holding={holding} borrowed={borrowed} givenOut={givenOut} />}
      {tab === "planned" && <PlannedTab plans={data.plans} accounts={data.accounts} categories={data.categories} />}
      {tab === "goals" && <GoalsTab goals={data.goals} accounts={data.accounts} />}
      {tab === "budgets" && <BudgetsTab budgets={data.budgets} entries={data.entries} categories={data.categories} />}
      <div className="h-4" />
    </div>
  );
}

/* ================= reserved funds ================= */

const DIR_META: Record<FundDirection, { icon: typeof Lock; label: string; cls: string; tone: "mari" | "sky" | "pine"; blurb: string }> = {
  holding_for_them: { icon: Lock, label: "holding for them", cls: "bg-mari-100 text-mari-600 border-mari-400/40", tone: "mari", blurb: "came in — must go back" },
  borrowed_from_them: { icon: Users, label: "borrowed from them", cls: "bg-skyx-100 text-skyx-600 border-skyx-600/20", tone: "sky", blurb: "you owe this back" },
  given_out: { icon: Send, label: "yours, with them", cls: "bg-pine-50 text-pine-600 border-pine-200/70", tone: "pine", blurb: "left your account — expect it back" },
};

function ReservedTab({ funds, accounts, holding, borrowed, givenOut }: { funds: ReservedFund[]; accounts: Account[]; holding: number; borrowed: number; givenOut: number }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [settling, setSettling] = useState<ReservedFund | null>(null);
  const [reopening, setReopening] = useState<ReservedFund | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const active = funds.filter((f) => f.status === "active");
  const settled = funds.filter((f) => f.status === "settled");

  return (
    <div className="anim-fade">
      <div className="grid grid-cols-3 gap-2 mt-3">
        {[
          { icon: Lock, label: "Holding", v: holding, sub: "must go back", card: "border-mari-500/50 bg-mari-500/10", text: "text-mari-600" },
          { icon: Users, label: "Borrowed", v: borrowed, sub: "you owe back", card: "border-skyx-600/50 bg-skyx-600/10", text: "text-skyx-600" },
          { icon: Send, label: "Given out", v: givenOut, sub: "yours, elsewhere", card: "border-pine-500/50 bg-pine-500/10", text: "text-pine-600" },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className={cx("p-3 hover:-translate-y-0.5 transition-transform", c.card)}>
              <div className={cx("text-[10px] uppercase tracking-wider font-bold flex items-center gap-1", c.text)}>
                <Icon size={12} /> {c.label}
              </div>
              <div className="font-display font-extrabold text-[15px] sm:text-[19px] num text-ink mt-1 truncate">{fmtINR(c.v)}</div>
              <div className="text-[10.5px] font-medium text-ink/60 mt-0.5">{c.sub}</div>
            </Card>
          );
        })}
      </div>
      <p className="text-[11.5px] text-ink/45 flex items-center gap-1.5 mt-2 px-1">
        <Lock size={12} className="text-pine-600 shrink-0" /> Holding & borrowed shrink “Available to spend” on Home. Given-out already left your accounts, so it's tracked but not subtracted twice.
      </p>

      <div className="flex items-end justify-between mt-5 mb-2.5">
        <h2 className="font-display font-bold text-[17px] tracking-tight">Active · {active.length}</h2>
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add</Btn>
      </div>

      {active.length === 0 ? (
        <Card>
          <EmptyState icon={<Lock size={26} />} title="Nothing reserved" desc="When someone gives you money to hold, lends you some — or you hand cash to someone for a purpose — log it here so it never gets mistaken for your own."
            action={<Btn size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>Log reserved money</Btn>} />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {[...active].sort((a, b) => (a.expectedReturnDate ?? "9999").localeCompare(b.expectedReturnDate ?? "9999")).map((f) => {
            const overdue = f.expectedReturnDate ? daysUntil(f.expectedReturnDate) < 0 : false;
            const soon = f.expectedReturnDate ? daysUntil(f.expectedReturnDate) <= 7 && !overdue : false;
            const meta = DIR_META[f.direction];
            const Icon = meta.icon;
            return (
              <Card key={f.id} className={cx("p-4 anim-tick", overdue && "border-flare-500/40")}>
                <div className="flex items-start gap-3">
                  <span className={cx("w-10 h-10 rounded-xl grid place-items-center shrink-0 border", meta.cls)}><Icon size={17} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-[15px] text-ink">{f.personName}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="text-[12px] text-ink/55 mt-1">
                      {fmtINR(f.amount)} · {accounts.find((a) => a.id === f.accountId)?.name ?? "—"} · got {fmtDate(f.dateReceived)}
                    </div>
                    {f.notes && <div className="text-[12px] text-ink/45 italic mt-0.5 truncate">“{f.notes}”</div>}
                    {f.expectedReturnDate && (
                      <div className={cx("inline-flex items-center gap-1.5 mt-1.5 text-[11.5px] font-bold rounded-full px-2.5 py-1 border",
                        overdue ? "bg-flare-100 text-flare-600 border-flare-500/30" : soon ? "bg-mari-100 text-mari-700 border-mari-400/40" : "bg-moss text-ink/55 border-line")}>
                        <CalendarClock size={12} /> {dueLabel(f.expectedReturnDate)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Btn size="xs" variant="outline" icon={<Check size={12} />} onClick={() => setSettling(f)}>
                      {f.direction === "given_out" ? "Settle" : f.direction === "holding_for_them" ? "Return" : "Repay"}
                    </Btn>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {settled.length > 0 && (
        <>
          <button onClick={() => setShowSettled(!showSettled)} className="flex items-center gap-1.5 text-[12px] font-semibold text-ink/50 hover:text-ink mt-5 transition-colors">
            {showSettled ? <ChevronLeft size={13} className="-rotate-90" /> : <ChevronRight size={13} className="rotate-90" />}
            Settled · {settled.length}
          </button>
          {showSettled && (
            <div className="mt-2.5 space-y-2 anim-fade">
              {settled.map((f) => (
                <Card key={f.id} className="p-3.5 flex items-center gap-3 opacity-75">
                  <span className="w-9 h-9 rounded-xl grid place-items-center bg-moss border border-line text-ink/40"><Check size={15} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-semibold text-ink/70 truncate">{f.personName} · {DIR_META[f.direction].label}</div>
                    <div className="text-[11.5px] text-ink/45">settled {fmtDate(f.settledAt)}</div>
                  </div>
                  <span className="num font-bold text-ink/60">{fmtINR(f.amount)}</span>
                  <Btn size="xs" variant="ghost" icon={<Undo2 size={12} />} onClick={() => setReopening(f)}>reopen</Btn>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {adding && <FundSheet accounts={accounts} onClose={() => setAdding(false)} />}

      {settling && (
        <SettleSheet
          fund={settling}
          onClose={() => setSettling(null)}
          onSettle={async (opts) => {
            await settleFund(settling.id, opts);
            toast.push(settling.direction === "given_out" ? (opts.gotBack ? "Marked as returned" : "Marked as used") : "Settled — balance updated");
            setSettling(null);
          }}
        />
      )}

      {reopening && (
        <Confirm
          open
          onClose={() => setReopening(null)}
          title="Reopen this fund?"
          desc="The settlement entry will be removed and the fund becomes active again."
          yesLabel="Reopen"
          onYes={async () => { await reopenFund(reopening.id); toast.push("Fund reopened"); }}
        />
      )}
    </div>
  );
}

function FundSheet({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const toast = useToast();
  const [direction, setDirection] = useState<FundDirection>("holding_for_them");
  const [personName, setPersonName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [dateReceived, setDateReceived] = useState(todayISO());
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!personName.trim()) { toast.push("Whose money is this?", "err"); return; }
    if (!amt || amt <= 0) { toast.push("Enter a valid amount", "err"); return; }
    setBusy(true);
    await addReservedFund({
      personName: personName.trim(), direction, amount: amt, accountId,
      dateReceived, expectedReturnDate: expected || null, notes: notes.trim() || undefined,
    });
    toast.push(direction === "given_out" ? "Recorded — the money left as a reserved expense" : "Recorded — kept out of your ratios");
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Log reserved money"
      footer={<Btn className="w-full" size="lg" icon={<Check size={16} />} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save fund"}</Btn>}
    >
      <Field label="Which situation?">
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(DIR_META) as FundDirection[]).map((dir) => {
            const m = DIR_META[dir];
            const Icon = m.icon;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => setDirection(dir)}
                className={cx(
                  "rounded-xl border px-2 py-2.5 text-center transition-all active:scale-[0.97]",
                  direction === dir ? "border-pine-500 bg-pine-50 shadow-sm" : "border-line bg-card hover:border-pine-300"
                )}
              >
                <span className={cx("w-8 h-8 mx-auto rounded-lg grid place-items-center border", m.cls)}><Icon size={15} /></span>
                <span className="block text-[11px] font-bold text-ink/80 mt-1.5 leading-tight">{m.label}</span>
                <span className="block text-[9.5px] text-ink/45 mt-0.5 leading-tight">{m.blurb}</span>
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={direction === "given_out" ? "Given to" : direction === "borrowed_from_them" ? "Borrowed from" : "Holding for"}>
          <TInput value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="e.g. Priya (sister)" autoFocus />
        </Field>
        <Field label="Amount (₹)">
          <TInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={direction === "given_out" ? "From account" : "Into account"}>
          <TSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.filter((a) => !a.archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </TSelect>
        </Field>
        <Field label={direction === "given_out" ? "Given on" : "Received on"}>
          <TInput type="date" value={dateReceived} onChange={(e) => setDateReceived(e.target.value)} />
        </Field>
      </div>
      <Field label="Expected back by" hint="Optional — you'll get due-soon and overdue nudges.">
        <TInput type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
      </Field>
      <Field label="Purpose / note">
        <TArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={direction === "given_out" ? "e.g. kept with him for the Goa trip bookings" : "e.g. wedding gift pool"} />
      </Field>
      <div className={cx("rounded-xl border px-3.5 py-2.5 text-[12px] leading-relaxed", direction === "given_out" ? "border-pine-200 bg-pine-50/70 text-pine-800" : "border-mari-400/40 bg-mari-100/50 text-mari-700")}>
        {direction === "given_out"
          ? "This records a reserved expense (money left the account) — settling it later records the return, and your ratios stay honest."
          : "This records a reserved income — it won't count as real income, so your savings rate stays honest."}
      </div>
    </Sheet>
  );
}

function SettleSheet({ fund, onClose, onSettle }: { fund: ReservedFund; onClose: () => void; onSettle: (o: { date?: string; accountId?: string; gotBack?: boolean }) => Promise<void> }) {
  const [date, setDate] = useState(todayISO());
  const [gotBack, setGotBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const isOut = fund.direction === "given_out";

  return (
    <Sheet
      open
      onClose={onClose}
      title={isOut ? "Settle the given-out fund" : fund.direction === "holding_for_them" ? "Return the money" : "Repay the money"}
      footer={
        <Btn className="w-full" size="lg" icon={<Check size={16} />} disabled={busy} onClick={async () => { setBusy(true); await onSettle({ date, gotBack }); }}>
          {busy ? "Settling…" : isOut ? (gotBack ? "Got it back" : "It was spent — write it off") : fund.direction === "holding_for_them" ? "Returned it" : "Repaid it"}
        </Btn>
      }
    >
      <div className="rounded-xl border border-line bg-moss/60 px-3.5 py-2.5 mb-4 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink/80">{fund.personName}</span>
        <span className="num font-display font-extrabold text-[17px] text-ink">{fmtINR(fund.amount)}</span>
      </div>
      {isOut && (
        <Field label="What happened?">
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => setGotBack(true)} className={cx("rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition-all", gotBack ? "border-pine-500 bg-pine-50 text-pine-800" : "border-line bg-card text-ink/55")}>
              <span className="flex items-center justify-center gap-1.5"><Undo2 size={13} /> Came back to me</span>
            </button>
            <button type="button" onClick={() => setGotBack(false)} className={cx("rounded-xl border px-3 py-2.5 text-[12.5px] font-semibold transition-all", !gotBack ? "border-mari-500 bg-mari-100 text-mari-700" : "border-line bg-card text-ink/55")}>
              <span className="flex items-center justify-center gap-1.5"><Check size={13} /> Spent on its purpose</span>
            </button>
          </div>
          <span className="block text-[11px] text-ink/45 mt-1.5">
            {gotBack ? "Records a reserved income — money returns to your account." : "Releases the amount as a real expense (you can recategorise it in Entries)."}
          </span>
        </Field>
      )}
      <Field label={isOut && !gotBack ? "Spent on" : "Date"}>
        <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/* ================= planned expenses — timeline ================= */

function PlannedTab({ plans, accounts, categories }: { plans: PlannedExpense[]; accounts: Account[]; categories: Category[] }) {
  const toast = useToast();
  const [adding, setAdding] = useState<PlannedExpense | null | "new">(null);
  const [paying, setPaying] = useState<PlannedExpense | null>(null);
  const [deleting, setDeleting] = useState<PlannedExpense | null>(null);

  const pending = plans.filter((p) => p.status === "pending").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const next30 = pending.filter((p) => daysUntil(p.dueDate) <= 30);
  const overdue = pending.filter((p) => daysUntil(p.dueDate) < 0);
  const thisMonth = monthKey(new Date());
  const monthTotal = next30.filter((p) => p.dueDate.startsWith(thisMonth)).reduce((s, p) => s + p.amount, 0);

  const months = useMemo(() => {
    const m = new Map<string, PlannedExpense[]>();
    for (const p of pending) {
      const k = p.dueDate.slice(0, 7);
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [pending]);

  return (
    <div className="anim-fade">
      <div className="hero-weave rounded-2xl px-4 py-3.5 mt-3 text-pine-50 flex items-center gap-4 relative overflow-hidden">
        <div className="relative flex-1">
          <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-pine-200">due in next 30 days</div>
          <div className="font-display font-extrabold text-[24px] num">{fmtINR(next30.reduce((s, p) => s + p.amount, 0))}</div>
        </div>
        <div className="text-right text-[11.5px] text-pine-200 space-y-0.5">
          <div>{monthLabel(thisMonth)}: <b className="num text-pine-50">{fmtINR(monthTotal)}</b></div>
          <div className={cx(overdue.length ? "text-mari-300 font-bold" : "")}>{overdue.length} overdue</div>
        </div>
      </div>

      <div className="flex items-end justify-between mt-5 mb-1">
        <h2 className="font-display font-bold text-[17px] tracking-tight">Upcoming · {pending.length}</h2>
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setAdding("new")}>Plan</Btn>
      </div>

      {pending.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarClock size={26} />} title="Nothing planned" desc="Rent, SIPs, subscriptions, school fees — plan them once and PaisaBook keeps them on the calendar, and out of “available to spend”."
            action={<Btn size="sm" icon={<Plus size={13} />} onClick={() => setAdding("new")}>Plan a bill</Btn>} />
        </Card>
      ) : (
        <div className="relative pl-6 mt-3">
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-line" />
          {months.map(([mk, items]) => (
            <div key={mk} className="mb-4">
              <div className="relative flex items-center gap-2 mb-2">
                <span className="absolute -left-6 w-[19px] h-[19px] rounded-full bg-pine-700 border-4 border-moss" />
                <span className="font-display font-bold text-[13px] uppercase tracking-wider text-ink/60">{monthLabel(mk)}</span>
                <span className="text-[11px] num text-ink/40">· {fmtINR(items.reduce((s, p) => s + p.amount, 0))}</span>
              </div>
              <div className="space-y-2">
                {items.map((p) => {
                  const du = daysUntil(p.dueDate);
                  const over = du < 0;
                  const soon = du >= 0 && du <= 7;
                  const c = categories.find((x) => x.id === p.categoryId);
                  return (
                    <div key={p.id} className={cx("group rounded-2xl border bg-card p-3.5 flex items-center gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all anim-tick", over ? "border-flare-500/45" : soon ? "border-mari-400/50" : "border-line")}>
                      <div className={cx("w-12 shrink-0 text-center rounded-xl border py-1.5", over ? "bg-flare-100 border-flare-500/30 text-flare-600" : soon ? "bg-mari-100 border-mari-400/40 text-mari-700" : "bg-moss border-line text-ink/70")}>
                        <div className="font-display font-extrabold text-[17px] num leading-none">{p.dueDate.slice(8, 10)}</div>
                        <div className="text-[9px] uppercase font-bold tracking-wider mt-0.5">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(p.dueDate + "T00:00:00").getDay()]}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-display font-bold text-[14.5px] text-ink truncate">{p.name}</span>
                          {p.recurrence !== "once" && <Badge tone="gray">{p.recurrence}</Badge>}
                          {c && <Badge tone="pine">{c.name}</Badge>}
                        </div>
                        <div className={cx("text-[11.5px] font-semibold mt-0.5", over ? "text-flare-600" : soon ? "text-mari-600" : "text-ink/45")}>
                          {dueLabel(p.dueDate)} · {fmtINR(p.amount)}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0 items-end">
                        <Btn size="xs" icon={<Check size={12} />} onClick={() => setPaying(p)}>Pay</Btn>
                        <span className="flex gap-2">
                          <button className="text-[10.5px] font-semibold text-ink/40 hover:text-ink transition-colors" onClick={() => setAdding(p)}>edit</button>
                          <button className="text-[10.5px] font-semibold text-ink/30 hover:text-flare-600 transition-colors" onClick={() => setDeleting(p)}>delete</button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && <PlanSheet plan={adding === "new" ? null : adding} categories={categories} onClose={() => setAdding(null)} />}
      {paying && <PaySheet plan={paying} accounts={accounts.filter((a) => !a.archived)} onClose={() => setPaying(null)} onPaid={async (accountId, date) => { await payPlan(paying.id, accountId, date); toast.push(`Paid ${paying.name}${paying.recurrence !== "once" ? " — next one scheduled" : ""}`); setPaying(null); }} />}
      {deleting && (
        <Confirm open onClose={() => setDeleting(null)} danger title={`Delete “${deleting.name}”?`} desc="Only the plan is removed — entries already paid stay in the ledger." yesLabel="Delete"
          onYes={async () => { await deletePlan(deleting.id); toast.push("Plan deleted"); }} />
      )}
    </div>
  );
}

function PlanSheet({ plan, categories, onClose }: { plan: PlannedExpense | null; categories: Category[]; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(plan?.name ?? "");
  const [amount, setAmount] = useState(plan ? `${plan.amount}` : "");
  const [dueDate, setDueDate] = useState(plan?.dueDate ?? todayISO());
  const [recurrence, setRecurrence] = useState<Recurrence>(plan?.recurrence ?? "monthly");
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? "");

  const save = async () => {
    const amt = parseFloat(amount);
    if (!name.trim()) { toast.push("Give it a name", "err"); return; }
    if (!amt || amt <= 0) { toast.push("Enter a valid amount", "err"); return; }
    if (plan) {
      await updatePlan(plan.id, { name: name.trim(), amount: amt, dueDate, recurrence, categoryId: categoryId || null });
      toast.push("Plan updated");
    } else {
      await addPlan({ name: name.trim(), amount: amt, dueDate, recurrence, categoryId: categoryId || null });
      toast.push("Planned");
    }
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={plan ? "Edit plan" : "Plan an expense"}
      footer={<Btn className="w-full" size="lg" icon={<Check size={16} />} onClick={save}>{plan ? "Save changes" : "Add to calendar"}</Btn>}>
      <Field label="What is it?">
        <TInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. House rent" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (₹)">
          <TInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
        </Field>
        <Field label="Due date">
          <TInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Repeats">
        <div className="flex gap-1.5">
          {(["once", "monthly", "yearly"] as Recurrence[]).map((r) => (
            <Chip key={r} active={recurrence === r} onClick={() => setRecurrence(r)}>{r}</Chip>
          ))}
        </div>
      </Field>
      <Field label="Category" hint="Paying it files the entry under this category.">
        <TSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorised</option>
          {categories.filter((c) => c.kind === "expense").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </TSelect>
      </Field>
    </Sheet>
  );
}

function PaySheet({ plan, accounts, onClose, onPaid }: { plan: PlannedExpense; accounts: Account[]; onClose: () => void; onPaid: (accountId: string, date: string) => Promise<void> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title={`Pay “${plan.name}”`}
      footer={<Btn className="w-full" size="lg" icon={<Check size={16} />} disabled={busy || !accountId} onClick={async () => { setBusy(true); await onPaid(accountId, date); }}>
        {busy ? "Recording…" : `Pay ${fmtINR(plan.amount)}`}
      </Btn>}>
      <div className="rounded-xl border border-line bg-moss/60 px-3.5 py-3 mb-4 flex items-center justify-between">
        <span className="text-[13px] text-ink/65">Due {fmtDate(plan.dueDate)} · <b className={cx(daysUntil(plan.dueDate) < 0 ? "text-flare-600" : "text-ink/80")}>{dueLabel(plan.dueDate)}</b></span>
        <span className="num font-display font-extrabold text-[18px] text-ink">{fmtINR(plan.amount)}</span>
      </div>
      <Field label="From account">
        <TSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </TSelect>
      </Field>
      <Field label="Paid on">
        <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {plan.recurrence !== "once" && (
        <p className="text-[12px] text-ink/50 rounded-lg bg-pine-50 border border-pine-200/60 px-3 py-2">
          Because this repeats {plan.recurrence === "monthly" ? "every month" : "every year"}, the next occurrence is scheduled automatically after paying.
        </p>
      )}
    </Sheet>
  );
}

/* ================= goals ================= */

function GoalsTab({ goals, accounts }: { goals: Goal[]; accounts: Account[] }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [funding, setFunding] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  return (
    <div className="anim-fade">
      <div className="flex items-end justify-between mt-4 mb-2.5">
        <h2 className="font-display font-bold text-[17px] tracking-tight">Pots you're building · {goals.length}</h2>
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Goal</Btn>
      </div>
      {goals.length === 0 ? (
        <Card>
          <EmptyState icon={<Target size={26} />} title="No goals yet" desc="Emergency fund, a trip, a new laptop — give the saving a name and a target, then add to it whenever you can."
            action={<Btn size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>Start a goal</Btn>} />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {goals.map((g) => {
            const p = Math.min(1, g.targetAmount > 0 ? g.currentAmount / g.targetAmount : 0);
            const done = p >= 1;
            const days = g.targetDate ? daysUntil(g.targetDate) : null;
            const perMonth = !done && days !== null && days > 0 ? (g.targetAmount - g.currentAmount) / (days / 30) : null;
            return (
              <Card key={g.id} className={cx("p-4 anim-tick", done && "border-pine-400/60 bg-pine-50/40")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display font-bold text-[15px] text-ink flex items-center gap-1.5">{done && <Check size={15} className="text-pine-600" />}{g.name}</div>
                    <div className="text-[11.5px] text-ink/45 mt-0.5">{g.targetDate ? `by ${fmtDate(g.targetDate)}` : "no deadline"}</div>
                  </div>
                  <button onClick={() => setDeleting(g)} className="text-ink/30 hover:text-flare-600 transition-colors" aria-label="delete goal"><Trash2 size={15} /></button>
                </div>
                <div className="flex items-end justify-between mt-3">
                  <span className="font-display font-extrabold text-[20px] num text-ink">{fmtINR(g.currentAmount)}</span>
                  <span className="text-[11.5px] num text-ink/45">of {fmtINR(g.targetAmount)}</span>
                </div>
                <ProgressBar value={g.currentAmount} max={g.targetAmount} className="mt-2 h-2.5" tone={done ? "pine" : p > 0.6 ? "pine" : "mari"} />
                <div className="flex items-center justify-between mt-2">
                  <span className={cx("text-[11.5px] font-bold", done ? "text-pine-600" : "text-ink/50")}>{done ? "funded!" : pct(p, 0)}</span>
                  {!done && perMonth !== null && perMonth > 0 && <span className="text-[11px] num text-ink/45">≈ {fmtINR(Math.ceil(perMonth))}/mo to make it</span>}
                </div>
                <Btn size="sm" variant={done ? "outline" : "solid"} className="w-full mt-3" icon={<Plus size={13} />} onClick={() => setFunding(g)}>
                  {done ? "Add anyway" : "Add to pot"}
                </Btn>
              </Card>
            );
          })}
        </div>
      )}

      {adding && <GoalSheet onClose={() => setAdding(false)} />}
      {funding && <ContributeSheet goal={funding} accounts={accounts.filter((a) => !a.archived)} onClose={() => setFunding(null)} onDone={(amt) => { toast.push(`Added ${fmtINR(amt)} to ${funding.name}`); setFunding(null); }} />}
      {deleting && (
        <Confirm open onClose={() => setDeleting(null)} danger title={`Delete “${deleting.name}”?`} desc="The goal and its contribution history will be removed." yesLabel="Delete"
          onYes={async () => { await deleteGoal(deleting.id); toast.push("Goal deleted"); }} />
      )}
    </div>
  );
}

function GoalSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const save = async () => {
    const t = parseFloat(target);
    if (!name.trim()) { toast.push("Name the pot", "err"); return; }
    if (!t || t <= 0) { toast.push("Enter a valid target", "err"); return; }
    await addGoal({ name: name.trim(), targetAmount: t, targetDate: date || null });
    toast.push("Goal created");
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="New goal" footer={<Btn className="w-full" size="lg" icon={<Target size={16} />} onClick={save}>Create goal</Btn>}>
      <Field label="What are you saving for?">
        <TInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target (₹)">
          <TInput inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))} placeholder="1,00,000" />
        </Field>
        <Field label="By when?" hint="Optional">
          <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

function ContributeSheet({ goal, accounts, onClose, onDone }: { goal: Goal; accounts: Account[]; onClose: () => void; onDone: (amt: number) => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.push("Enter a valid amount", "err"); return; }
    const updated = await contributeToGoal(goal.id, amt, date, note.trim() || undefined);
    if (goal.currentAmount < goal.targetAmount && updated.currentAmount >= goal.targetAmount) pop();
    onDone(amt);
  };
  return (
    <Sheet open onClose={onClose} title={`Add to “${goal.name}”`} footer={<Btn className="w-full" size="lg" icon={<Plus size={16} />} onClick={save}>Add contribution</Btn>}>
      <Field label="Amount (₹)">
        <TInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" autoFocus className="font-display font-bold text-xl num" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From account">
          <TSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </TSelect>
        </Field>
        <Field label="Date">
          <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Note" hint="Optional">
        <TInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. from bonus" />
      </Field>
      <p className="text-[11.5px] text-ink/45">Contribution history is kept on the goal so chain syncs can merge it cleanly.</p>
    </Sheet>
  );
}

/* ================= budgets — rings ================= */

function Ring({ ratio, over }: { ratio: number; over: boolean }) {
  const [masked] = usePrivacy();
  const R = 26;
  const C = 2 * Math.PI * R;
  const p = Math.min(1, ratio);
  const color = over ? "var(--color-flare-500)" : ratio > 0.85 ? "var(--color-mari-500)" : "var(--color-pine-500)";
  return (
    <div className="relative w-[72px] h-[72px] shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--color-line)" strokeWidth="6" opacity="0.6" />
        <circle
          cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p)}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,0.9,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className={cx("font-display font-extrabold text-[13px] num", over ? "text-flare-600" : "text-ink")}>{masked ? "••%" : `${Math.round(ratio * 100)}%`}</span>
      </div>
    </div>
  );
}

function BudgetsTab({ budgets, entries, categories }: { budgets: Budget[]; entries: Entry[]; categories: Category[] }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const now = new Date();
  const [month, setMonth] = useState(monthKey(now));
  const [yy, mm] = month.split("-").map(Number);
  const prevKey = monthKey(new Date(yy, mm - 2, 1));
  const prevSpent = (cid: string) => entries.filter((t) => t.type === "expense" && !t.isReserved && t.categoryId === cid && t.date.startsWith(prevKey)).reduce((s, t) => s + t.amount, 0);

  const lines = useMemo(() => computeBudgetLines(budgets, entries, categories, month, prevSpent), [budgets, entries, categories, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalLimit = lines.reduce((s, l) => s + l.effectiveLimit, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  const overCount = lines.filter((l) => l.over).length;

  return (
    <div className="anim-fade">
      <div className="flex items-center justify-between mt-4 mb-2.5">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(monthKey(new Date(yy, mm - 2, 1)))} aria-label="previous month" className="w-8 h-8 grid place-items-center rounded-lg border border-line bg-card hover:border-pine-300 active:scale-90 transition-all"><ChevronLeft size={15} /></button>
          <h2 className="font-display font-bold text-[17px] tracking-tight min-w-[110px] text-center">{monthLabel(month)}</h2>
          <button onClick={() => setMonth(monthKey(new Date(yy, mm, 1)))} aria-label="next month" className="w-8 h-8 grid place-items-center rounded-lg border border-line bg-card hover:border-pine-300 active:scale-90 transition-all"><ChevronRight size={15} /></button>
        </div>
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Budget</Btn>
      </div>

      {lines.length > 0 && (
        <div className="hero-weave rounded-2xl px-4 py-3.5 text-pine-50 mb-3 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-[0.14em] font-bold text-pine-200">all budgets</div>
            <div className="font-display font-extrabold text-[20px] num">{fmtINR(totalSpent)} <span className="text-[12px] font-semibold text-pine-200/80">of {fmtINR(totalLimit)}</span></div>
          </div>
          <div className="text-right text-[11.5px] text-pine-200">
            <div>{lines.length} envelopes</div>
            <div className={cx(overCount ? "text-mari-300 font-bold" : "")}>{overCount ? `${overCount} over limit` : "all on track"}</div>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <Card>
          <EmptyState icon={<PiggyBank size={26} />} title={`No budgets for ${monthLabel(month)}`} desc="Give each spending category a monthly envelope. Overspending one never touches the others — and you can roll leftovers forward."
            action={<Btn size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>Create a budget</Btn>} />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {lines.map((l) => (
            <Card key={l.budget.id} className={cx("p-4 flex items-center gap-3.5 anim-tick", l.over && "border-flare-500/40")}>
              <Ring ratio={l.ratio} over={l.over} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-bold text-[14.5px] text-ink truncate">{l.category?.name ?? "Uncategorised"}</span>
                  {l.budget.rollover && <Badge tone="sky" icon={<Undo2 size={10} />}>rollover</Badge>}
                  {l.over && <Badge tone="flare">over</Badge>}
                </div>
                <div className="text-[12px] num text-ink/55 mt-0.5">
                  {fmtINR(l.spent)} of {fmtINR(l.effectiveLimit)}
                </div>
                <div className={cx("text-[11.5px] font-bold mt-0.5", l.over ? "text-flare-600" : "text-pine-600")}>
                  {l.over ? `${fmtINR(Math.abs(l.remaining))} over` : `${fmtINR(l.remaining)} left`}
                </div>
              </div>
              <button onClick={() => setDeleting(l.budget)} className="text-ink/30 hover:text-flare-600 transition-colors self-start" aria-label="remove budget"><Trash2 size={15} /></button>
            </Card>
          ))}
        </div>
      )}

      {adding && <BudgetSheet month={month} categories={categories} existing={budgets} onClose={() => setAdding(false)} />}
      {deleting && (
        <Confirm open onClose={() => setDeleting(null)} danger title="Remove this budget?" desc="Spending history stays — only the envelope is removed." yesLabel="Remove"
          onYes={async () => { await deleteBudget(deleting.id); toast.push("Budget removed"); }} />
      )}
    </div>
  );
}

function BudgetSheet({ month, categories, existing, onClose }: { month: string; categories: Category[]; existing: Budget[]; onClose: () => void }) {
  const toast = useToast();
  const [categoryId, setCategoryId] = useState("");
  const [limit, setLimit] = useState("");
  const [rollover, setRollover] = useState(false);
  const used = new Set(existing.filter((b) => b.monthYear === month).map((b) => b.categoryId));
  const save = async () => {
    const l = parseFloat(limit);
    if (!categoryId) { toast.push("Pick a category", "err"); return; }
    if (!l || l <= 0) { toast.push("Enter a valid limit", "err"); return; }
    await addBudget({ categoryId, monthYear: month, limitAmount: l, rollover });
    toast.push(`Budget set for ${monthLabel(month)}`);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Budget · ${monthLabel(month)}`} footer={<Btn className="w-full" size="lg" icon={<PiggyBank size={16} />} onClick={save}>Create envelope</Btn>}>
      <Field label="Category">
        <TSelect value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">—</option>
          {categories.filter((c) => c.kind === "expense").map((c) => (
            <option key={c.id} value={c.id} disabled={used.has(c.id)}>{c.name}{used.has(c.id) ? " (already budgeted)" : ""}</option>
          ))}
        </TSelect>
      </Field>
      <Field label="Monthly limit (₹)">
        <TInput inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} placeholder="5,000" autoFocus />
      </Field>
      <div className="flex items-center justify-between rounded-xl border border-line bg-moss/60 px-3.5 py-3">
        <div className="text-[12.5px] text-ink/70 pr-3"><b className="text-ink/85">Roll unspent forward</b><div className="text-[11px] text-ink/45 mt-0.5">Leftover from the previous month is added to this limit.</div></div>
        <Toggle on={rollover} onChange={setRollover} label="rollover" />
      </div>
    </Sheet>
  );
}

void addDaysISO;
