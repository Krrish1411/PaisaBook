/** Quick-add + edit entry sheet with live auto-categorisation. */
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Trash2 } from "lucide-react";
import { addEntry, categorizeText, db, deleteEntry, updateEntry } from "../db";
import type { Entry, TxType } from "../types";
import { curSym, cx, todayISO } from "../lib/core";
import { Btn, Chip, Confirm, Field, Seg, Sheet, TInput, TSelect, useToast } from "./ui";

export default function EntrySheet({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Entry | null }) {
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [accounts, categories, rules] = await Promise.all([db.accounts.toArray(), db.categories.toArray(), db.rules.toArray()]);
    return { accounts: accounts.filter((a) => !a.archived), categories, rules };
  }, []);

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type);
      setAmount(`${editing.amount}`);
      setAccountId(editing.accountId);
      setToAccountId(editing.toAccountId ?? "");
      setCategoryId(editing.categoryId);
      setDate(editing.date);
      setNote(editing.note);
    } else {
      setType("expense");
      setAmount("");
      setCategoryId(null);
      setDate(todayISO());
      setNote("");
      setToAccountId("");
      setAccountId("");
    }
  }, [open, editing]);

  useEffect(() => {
    if (!accountId && data?.accounts.length) setAccountId(data.accounts[0].id);
  }, [data, accountId]);

  const autoCat = useMemo(
    () => (note.trim() && data ? categorizeText(note, data.categories, data.rules) : null),
    [note, data]
  );
  useEffect(() => {
    if (autoCat && !editing) setCategoryId(autoCat);
  }, [autoCat, editing]);

  const cats = useMemo(() => data?.categories.filter((c) => c.kind === (type === "income" ? "income" : "expense")) ?? [], [data, type]);

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.push("Enter a valid amount", "err"); return; }
    if (!accountId) { toast.push("Pick an account", "err"); return; }
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) { toast.push("Pick a different destination account", "err"); return; }
    setBusy(true);
    try {
      if (editing) {
        await updateEntry(editing.id, {
          amount: amt, type, accountId,
          toAccountId: type === "transfer" ? toAccountId : null,
          categoryId: type === "transfer" ? null : categoryId,
          date, note: note.trim(),
        });
        toast.push("Entry updated");
      } else {
        await addEntry({
          accountId, amount: amt, type,
          toAccountId: type === "transfer" ? toAccountId : null,
          categoryId: type === "transfer" ? null : categoryId,
          currency: data?.accounts.find((a) => a.id === accountId)?.currency ?? "INR",
          date, note: note.trim(), sourceRef: null, tags: [],
        });
        toast.push(type === "transfer" ? "Transfer recorded" : type === "income" ? "Income added" : "Expense added");
      }
      onClose();
    } catch {
      toast.push("Could not save — storage unavailable", "err");
    }
    setBusy(false);
  };

  const icon = type === "transfer" ? <ArrowLeftRight size={17} className="text-pine-600" /> : type === "income" ? <ArrowDownLeft size={17} className="text-pine-600" /> : <ArrowUpRight size={17} className="text-pine-600" />;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2">{icon}{editing ? "Edit entry" : "New entry"}</span>}
      footer={
        <div className="flex gap-2.5">
          {editing && <Btn variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmDel(true)}>Delete</Btn>}
          <Btn className="flex-1" size="lg" icon={<Check size={16} />} disabled={busy || !amount} onClick={save}>
            {busy ? "Saving…" : type === "transfer" ? "Record transfer" : type === "income" ? "Add income" : "Add expense"}
          </Btn>
        </div>
      }
    >
      <Seg
        value={type}
        onChange={(t) => { setType(t); setCategoryId(null); }}
        options={[
          { v: "expense" as TxType, label: "Expense", icon: <ArrowUpRight size={13} /> },
          { v: "income" as TxType, label: "Income", icon: <ArrowDownLeft size={13} /> },
          { v: "transfer" as TxType, label: "Transfer", icon: <ArrowLeftRight size={13} /> },
        ]}
        className="w-full grid grid-cols-3 [&>button]:justify-center mb-1"
      />

      <Field label={`Amount (${curSym(data?.accounts.find((a) => a.id === accountId)?.currency)})`}>
        <TInput
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0"
          className="font-display font-extrabold text-[26px] num text-ink"
        />
        <span className="sr-only">amount in account currency</span>
      </Field>

      {type !== "transfer" && (
        <Field
          label="Category"
          hint={autoCat && autoCat !== categoryId ? `Rules suggest: ${data?.categories.find((c) => c.id === autoCat)?.name}` : undefined}
          right={autoCat && autoCat !== categoryId ? (
            <button type="button" className="text-[11.5px] font-semibold text-pine-700" onClick={() => setCategoryId(autoCat)}>apply suggestion</button>
          ) : undefined}
        >
          <div className="flex gap-1.5 flex-wrap">
            {cats.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={type === "transfer" ? "From" : "Account"}>
          <TSelect value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(data?.accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </TSelect>
        </Field>
        {type === "transfer" ? (
          <Field label="To">
            <TSelect value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">—</option>
              {(data?.accounts ?? []).filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </TSelect>
          </Field>
        ) : (
          <Field label="Date">
            <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
      </div>
      {type === "transfer" && (
        <Field label="Date">
          <TInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}

      <Field label={type === "transfer" ? "Note" : "Note — drives auto-category"}>
        <TInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === "expense" ? "e.g. Swiggy dinner" : type === "income" ? "e.g. Salary — TCS" : "e.g. Wallet top-up"} />
      </Field>

      {editing?.isReserved && (
        <div className="flex items-center gap-2 rounded-lg bg-mari-100/70 border border-mari-400/35 px-3 py-2 text-[12.5px] text-mari-700 font-medium">
          Reserved-fund entry — excluded from income/expense ratios.
        </div>
      )}

      <Confirm
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title="Delete entry?"
        desc="This entry will be removed and balances recalculated."
        yesLabel="Delete"
        onYes={async () => { await deleteEntry(editing!.id); toast.push("Entry deleted"); onClose(); }}
      />
    </Sheet>
  );
}

void cx;
