import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, DollarSign, PieChart as PieIcon } from "lucide-react";
import { db, getRates } from "../db";
import { generateInsights, predictSpending, isRealExpense, isRealIncome } from "../lib/compute";
import { fmtINR, fmtDate, monthLabel, monthKey } from "../lib/core";
import { Card, Badge, Reveal, SectionTitle } from "../components/ui";

export default function Insights() {
  const data = useLiveQuery(async () => {
    const [entries, accounts, categories, budgets, rates] = await Promise.all([
      db.entries.toArray(),
      db.accounts.toArray(),
      db.categories.toArray(),
      db.budgets.toArray(),
      getRates(),
    ]);
    return { entries, accounts, categories, budgets, rates };
  }, []);

  const insights = useMemo(() => {
    if (!data) return [];
    return generateInsights(data.entries, data.categories, data.rates);
  }, [data]);

  const predictions = useMemo(() => {
    if (!data) return [];
    return predictSpending(data.entries, data.categories, data.rates);
  }, [data]);

  const categoryData = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const month = monthKey(now);
    const spending: Record<string, number> = {};
    
    for (const t of data.entries.filter(e => isRealExpense(e) && e.date.startsWith(month))) {
      const catId = t.categoryId || "uncategorized";
      spending[catId] = (spending[catId] || 0) + t.amount;
    }
    
    return Object.entries(spending)
      .map(([id, amount]) => ({
        name: data.categories.find(c => c.id === id)?.name || "Uncategorized",
        value: Math.round(amount),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [data]);

  const monthlyTrend = useMemo(() => {
    if (!data) return [];
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
      months.push(monthKey(d));
    }
    
    return months.map(key => {
      const income = data.entries
        .filter(t => isRealIncome(t) && t.date.startsWith(key))
        .reduce((s, t) => s + t.amount, 0);
      const expense = data.entries
        .filter(t => isRealExpense(t) && t.date.startsWith(key))
        .reduce((s, t) => s + t.amount, 0);
      return {
        name: monthLabel(key),
        income: Math.round(income),
        expense: Math.round(expense),
      };
    });
  }, [data]);

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="font-display font-extrabold text-[24px] tracking-tight text-ink">Insights</h1>
        <p className="text-[12.5px] text-ink/50 mt-0.5">AI-powered analysis of your spending patterns</p>
      </div>

      {/* Key Insights */}
      {insights.length > 0 && (
        <Reveal>
          <SectionTitle icon={<AlertTriangle size={17} className="text-pine-600" />}>Key Insights</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {insights.slice(0, 4).map((insight) => (
              <Card key={insight.id} className="p-4 anim-tick">
                <div className="flex items-start gap-3">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
                    insight.tone === "warning" ? "bg-flare-100 text-flare-600" :
                    insight.tone === "positive" ? "bg-pine-100 text-pine-600" :
                    "bg-sky-100 text-sky-600"
                  }`}>
                    {insight.type === "anomaly" ? <AlertTriangle size={16} /> :
                     insight.type === "mom_comparison" ? <TrendingUp size={16} /> :
                     insight.type === "top_category" ? <PieIcon size={16} /> :
                     <CheckCircle size={16} />}
                  </span>
                  <div>
                    <h3 className="font-semibold text-[14px] text-ink">{insight.title}</h3>
                    <p className="text-[12px] text-ink/60 mt-1 leading-relaxed">{insight.description}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Reveal>
      )}

      {/* Spending Predictions */}
      {predictions.length > 0 && (
        <Reveal>
          <SectionTitle icon={<TrendingUp size={17} className="text-pine-600" />}>Next Month Predictions</SectionTitle>
          <Card className="p-4">
            <div className="space-y-3">
              {predictions.slice(0, 5).map((pred) => (
                <div key={pred.categoryId} className="flex items-center justify-between py-2 border-b border-line last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center ${
                      pred.trend === "increasing" ? "bg-flare-100 text-flare-600" :
                      pred.trend === "decreasing" ? "bg-pine-100 text-pine-600" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {pred.trend === "increasing" ? <TrendingUp size={14} /> :
                       pred.trend === "decreasing" ? <TrendingDown size={14} /> :
                       <DollarSign size={14} />}
                    </span>
                    <div>
                      <div className="font-medium text-[13px] text-ink">{pred.categoryName}</div>
                      <div className="text-[10px] text-ink/45">
                        Confidence: {Math.round(pred.confidence * 100)}% • {pred.trend}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display font-bold text-[15px] num text-ink">{fmtINR(pred.predictedAmount)}</div>
                    <div className="text-[10px] text-ink/40">predicted</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Reveal>
      )}

      {/* Category Breakdown */}
      {categoryData.length > 0 && (
        <Reveal>
          <SectionTitle icon={<PieIcon size={17} className="text-pine-600" />}>Top Categories This Month</SectionTitle>
          <Card className="p-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={entry.name} fill={`hsl(${index * 60}, 70%, 50%)`} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => fmtINR(Number(v))}
                    contentStyle={{ background: "var(--color-pine-900)", border: "1px solid var(--color-pine-700)", borderRadius: 8, fontSize: 12, color: "var(--color-pine-50)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Reveal>
      )}

      {/* Income vs Expense Trend */}
      {monthlyTrend.length > 0 && (
        <Reveal>
          <SectionTitle icon={<TrendingUp size={17} className="text-pine-600" />}>Income vs Expense (6 Months)</SectionTitle>
          <Card className="p-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                  <Tooltip
                    formatter={(v) => fmtINR(Number(v))}
                    contentStyle={{ background: "var(--color-pine-900)", border: "1px solid var(--color-pine-700)", borderRadius: 8, fontSize: 12, color: "var(--color-pine-50)" }}
                  />
                  <Bar dataKey="income" fill="#12855a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="#d6455d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </Reveal>
      )}

      {insights.length === 0 && predictions.length === 0 && categoryData.length === 0 && (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-pine-100 text-pine-600 grid place-items-center mb-3">
            <PieIcon size={22} />
          </div>
          <h3 className="font-display font-bold text-[17px] text-ink">No insights yet</h3>
          <p className="text-[12.5px] text-ink/55 mt-1.5 max-w-md mx-auto">
            Add more transactions to see personalized insights, predictions, and spending analysis.
          </p>
        </Card>
      )}
    </div>
  );
}
