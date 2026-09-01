export type AccountType = "bank" | "cash" | "wallet" | "credit";
export type TxType = "expense" | "income" | "transfer";
export type FundDirection = "holding_for_them" | "borrowed_from_them" | "given_out";
export type Recurrence = "once" | "monthly" | "yearly";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: number;
  archived?: boolean;
  createdAt: string;
}

export interface Entry {
  id: string;
  accountId: string;
  toAccountId?: string | null;
  type: TxType;
  amount: number; // in the account's currency
  currency?: string; // ISO code snapshot at creation (default INR)
  categoryId: string | null;
  date: string; // YYYY-MM-DD
  note: string;
  sourceRef?: string | null;
  isReserved?: boolean;
  reservedFundId?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  kind: "income" | "expense";
  keywords: string[];
  parentCategoryId?: string | null;
}

export interface ReservedFund {
  id: string;
  personName: string;
  direction: FundDirection;
  amount: number;
  accountId: string;
  dateReceived: string;
  expectedReturnDate?: string | null;
  status: "active" | "settled";
  notes?: string;
  createdAt: string;
  updatedAt: string;
  settledAt?: string | null;
}

export interface PlannedExpense {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  recurrence: Recurrence;
  categoryId?: string | null;
  status: "pending" | "paid";
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
}

export interface GoalContribution {
  id: string;
  amount: number;
  date: string;
  note?: string;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate?: string | null;
  currentAmount: number;
  contributions: GoalContribution[];
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  monthYear: string; // YYYY-MM
  limitAmount: number;
  rollover: boolean;
}

/** User-defined keyword → category rule (longest pattern wins). */
export interface KeywordRule {
  id: string;
  pattern: string;
  categoryId: string;
}

export interface SnapshotData {
  accounts: Account[];
  entries: Entry[];
  categories: Category[];
  rules: KeywordRule[];
  reservedFunds: ReservedFund[];
  plannedExpenses: PlannedExpense[];
  goals: Goal[];
  budgets: Budget[];
}


