import Dexie, { type Table } from "dexie";
import type {
  Account, Budget, Category, Entry, Goal, KeywordRule, PlannedExpense, ReservedFund, SnapshotData, TransactionTemplate,
} from "./types";
import { addDaysISO, DEFAULT_RATES, monthKey, toISO, todayISO, uid } from "./lib/core";

interface KVRow { key: string; value: unknown }

class PaisaBook extends Dexie {
  accounts!: Table<Account, string>;
  entries!: Table<Entry, string>;
  categories!: Table<Category, string>;
  rules!: Table<KeywordRule, string>;
  reservedFunds!: Table<ReservedFund, string>;
  plannedExpenses!: Table<PlannedExpense, string>;
  goals!: Table<Goal, string>;
  budgets!: Table<Budget, string>;
  templates!: Table<TransactionTemplate, string>;
  kv!: Table<KVRow, string>;

  constructor() {
    super("paisabook");
    this.version(1).stores({
      accounts: "id, name, archived",
      entries: "id, accountId, date, type, categoryId, sourceRef, reservedFundId",
      categories: "id, kind",
      reservedFunds: "id, status, direction",
      plannedExpenses: "id, status, dueDate",
      goals: "id",
      budgets: "id, categoryId, monthYear",
      kv: "key",
    });
    this.version(2).stores({
      accounts: "id, name, archived",
      entries: "id, accountId, date, type, categoryId, sourceRef, reservedFundId",
      categories: "id, kind",
      reservedFunds: "id, status, direction",
      plannedExpenses: "id, status, dueDate",
      goals: "id",
      budgets: "id, categoryId, monthYear",
      kv: "key",
      syncMeta: "key",
      syncLog: "id, ts",
      yjsLog: "++seq, ts",
    });
    this.version(3).stores({
      accounts: "id, name, archived",
      entries: "id, accountId, date, type, categoryId, sourceRef, reservedFundId",
      categories: "id, kind",
      rules: "id, categoryId",
      reservedFunds: "id, status, direction",
      plannedExpenses: "id, status, dueDate",
      goals: "id",
      budgets: "id, categoryId, monthYear",
      kv: "key",
      syncMeta: "key",
      syncLog: "id, ts",
      yjsLog: "++seq, ts",
    });
    // v4: serverless sync removed — drops the sync stores so leftover
    // pairing state / op logs / identity keys are deleted on upgrade
    this.version(4).stores({
      accounts: "id, name, archived",
      entries: "id, accountId, date, type, categoryId, sourceRef, reservedFundId",
      categories: "id, kind",
      rules: "id, categoryId",
      reservedFunds: "id, status, direction",
      plannedExpenses: "id, status, dueDate",
      goals: "id",
      budgets: "id, categoryId, monthYear",
      kv: "key",
      syncMeta: null,
      syncLog: null,
      yjsLog: null,
    });
    // v5: Add transaction templates table for recurring transactions
    this.version(5).stores({
      accounts: "id, name, archived",
      entries: "id, accountId, date, type, categoryId, sourceRef, reservedFundId, templateId",
      categories: "id, kind",
      rules: "id, categoryId",
      reservedFunds: "id, status, direction",
      plannedExpenses: "id, status, dueDate",
      goals: "id",
      budgets: "id, categoryId, monthYear",
      templates: "id, enabled, recurrence, categoryId",
      kv: "key",
    });
  }
}

export const db = new PaisaBook();

/* ---------------- kv ---------------- */

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row?.value as T | undefined;
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
export async function kvDel(key: string): Promise<void> {
  await db.kv.delete(key);
}

/* ---------------- snapshot / restore / merge ---------------- */

export async function snapshotAll(): Promise<SnapshotData> {
  const [accounts, entries, categories, rules, reservedFunds, plannedExpenses, goals, budgets, templates] = await Promise.all([
    db.accounts.toArray(), db.entries.toArray(), db.categories.toArray(), db.rules.toArray(), db.reservedFunds.toArray(),
    db.plannedExpenses.toArray(), db.goals.toArray(), db.budgets.toArray(), db.templates.toArray(),
  ]);
  return { accounts, entries, categories, rules, reservedFunds, plannedExpenses, goals, budgets, templates };
}

export async function restoreAll(d: SnapshotData): Promise<void> {
  await db.transaction("rw", [db.accounts, db.entries, db.categories, db.rules, db.reservedFunds, db.plannedExpenses, db.goals, db.budgets, db.templates], async () => {
    await Promise.all([
      db.accounts.clear(), db.entries.clear(), db.categories.clear(), db.rules.clear(), db.reservedFunds.clear(),
      db.plannedExpenses.clear(), db.goals.clear(), db.budgets.clear(), db.templates.clear(),
    ]);
    await db.accounts.bulkPut(d.accounts ?? []);
    await db.entries.bulkPut(d.entries ?? []);
    await db.categories.bulkPut(d.categories ?? []);
    await db.rules.bulkPut(d.rules ?? []);
    await db.reservedFunds.bulkPut(d.reservedFunds ?? []);
    await db.plannedExpenses.bulkPut(d.plannedExpenses ?? []);
    await db.goals.bulkPut(d.goals ?? []);
    await db.budgets.bulkPut(d.budgets ?? []);
    await db.templates.bulkPut(d.templates ?? []);
  });
}

/* ---------------- entry CRUD (balance engine) ---------------- */

export async function addEntry(e: Omit<Entry, "id" | "createdAt" | "updatedAt">): Promise<Entry> {
  const now = new Date().toISOString();
  const row: Entry = { ...e, id: uid(), createdAt: now, updatedAt: now };
  await db.entries.add(row);
  return row;
}
export async function updateEntry(id: string, patch: Partial<Entry>): Promise<void> {
  await db.entries.update(id, { ...patch, updatedAt: new Date().toISOString() });
}
export async function deleteEntry(id: string): Promise<void> {
  await db.entries.delete(id);
}

export async function addAccount(a: Omit<Account, "id" | "createdAt">): Promise<Account> {
  const row: Account = { ...a, id: uid(), createdAt: new Date().toISOString() };
  await db.accounts.add(row);
  return row;
}
export async function updateAccount(id: string, patch: Partial<Account>): Promise<void> {
  await db.accounts.update(id, patch);
}
export async function deleteAccount(id: string): Promise<boolean> {
  const n = await db.entries.where("accountId").equals(id).count();
  if (n > 0) return false;
  await db.accounts.delete(id);
  return true;
}

/* ---------------- reserved funds ---------------- */

export async function addReservedFund(f: Omit<ReservedFund, "id" | "createdAt" | "updatedAt" | "status" | "settledAt">): Promise<ReservedFund> {
  const now = new Date().toISOString();
  const row: ReservedFund = { ...f, id: uid(), status: "active", createdAt: now, updatedAt: now, settledAt: null };
  await db.reservedFunds.add(row);
  const isOut = f.direction === "given_out";
  await addEntry({
    accountId: f.accountId, amount: f.amount, type: isOut ? "expense" : "income",
    categoryId: null, date: f.dateReceived, isReserved: true, reservedFundId: row.id, tags: [isOut ? "reserved-out" : "reserved-in"],
    note: isOut ? `Given to ${f.personName}${f.notes ? ` — ${f.notes}` : ""}` : `Received from ${f.personName}${f.notes ? ` — ${f.notes}` : ""}`,
    sourceRef: null,
  });
  return row;
}

export async function settleFund(id: string, opts: { returnedTo?: string; date?: string; accountId?: string; gotBack?: boolean }): Promise<void> {
  const f = await db.reservedFunds.get(id);
  if (!f) return;
  const date = opts.date ?? todayISO();
  await db.reservedFunds.update(id, { status: "settled", settledAt: date, updatedAt: new Date().toISOString() });
  const accId = opts.accountId ?? f.accountId;
  if (f.direction === "given_out") {
    if (opts.gotBack) {
      await addEntry({ accountId: accId, amount: f.amount, type: "income", categoryId: null, date, isReserved: true, reservedFundId: id, tags: ["reserved-in"], note: `Got back from ${f.personName}`, sourceRef: null });
    } else {
      // money was spent for its purpose — release it as a real expense (uncategorised)
      await db.entries.where("reservedFundId").equals(id).modify({ isReserved: false });
    }
  } else {
    await addEntry({ accountId: accId, amount: f.amount, type: "expense", categoryId: null, date, isReserved: true, reservedFundId: id, tags: ["reserved-out"], note: `${f.direction === "holding_for_them" ? "Returned to" : "Repaid"} ${f.personName}`, sourceRef: null });
  }
}

export async function reopenFund(id: string): Promise<void> {
  const f = await db.reservedFunds.get(id);
  if (!f) return;
  const linked = await db.entries.where("reservedFundId").equals(id).toArray();
  const settlement = linked.filter((e) => e.date !== f.dateReceived);
  for (const e of settlement) await db.entries.delete(e.id);
  await db.reservedFunds.update(id, { status: "active", settledAt: null, updatedAt: new Date().toISOString() });
}

/* ---------------- plans / goals / budgets ---------------- */

export async function addPlan(p: Omit<PlannedExpense, "id" | "createdAt" | "updatedAt" | "status" | "paidAt">): Promise<void> {
  const now = new Date().toISOString();
  await db.plannedExpenses.add({ ...p, id: uid(), status: "pending", paidAt: null, createdAt: now, updatedAt: now });
}
export async function updatePlan(id: string, patch: Partial<PlannedExpense>): Promise<void> {
  await db.plannedExpenses.update(id, { ...patch, updatedAt: new Date().toISOString() });
}
export async function deletePlan(id: string): Promise<void> {
  await db.plannedExpenses.delete(id);
}
export async function payPlan(id: string, accountId: string, date: string): Promise<void> {
  const p = await db.plannedExpenses.get(id);
  if (!p) return;
  await addEntry({ accountId, amount: p.amount, type: "expense", categoryId: p.categoryId ?? null, date, note: p.name, sourceRef: null, tags: ["planned"] });
  const next = nextOccurrence(p);
  if (next) await addPlan({ ...p, dueDate: next });
  await db.plannedExpenses.update(id, { status: "paid", paidAt: date, updatedAt: new Date().toISOString() });
}
function nextOccurrence(p: PlannedExpense): string | null {
  if (p.recurrence === "monthly") {
    const d = new Date(p.dueDate + "T00:00:00");
    d.setMonth(d.getMonth() + 1);
    return toISO(d);
  }
  if (p.recurrence === "yearly") {
    const d = new Date(p.dueDate + "T00:00:00");
    d.setFullYear(d.getFullYear() + 1);
    return toISO(d);
  }
  return null;
}

export async function addGoal(g: Omit<Goal, "id" | "createdAt" | "updatedAt" | "currentAmount" | "contributions">): Promise<Goal> {
  const now = new Date().toISOString();
  const row: Goal = { ...g, id: uid(), currentAmount: 0, contributions: [], createdAt: now, updatedAt: now };
  await db.goals.add(row);
  return row;
}
export async function contributeToGoal(id: string, amount: number, date: string, note?: string): Promise<Goal> {
  const g = await db.goals.get(id);
  if (!g) throw new Error("Goal missing");
  const contributions = [...g.contributions, { id: uid(), amount, date, note }];
  const currentAmount = Math.round((g.currentAmount + amount) * 100) / 100;
  await db.goals.update(id, { contributions, currentAmount, updatedAt: new Date().toISOString() });
  return { ...g, contributions, currentAmount };
}
export async function deleteGoal(id: string): Promise<void> {
  await db.goals.delete(id);
}

export async function addBudget(b: Omit<Budget, "id">): Promise<void> {
  await db.budgets.add({ ...b, id: uid() });
}
export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id);
}

/* ---------------- seed ---------------- */

const cat = (id: string, name: string, icon: string, kind: "income" | "expense", keywords: string[], parentCategoryId: string | null = null): Category =>
  ({ id, name, icon, kind, keywords, parentCategoryId });

export const SEED_CATEGORIES: Category[] = [
  cat("food", "Food", "food", "expense", []),
  cat("food-delivery", "Food Delivery", "scooter", "expense", ["swiggy", "zomato", "dominos", "domino", "mcdonalds", "kfc", "pizza hut", "burger king"], "food"),
  cat("dining", "Eating Out", "cup", "expense", ["restaurant", "cafe", "coffee day", "barbeque", "haldiram", "bikanervala", "chaat", "dhaba"], "food"),
  cat("groceries", "Groceries", "cart", "expense", ["bigbasket", "dmart", "d mart", "reliance fresh", "blinkit", "zepto", "grocery", "kirana", "vishal mega"], "food"),
  cat("home", "Home & Bills", "home", "expense", []),
  cat("rent", "Rent", "key", "expense", ["rent", "nobroker", "society maintenance"], "home"),
  cat("utilities", "Utilities", "bolt", "expense", ["electricity", "bescom", "mseb", "tatapower", "adani power", "jal board", "water bill", "mahanagar gas", "indraprastha gas"], "home"),
  cat("bills", "Recharge & Bills", "wifi", "expense", ["jio", "airtel", "vodafone", "recharge", "dth", "tata play", "broadband", "act fibernet"], "home"),
  cat("transport", "Transport & Fuel", "car", "expense", ["uber", "ola ", "rapido", "redbus", "irctc", "indian oil", "bharat petroleum", "hp petrol", "shell", "metro card", "fastag", "toll"]),
  cat("health", "Health", "pulse", "expense", ["apollo pharmacy", "pharmacy", "hospital", "clinic", "diagnostic", "dr lal", "netmeds", "1mg", "practo"]),
  cat("shopping", "Shopping", "bag", "expense", ["amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "croma", "reliance digital", "ikea", "decathlon"]),
  cat("entertainment", "Entertainment", "film", "expense", ["netflix", "hotstar", "disney", "spotify", "youtube premium", "prime video", "bookmyshow", "pvr", "inox", "cinema", "sony liv", "zee5"]),
  cat("travel", "Travel", "plane", "expense", ["makemytrip", "goibibo", "cleartrip", "ixigo", "air india", "indigo", "spicejet", "hotel", "oyo", "airbnb"]),
  cat("education", "Education", "book", "expense", ["udemy", "coursera", "unacademy", "byjus", "school fee", "tuition", "college"]),
  cat("fitness", "Fitness", "dumbbell", "expense", ["gym", "cult.fit", "yoga", "fitness first"]),
  cat("gifts", "Gifts & Donations", "gift", "expense", ["gift", "donation", "charity", "ngo", "temple", "zakat"]),
  cat("insurance", "Insurance", "shield", "expense", ["lic ", "lic-", "policybazaar", "insurance premium", "hdfc ergo", "star health", "acko"]),
  cat("invest", "Investments & Savings", "trend", "expense", ["sip", "mutual fund", "groww", "zerodha", "upstox", "nps", "ppf", "etf"]),
  cat("fees", "Bank Charges", "percent", "expense", ["chg", "charge", "annual fee", "penalty"]),
  cat("other-exp", "Other", "dots", "expense", []),
  cat("salary", "Salary", "bank", "income", ["salary", "payroll"]),
  cat("freelance", "Freelance", "briefcase", "income", ["freelance", "upwork", "fiverr", "consulting"]),
  cat("interest", "Interest & Dividends", "trend", "income", ["interest", "int.cr", "dividend"]),
  cat("refund", "Refunds & Cashback", "undo", "income", ["refund", "cashback", "reward"]),
  cat("other-inc", "Other Income", "dots", "income", []),
];

export function categorizeText(text: string, categories: Category[], rules: KeywordRule[] = []): string | null {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  let best: { id: string; len: number } | null = null;
  // user rules first-class, longest match wins across both sources
  for (const r of rules) {
    const p = (r.pattern || "").toLowerCase();
    if (p && t.includes(p) && p.length > (best?.len ?? 0)) best = { id: r.categoryId, len: p.length };
  }
  for (const c of categories) {
    for (const k of c.keywords) {
      const p = k.toLowerCase();
      if (p && t.includes(p) && p.length > (best?.len ?? 0)) best = { id: c.id, len: p.length };
    }
  }
  return best?.id ?? null;
}

export async function addRule(pattern: string, categoryId: string): Promise<void> {
  await db.rules.put({ id: uid(), pattern: pattern.trim(), categoryId });
}
export async function deleteRule(id: string): Promise<void> {
  await db.rules.delete(id);
}

/** Boot-time seed: categories only. Never adds demo money. */
export async function seedCategories(): Promise<void> {
  const n = await db.categories.count();
  if (n === 0) {
    await db.transaction("rw", db.categories, async () => {
      await db.categories.bulkPut(SEED_CATEGORIES);
    });
  }
}

/**
 * Explicit demo dataset — called only from the "Load demo data" button.
 * Always loads (idempotent per call), on top of whatever is there.
 */
export async function loadDemo(): Promise<void> {
  await db.categories.bulkPut(SEED_CATEGORIES);

  const now = new Date();
  const acc = (name: string, type: Account["type"], openingBalance: number): Account =>
    ({ id: uid(), name, type, currency: "INR", openingBalance, createdAt: now.toISOString() });
  const hdfc = acc("HDFC Bank ••4821", "bank", 46200);
  const cash = acc("Cash in hand", "cash", 2350);
  const paytm = acc("Paytm Wallet", "wallet", 1180);
  const sbicc = acc("SBI Credit Card", "credit", -8420);
  await db.accounts.bulkPut([hdfc, cash, paytm, sbicc]);

  let refN = 418256390721;
  const rows: Entry[] = [];
  const tx = (accountId: string, amount: number, type: Entry["type"], date: string, note: string, categoryId: string | null, toAccountId?: string) => {
    rows.push({
      id: uid(), accountId, toAccountId: toAccountId ?? null, amount, type, categoryId, date, note,
      sourceRef: type === "transfer" ? null : `${refN++}`, isReserved: false, reservedFundId: null,
      tags: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  };
  const kw = (s: string) => categorizeText(s, SEED_CATEGORIES);

  for (let back = 3; back >= 0; back--) {
    const base = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const isCur = back === 0;
    const maxDay = isCur ? Math.max(2, now.getDate()) : 28;
    const d = (dd: number) => toISO(new Date(base.getFullYear(), base.getMonth(), Math.min(dd, maxDay)));

    tx(hdfc.id, 52000, "income", d(1), "Salary — TCS Ltd", "salary");
    if (back % 2 === 1) tx(hdfc.id, 8500 + back * 1200, "income", d(17), "Freelance — design project", "freelance");
    tx(hdfc.id, 14000, "expense", d(4), "House rent — Mrs. Sharma", kw("rent"));
    tx(hdfc.id, 5000, "expense", d(6), "SIP — Nifty 50 index fund", kw("sip"));
    tx(hdfc.id, 1250, "expense", d(9), "LIC premium", kw("lic"));
    tx(hdfc.id, 299, "expense", d(3), "Jio recharge 299", kw("jio"));
    tx(hdfc.id, 1180 + (back % 3) * 240, "expense", d(11), "MSEB electricity bill", kw("mseb"));
    tx(hdfc.id, 199, "expense", d(15), "Netflix", kw("netflix"));
    tx(hdfc.id, 119, "expense", d(15), "Spotify", kw("spotify"));

    (["BigBasket order", 1840, "DMart — monthly groceries", 2650, "Zepto — milk & bread", 320, "Reliance Fresh", 940, "BigBasket order", 1310, "Local kirana", 480] as Array<string | number>).forEach((v, i, arr) => {
      if (i % 2 === 1) {
        const name = arr[i - 1] as string;
        const amt = (v as number) + back * 15;
        if (!isCur || 2 + Math.floor(i / 2) * 5 <= maxDay) tx(i % 4 === 3 ? cash.id : hdfc.id, amt, "expense", d(2 + Math.floor(i / 2) * 5), name, kw(name));
      }
    });
    (["Swiggy — dinner", 340, "Zomato — lunch", 280, "Dominos pizza night", 540, "Cafe Coffee Day", 190, "Swiggy — biryani", 420] as Array<string | number>).forEach((v, i, arr) => {
      if (i % 2 === 1) {
        const name = arr[i - 1] as string;
        const amt = (v as number) + ((back + i) % 3) * 30;
        if (!isCur || 1 + Math.floor(i / 2) * 6 <= maxDay) tx(i % 4 === 3 ? sbicc.id : paytm.id, amt, "expense", d(1 + Math.floor(i / 2) * 6), name, kw(name));
      }
    });
    (["Uber — office commute", 210, "uber", "Indian Oil — petrol", 1300, "indian oil", "Amazon — headphones", 1999, "amazon", "Apollo Pharmacy", 486, "apollo pharmacy", "Uber — airport", 640, "uber"] as Array<string | number>).forEach((v, i, arr) => {
      if (i % 3 === 1) {
        const name = arr[i - 1] as string;
        const amt = Math.round((v as number) * (0.9 + ((back + i) % 4) * 0.07));
        if (!isCur || 3 + Math.floor(i / 3) * 6 <= maxDay) tx(i % 6 === 4 ? sbicc.id : hdfc.id, amt, "expense", d(3 + Math.floor(i / 3) * 6), name, kw(arr[i + 1] as string));
      }
    });
    if (!isCur) tx(hdfc.id, 2000, "transfer", d(7), "Wallet top-up", null, paytm.id);
  }

  // reserved funds — all three directions
  const mkFund = (personName: string, direction: ReservedFund["direction"], amount: number, accountId: string, dateReceived: string, expectedReturnDate: string | null, notes: string): ReservedFund => ({
    id: uid(), personName, direction, amount, accountId, dateReceived, expectedReturnDate, status: "active", notes,
    createdAt: now.toISOString(), updatedAt: now.toISOString(), settledAt: null,
  });
  const holding = mkFund("Priya (sister)", "holding_for_them", 8000, hdfc.id, addDaysISO(todayISO(), -12), addDaysISO(todayISO(), 6), "Wedding gift pool — return before her engagement.");
  const borrowed = mkFund("Amit (friend)", "borrowed_from_them", 5000, cash.id, addDaysISO(todayISO(), -40), addDaysISO(todayISO(), 20), "Emergency top-up, repay after bonus.");
  const givenOut = mkFund("Rohit (cousin)", "given_out", 3000, hdfc.id, addDaysISO(todayISO(), -9), addDaysISO(todayISO(), 12), "Kept with him for the Goa trip bookings.");
  await db.reservedFunds.bulkPut([holding, borrowed, givenOut]);

  const reservedTx = (accountId: string, amount: number, type: Entry["type"], date: string, note: string, tag: string, ref: string | null, fundId: string) =>
    rows.push({
      id: uid(), accountId, toAccountId: null, amount, type, categoryId: null, date, note,
      sourceRef: ref, isReserved: true, reservedFundId: fundId, tags: [tag],
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  reservedTx(hdfc.id, 8000, "income", holding.dateReceived, "Received to hold for Priya (sister)", "reserved-in", "801245390712", holding.id);
  reservedTx(cash.id, 5000, "income", borrowed.dateReceived, "Borrowed from Amit (friend)", "reserved-in", null, borrowed.id);
  reservedTx(hdfc.id, 3000, "expense", givenOut.dateReceived, "Given to Rohit (cousin) — Goa trip bookings", "reserved-out", "801245390777", givenOut.id);

  await db.entries.bulkPut(rows);

  // plans
  const nm = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const plan = (name: string, amount: number, dueDate: string, recurrence: PlannedExpense["recurrence"], keyword: string): PlannedExpense => ({
    id: uid(), name, amount, dueDate, recurrence, categoryId: kw(keyword), status: "pending",
    createdAt: now.toISOString(), updatedAt: now.toISOString(), paidAt: null,
  });
  await db.plannedExpenses.bulkPut([
    plan("House rent", 14000, toISO(new Date(nm.getFullYear(), nm.getMonth(), 4)), "monthly", "rent"),
    plan("Netflix", 199, toISO(new Date(nm.getFullYear(), nm.getMonth(), 15)), "monthly", "netflix"),
    plan("SIP — Nifty 50", 5000, toISO(new Date(nm.getFullYear(), nm.getMonth(), 6)), "monthly", "sip"),
    plan("Gym annual fee", 8000, addDaysISO(todayISO(), 45), "yearly", "gym"),
    plan("Electricity bill", 1400, addDaysISO(todayISO(), 5), "monthly", "mseb"),
  ]);

  // goals
  const goal = (name: string, targetAmount: number, targetDate: string, contribs: Array<[number, number, string]>): Goal => ({
    id: uid(), name, targetAmount, targetDate,
    currentAmount: contribs.reduce((s, c) => s + c[0], 0),
    contributions: contribs.map(([amount, ago, note]) => ({ id: uid(), amount, date: addDaysISO(todayISO(), -ago), note })),
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  await db.goals.bulkPut([
    goal("Emergency fund", 100000, toISO(new Date(now.getFullYear() + 1, 2, 1)), [[15000, 90, "From bonus"], [13500, 55, ""], [10000, 20, "Monthly save"]]),
    goal("Goa trip", 25000, addDaysISO(todayISO(), 75), [[5000, 40, ""], [4400, 12, "Cashback added"]]),
  ]);

  // budgets for current month
  const mk = monthKey(now);
  const budget = (keyword: string, limitAmount: number, rollover = false): Budget => ({ id: uid(), categoryId: kw(keyword)!, monthYear: mk, limitAmount, rollover });
  await db.budgets.bulkPut([budget("swiggy", 2500), budget("grocery", 6000, true), budget("uber", 2000), budget("amazon", 3500), budget("mseb", 1600)]);
}

/**
 * True factory reset: every table → zero. Accounts, entries, funds, plans,
 * goals, budgets, demo data, sync identity/pairing and operation logs are
 * all cleared. (Device-local appearance prefs live in localStorage and stay.)
 */
export async function wipeAll(): Promise<void> {
  const tables = [
    db.accounts, db.entries, db.categories, db.rules, db.reservedFunds, db.plannedExpenses,
    db.goals, db.budgets, db.kv,
  ];
  await db.transaction("rw", tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}

/* ---------------- fx rates ---------------- */

export async function getRates(): Promise<Record<string, number>> {
  const stored = await kvGet<Record<string, number>>("fx.rates");
  return { ...DEFAULT_RATES, ...(stored ?? {}) };
}
export async function saveRates(rates: Record<string, number>): Promise<void> {
  await kvSet("fx.rates", rates);
}


