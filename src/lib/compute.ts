import type { Account, Budget, Category, Entry, PlannedExpense, ReservedFund } from "../types";
import { daysUntil, monthKey } from "./core";

export const isRealIncome = (t: Entry) => t.type === "income" && !t.isReserved;
export const isRealExpense = (t: Entry) => t.type === "expense" && !t.isReserved;

export function accountBalance(acc: Account, txs: Entry[]): number {
  let bal = acc.openingBalance;
  for (const t of txs) {
    if (t.type === "income") { if (t.accountId === acc.id) bal += t.amount; }
    else if (t.type === "expense") { if (t.accountId === acc.id) bal -= t.amount; }
    else {
      if (t.accountId === acc.id) bal -= t.amount;
      if (t.toAccountId === acc.id) bal += t.amount;
    }
  }
  return Math.round(bal * 100) / 100;
}

export interface Derived {
  balances: Record<string, number>;
  liquidBalance: number;
  creditOutstanding: number;
  /** everything you own (positive balances across ALL accounts, incl. archived) */
  totalAssets: number;
  /** everything you owe (negative credit-card balances) */
  totalLiabilities: number;
  /** assets − liabilities, every account included */
  netWorth: number;
  reservedHolding: number;
  reservedBorrowed: number;
  givenOutTotal: number;
  reservedTotal: number;
  reservedPerAccount: Record<string, number>;
  committedTotal: number;
  available: number;
  monthIncome: number;
  monthExpense: number;
  savingsRate: number;
  expenseRatio: number;
  avgMonthlyExpense: number;
  liquidityRatio: number;
  debtToIncome: number;
  series: Array<{ key: string; label: string; income: number; expense: number; netWorth: number }>;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeDerived(
  accounts: Account[],
  txs: Entry[],
  funds: ReservedFund[],
  plans: PlannedExpense[],
  rates: Record<string, number> = { INR: 1 }
): Derived {
  const rate = (code: string | undefined) => rates[code ?? "INR"] ?? 1;
  // Net worth & liquidity count EVERY account — archived ones are just hidden
  // from pickers, the money in them is still yours. (Previously archived
  // accounts vanished from these totals, which made net worth look wrong.)
  const all = accounts;
  const balances: Record<string, number> = {};
  for (const a of all) balances[a.id] = accountBalance(a, txs);
  // native balance converted to INR for every aggregate
  const balINR = (a: Account) => balances[a.id] * rate(a.currency);

  const liquidBalance = all.filter((a) => a.type !== "credit").reduce((s, a) => s + balINR(a), 0);
  const creditOutstanding = Math.max(0, -all.filter((a) => a.type === "credit").reduce((s, a) => s + balINR(a), 0));
  const totalAssets = all.reduce((s, a) => s + Math.max(0, balINR(a)), 0);
  const totalLiabilities = all.reduce((s, a) => s + Math.max(0, -balINR(a)), 0);

  const activeFunds = funds.filter((f) => f.status === "active");
  const reservedHolding = activeFunds.filter((f) => f.direction === "holding_for_them").reduce((s, f) => s + f.amount, 0);
  const reservedBorrowed = activeFunds.filter((f) => f.direction === "borrowed_from_them").reduce((s, f) => s + f.amount, 0);
  const givenOutTotal = activeFunds.filter((f) => f.direction === "given_out").reduce((s, f) => s + f.amount, 0);
  const reservedTotal = reservedHolding + reservedBorrowed;
  const reservedPerAccount: Record<string, number> = {};
  for (const f of activeFunds) {
    if (f.direction === "given_out") continue;
    reservedPerAccount[f.accountId] = (reservedPerAccount[f.accountId] || 0) + f.amount;
  }

  const committedTotal = plans.filter((p) => p.status === "pending" && daysUntil(p.dueDate) <= 30).reduce((s, p) => s + p.amount, 0);
  const available = r2(Math.max(0, liquidBalance - reservedTotal - committedTotal));

  const now = new Date();
  const thisMonth = monthKey(now);
  const inr = (t: Entry) => t.amount * rate(t.currency);
  const sumMonth = (key: string) => {
    let income = 0, expense = 0;
    for (const t of txs) {
      if (!t.date.startsWith(key)) continue;
      if (isRealIncome(t)) income += inr(t);
      else if (isRealExpense(t)) expense += inr(t);
    }
    return { income, expense };
  };
  const m = sumMonth(thisMonth);

  const expVals: number[] = [];
  const incVals: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const s = sumMonth(monthKey(d));
    expVals.push(s.expense);
    incVals.push(s.income);
  }
  const avgMonthlyExpense = expVals.reduce((s, v) => s + v, 0) / 3;
  const avgIncome = incVals.reduce((s, v) => s + v, 0) / 3;

  const series = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const { income, expense } = sumMonth(key);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const endISO = `${end.getFullYear()}-${`${end.getMonth() + 1}`.padStart(2, "0")}-${`${end.getDate()}`.padStart(2, "0")}`;
    let raw = 0;
    for (const a of all) {
      raw += a.openingBalance * rate(a.currency);
      for (const t of txs) {
        if (t.date > endISO) continue;
        const v = inr(t);
        if (t.type === "income") { if (t.accountId === a.id) raw += v; }
        else if (t.type === "expense") { if (t.accountId === a.id) raw -= v; }
        else { if (t.accountId === a.id) raw -= v; if (t.toAccountId === a.id) raw += v; }
      }
    }
    // net worth = what's in accounts, minus money that isn't yours (held for
    // others / borrowed), plus money that is yours but currently with others
    const nw = raw - reservedHolding - reservedBorrowed + givenOutTotal;
    series.push({ key, label: `${MONTH_NAMES[d.getMonth()]} ${`${d.getFullYear()}`.slice(2)}`, income, expense, netWorth: Math.round(nw) });
  }

  return {
    balances, liquidBalance: r2(liquidBalance), creditOutstanding: r2(creditOutstanding),
    totalAssets: r2(totalAssets), totalLiabilities: r2(totalLiabilities),
    // net worth = assets − card debt − money held for others − money borrowed + money given out (still yours)
    netWorth: r2(totalAssets - totalLiabilities - reservedHolding - reservedBorrowed + givenOutTotal),
    reservedHolding, reservedBorrowed, givenOutTotal, reservedTotal, reservedPerAccount, committedTotal, available,
    monthIncome: m.income, monthExpense: m.expense,
    savingsRate: m.income > 0 ? (m.income - m.expense) / m.income : 0,
    expenseRatio: m.income > 0 ? m.expense / m.income : 0,
    avgMonthlyExpense,
    liquidityRatio: avgMonthlyExpense > 0 ? liquidBalance / avgMonthlyExpense : 0,
    debtToIncome: avgIncome > 0 ? (creditOutstanding + reservedBorrowed) / avgIncome : 0,
    series,
  };
}

export interface BudgetLine {
  budget: Budget;
  category: Category | null;
  spent: number;
  effectiveLimit: number;
  remaining: number;
  ratio: number;
  over: boolean;
}

export function computeBudgetLines(
  budgets: Budget[],
  txs: Entry[],
  categories: Category[],
  month: string,
  prevMonthSpent: (categoryId: string) => number
): BudgetLine[] {
  return budgets
    .filter((b) => b.monthYear === month)
    .map((b) => {
      const spent = txs
        .filter((t) => isRealExpense(t) && t.categoryId === b.categoryId && t.date.startsWith(month))
        .reduce((s, t) => s + t.amount, 0);
      const rolloverCredit = b.rollover ? Math.max(0, (prevMonthSpent(b.categoryId) || 0)) : 0;
      const effectiveLimit = b.limitAmount + rolloverCredit;
      return {
        budget: b,
        category: categories.find((c) => c.id === b.categoryId) ?? null,
        spent,
        effectiveLimit,
        remaining: effectiveLimit - spent,
        ratio: effectiveLimit > 0 ? spent / effectiveLimit : 0,
        over: spent > effectiveLimit,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
