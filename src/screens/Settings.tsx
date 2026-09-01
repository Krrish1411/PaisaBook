import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, CreditCard, Database, Download, KeyRound, Landmark, Lock, Pencil, Plus, ShieldCheck, Trash2, UnlockKeyhole, Upload, Wallet } from "lucide-react";
import { addAccount, db, deleteAccount, loadDemo, restoreAll, snapshotAll, updateAccount, wipeAll } from "../db";
import type { Account, AccountType, SnapshotData } from "../types";
import { cx, downloadText, fmtINR, openWithPassphrase, sealWithPassphrase, todayISO, usePrefs, type EncPayload } from "../lib/core";
import { accountBalance } from "../lib/compute";
import { Badge, Btn, Card, Confirm, EmptyState, Field, SectionTitle, Sheet, TInput, TSelect, ThemePicker, Toggle, useToast } from "../components/ui";
import StorageAudit from "../components/StorageAudit";

const ACC_ICON: Record<string, typeof Landmark> = { bank: Landmark, cash: Banknote, wallet: Wallet, credit: CreditCard };

export default function Settings() {
  const toast = useToast();
  const [prefs, updatePrefs] = usePrefs();
  const data = useLiveQuery(async () => {
    const [accounts, entries] = await Promise.all([db.accounts.toArray(), db.entries.toArray()]);
    return { accounts, entries, txCount: entries.length };
  }, []);

  const [editingAcc, setEditingAcc] = useState<Account | "new" | null>(null);
  const [deletingAcc, setDeletingAcc] = useState<Account | null>(null);
  const [wipe, setWipe] = useState(false);
  const [reseed, setReseed] = useState(false);
  const [backupSheet, setBackupSheet] = useState(false);
  const [restoreEnc, setRestoreEnc] = useState<EncPayload | null>(null);
  const [plainData, setPlainData] = useState<SnapshotData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const accounts = data?.accounts ?? [];
  const balances = data ? Object.fromEntries(accounts.map((a) => [a.id, accountBalance(a, data.entries)])) : {};

  const onBackupFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text()) as Record<string, unknown>;
      if (obj.app === "paisabook" && obj.kind === "encrypted-backup") {
        setRestoreEnc(obj.payload as EncPayload);
        return;
      }
      if (obj.kind === "plain-export" || Array.isArray(obj.accounts)) {
        setPlainData(obj as unknown as SnapshotData);
        return;
      }
      toast.push("Not a PaisaBook backup file", "err");
    } catch {
      toast.push("Could not read that file", "err");
    }
  };

  return (
    <div className="px-4">
      <div className="anim-fade-up">
        <h1 className="font-display font-extrabold text-[24px] tracking-tight">Settings</h1>
        <p className="text-[12.5px] text-ink/50 mt-0.5">Your devices, your accounts, your data — all of it on this device.</p>
      </div>

      {/* ---------- appearance ---------- */}
      <SectionTitle right={<Badge tone="gray">saved on device</Badge>}>Appearance</SectionTitle>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[12.5px] font-semibold text-ink/70 uppercase tracking-wide">Theme</div>
          <Badge tone="gray">4 light · 4 dark</Badge>
        </div>
        <ThemePicker value={prefs.theme} onChange={(t) => void updatePrefs({ theme: t })} />
      </Card>

      {/* ---------- security & storage encryption ---------- */}
      <SecuritySection />

      {/* ---------- accounts ---------- */}
      <SectionTitle right={<Btn size="xs" icon={<Plus size={12} />} onClick={() => setEditingAcc("new")}>Add</Btn>}>Accounts</SectionTitle>
      <Card className="px-4 py-0.5">
        {accounts.length === 0 ? (
          <EmptyState icon={<Landmark size={26} />} title="No accounts" desc="Add your bank account, cash or wallet to start tracking."
            action={<Btn size="sm" icon={<Plus size={13} />} onClick={() => setEditingAcc("new")}>Add account</Btn>} />
        ) : (
          accounts.map((a) => {
            const Icon = ACC_ICON[a.type] ?? Landmark;
            return (
              <div key={a.id} className="ledger-row flex items-center gap-3 py-3 group">
                <span className="w-9 h-9 rounded-xl grid place-items-center bg-pine-50 border border-pine-200/60 text-pine-600 shrink-0"><Icon size={16} /></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cx("font-semibold text-[13.5px] truncate", a.archived ? "text-ink/40 line-through" : "text-ink/90")}>{a.name}</span>
                    <Badge tone="gray">{a.type}</Badge>
                  </div>
                  <div className="text-[11px] text-ink/45">opening {fmtINR(a.openingBalance)}</div>
                </div>
                <span className={cx("num font-bold text-[14px]", a.type === "credit" && (balances[a.id] ?? 0) < 0 ? "text-flare-600" : "text-ink")}>{fmtINR(balances[a.id] ?? 0)}</span>
                <span className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  <button aria-label="edit" onClick={() => setEditingAcc(a)} className="w-8 h-8 grid place-items-center rounded-lg text-ink/45 hover:bg-moss hover:text-ink transition-colors"><Pencil size={14} /></button>
                  <button aria-label="delete" onClick={() => setDeletingAcc(a)} className="w-8 h-8 grid place-items-center rounded-lg text-ink/45 hover:bg-flare-100 hover:text-flare-600 transition-colors"><Trash2 size={14} /></button>
                </span>
              </div>
            );
          })
        )}
      </Card>

      {/* ---------- backup ---------- */}
      <SectionTitle right={<Badge tone="pine" icon={<KeyRound size={11} />}>AES-256 on-device</Badge>}>Backup & move your data</SectionTitle>
      <Card className="p-4 space-y-2.5">
        <p className="text-[12.5px] text-ink/60 leading-relaxed">
          Two ways out of this device: a passphrase-sealed backup file, or the sync chain above for live device-to-device merging.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="outline" size="sm" icon={<Download size={14} />} onClick={() => setBackupSheet(true)}>Encrypted backup</Btn>
          <Btn variant="outline" size="sm" icon={<Download size={14} />} onClick={async () => {
            const snap = await snapshotAll();
            downloadText(`paisabook-data-${todayISO()}.json`, JSON.stringify({ app: "paisabook", kind: "plain-export", v: 1, exportedAt: new Date().toISOString(), ...snap }, null, 2), "application/json");
            toast.push("Plain JSON downloaded — readable, not encrypted");
          }}>Plain JSON</Btn>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { onBackupFile(e.target.files?.[0]); e.target.value = ""; }} />
        <Btn variant="dark" size="sm" icon={<Upload size={14} />} className="w-full" onClick={() => fileRef.current?.click()}>Restore from backup file</Btn>
      </Card>

      {/* ---------- data ---------- */}
      <SectionTitle>Data</SectionTitle>
      <Card className="p-4 space-y-2.5">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-ink/70">Ledger size</span>
          <span className="num font-semibold text-ink/85">{data?.txCount ?? 0} entries · {accounts.length} accounts</span>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Btn variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => setReseed(true)}>Load demo data</Btn>
          <Btn variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setWipe(true)}>Wipe everything</Btn>
        </div>
        <p className="text-[11px] text-ink/40 leading-relaxed">Demo data adds 4 months of realistic entries — handy for exploring. Wipe is final: back up first.</p>
      </Card>

      <p className="text-center text-[11px] text-ink/35 mt-6 mb-2 font-display font-semibold tracking-wide">PaisaBook · your money, your device</p>

      {/* ---------- sheets & confirms ---------- */}
      {editingAcc && <AccountSheet acc={editingAcc === "new" ? null : editingAcc} onClose={() => setEditingAcc(null)} />}
      {backupSheet && <BackupSheet onClose={() => setBackupSheet(false)} />}
      {restoreEnc && <RestoreEncSheet payload={restoreEnc} onClose={() => setRestoreEnc(null)} />}

      <Confirm
        open={!!deletingAcc}
        onClose={() => setDeletingAcc(null)}
        danger
        title={`Delete ${deletingAcc?.name ?? "account"}?`}
        desc="Only accounts with zero entries can be deleted. Otherwise it will be archived."
        yesLabel="Delete"
        onYes={async () => {
          if (!deletingAcc) return;
          const ok = await deleteAccount(deletingAcc.id);
          toast.push(ok ? "Account deleted" : "Account has entries — archived instead", ok ? "ok" : "warn");
          if (!ok) await updateAccount(deletingAcc.id, { archived: true });
        }}
      />
      <Confirm
        open={reseed}
        onClose={() => setReseed(false)}
        title="Load demo data?"
        desc="Adds the demo dataset on top of the current ledger (accounts, entries, funds, goals, budgets). Works even if you already have data."
        yesLabel="Load demo"
        onYes={async () => { await loadDemo(); toast.push("Demo ledger loaded"); }}
      />
      <Confirm
        open={wipe}
        onClose={() => setWipe(false)}
        danger
        title="Wipe everything?"
        desc="Everything goes to zero — accounts, entries, funds, goals, budgets, demo data and the sealed vault itself (you'll set a fresh passphrase on next launch). Nothing is left. This cannot be undone."
        yesLabel="Wipe it all"
        onYes={async () => { await wipeAll(); location.reload(); }}
      />
      <Confirm
        open={!!plainData}
        onClose={() => setPlainData(null)}
        title="Restore plain backup?"
        desc={`This replaces the current ledger with the backup (${plainData?.entries?.length ?? 0} entries, ${plainData?.accounts?.length ?? 0} accounts).`}
        yesLabel="Restore"
        onYes={async () => {
          if (!plainData) return;
          await restoreAll(plainData);
          toast.push("Backup restored");
        }}
      />
    </div>
  );
}

/* ---------------- account sheet ---------------- */

function AccountSheet({ acc, onClose }: { acc: Account | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(acc?.name ?? "");
  const [type, setType] = useState<AccountType>(acc?.type ?? "bank");
  const [opening, setOpening] = useState(acc ? `${acc.openingBalance}` : "0");
  const [archived, setArchived] = useState(!!acc?.archived);

  const save = async () => {
    const o = parseFloat(opening) || 0;
    if (!name.trim()) { toast.push("Name the account", "err"); return; }
    if (acc) {
      await updateAccount(acc.id, { name: name.trim(), type, openingBalance: o, archived });
      toast.push("Account updated");
    } else {
      await addAccount({ name: name.trim(), type, currency: "INR", openingBalance: o });
      toast.push("Account added");
    }
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={acc ? "Edit account" : "New account"}
      footer={<Btn className="w-full" size="lg" onClick={save}>{acc ? "Save changes" : "Add account"}</Btn>}>
      <Field label="Name">
        <TInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC Bank ••4821" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <TSelect value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="wallet">Wallet / UPI</option>
            <option value="credit">Credit card</option>
          </TSelect>
        </Field>
        <Field label="Opening balance (₹)" hint={type === "credit" ? "Negative = outstanding" : undefined}>
          <TInput inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.-]/g, ""))} />
        </Field>
      </div>
      {acc && (
        <div className="flex items-center justify-between rounded-xl border border-line bg-moss/60 px-3.5 py-3">
          <div className="text-[12.5px] text-ink/70 pr-3"><b className="text-ink/85">Archived</b><div className="text-[11px] text-ink/45 mt-0.5">Hidden from pickers; history stays.</div></div>
          <Toggle on={archived} onChange={setArchived} label="archived" />
        </div>
      )}
    </Sheet>
  );
}

/* ---------------- backup / restore ---------------- */

function BackupSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= 6 && p1 === p2;
  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const snap = await snapshotAll();
      const payload = await sealWithPassphrase(snap, p1);
      downloadText(`paisabook-backup-${todayISO()}.paisa.json`, JSON.stringify({ app: "paisabook", kind: "encrypted-backup", v: 1, createdAt: new Date().toISOString(), payload }), "application/json");
      toast.push("Encrypted backup downloaded");
      onClose();
    } catch {
      toast.push("Backup failed", "err");
    }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} title="Encrypted backup"
      footer={<Btn className="w-full" size="lg" icon={<Download size={16} />} disabled={!ok || busy} onClick={go}>{busy ? "Sealing…" : "Download .paisa.json"}</Btn>}>
      <p className="text-[13px] text-ink/65 mb-3 leading-relaxed">The whole ledger is sealed on-device with AES-256-GCM + PBKDF2 (600k rounds). Without this passphrase the file is noise.</p>
      <Field label="Passphrase" hint="At least 6 characters.">
        <TInput type="password" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Passphrase" autoFocus />
      </Field>
      <Field label="Repeat passphrase" right={p1 && p2 ? <span className={cx("text-[11px] font-bold", ok ? "text-pine-600" : "text-flare-600")}>{ok ? "match" : "doesn't match"}</span> : undefined}>
        <TInput type="password" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Again" />
      </Field>
    </Sheet>
  );
}

function RestoreEncSheet({ payload, onClose }: { payload: EncPayload; onClose: () => void }) {
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    setBusy(true);
    try {
      const data = await openWithPassphrase<SnapshotData>(payload, pass);
      await restoreAll(data);
      toast.push("Encrypted backup restored");
      onClose();
    } catch {
      toast.push("Wrong passphrase — backup not restored", "err");
    }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} title="Encrypted backup"
      footer={<Btn className="w-full" size="lg" disabled={!pass || busy} onClick={restore}>{busy ? "Decrypting…" : "Decrypt & restore"}</Btn>}>
      <p className="text-[13px] text-ink/65 mb-3">This backup is sealed with AES-256-GCM. Enter the passphrase it was created with.</p>
      <Field label="Passphrase">
        <TInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" autoFocus />
      </Field>
    </Sheet>
  );
}

/* ---------------- security & storage encryption ---------------- */

function SecuritySection() {
  const toast = useToast();
  const vaultState = useLiveQuery(async () => {
    const blob = await db.kv.get("vault.blob");
    const locked = (await db.kv.get("vault.locked"))?.value === true;
    return { enabled: !!blob, locked };
  }, []);

  const [enabling, setEnabling] = useState(false);
  const [locking, setLocking] = useState(false);
  const [rekey, setRekey] = useState(false);

  const enabled = vaultState?.enabled ?? false;

  return (
    <>
      <SectionTitle right={<Badge tone="pine" icon={<ShieldCheck size={11} />}>audit below</Badge>}>Security & storage encryption</SectionTitle>

      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className={cx("w-10 h-10 rounded-xl grid place-items-center shrink-0 border", enabled ? "bg-pine-50 text-pine-600 border-pine-200" : "bg-moss text-ink/50 border-line")}>
            <Lock size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[15px] text-ink">
              Vault Lock — encrypt the local database
              <Badge tone="mari" icon={<Lock size={10} />} className="ml-2">mandatory</Badge>
            </div>
            <p className="text-[12.5px] text-ink/60 mt-1 leading-relaxed">
              {enabled
                ? "On (required). When locked, IndexedDB holds only ciphertext — AES-256-GCM under your passphrase-derived key. Unlocking decrypts into the working ledger; locking re-seals the current state. The eye button up top also asks for this passphrase."
                : "Setting up now — Vault Lock is mandatory, the app seals your ledger before first use."}
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              {!enabled && <Btn size="sm" icon={<Lock size={13} />} onClick={() => setEnabling(true)}>Enable Vault Lock</Btn>}
              {enabled && (
                <>
                  <Btn size="sm" icon={<Lock size={13} />} onClick={() => setLocking(true)}>Lock now</Btn>
                  <Btn size="sm" variant="outline" icon={<KeyRound size={13} />} onClick={() => setRekey(true)}>Change passphrase</Btn>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      <StorageAudit />

      <Card className="p-4 mt-2.5">
        <h3 className="font-display font-bold text-[14px] flex items-center gap-2"><Database size={15} className="text-pine-600" /> What's encrypted where</h3>
        <ul className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed">
          {[
            { k: "Ledger at rest", v: enabled ? "sealed (ciphertext) whenever locked" : "plaintext working DB — enable Vault Lock to seal it", ok: enabled },
            { k: "Encrypted backups", v: "AES-256-GCM + PBKDF2-600k, sealed on-device", ok: true },
            { k: "Network activity", v: "zero — no sync, no telemetry, no analytics. The app never dials out", ok: true },
            { k: "Plain-JSON export", v: "readable by design (the one labelled plaintext path)", ok: false },
          ].map((r) => (
            <li key={r.k} className="flex items-start gap-2.5">
              <span className={cx("mt-0.5 w-4 h-4 rounded-full grid place-items-center shrink-0", r.ok ? "bg-pine-100 text-pine-700" : "bg-mari-100 text-mari-700")}>
                {r.ok ? <ShieldCheck size={10} /> : <KeyRound size={9} />}
              </span>
              <span><b className="text-ink/85">{r.k}:</b> <span className="text-ink/60">{r.v}</span></span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink/45 mt-2.5">Plain-JSON export is intentionally readable — it's labelled at download time. Everything else stays sealed.</p>
      </Card>

      {enabling && <VaultPassSheet mode="enable" onClose={() => setEnabling(false)} />}
      {locking && <VaultPassSheet mode="lock" onClose={() => setLocking(false)} />}
      {rekey && <RekeySheet onClose={() => setRekey(false)} />}
    </>
  );
}

function RekeySheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = cur.length > 0 && p1.length >= 6 && p1 === p2;

  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const v = await import("../lib/vault");
      const good = await v.verifyVaultPassphrase(cur);
      if (!good) {
        toast.push("Current passphrase is wrong", "err");
        setBusy(false);
        return;
      }
      await v.resealAndLock(p1);
      toast.push("Passphrase changed — ledger re-sealed");
      window.setTimeout(() => location.reload(), 600);
    } catch {
      toast.push("Could not change passphrase", "err");
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change vault passphrase"
      footer={
        <Btn className="w-full" size="lg" icon={<KeyRound size={16} />} disabled={!ok || busy} onClick={go}>
          {busy ? "Re-sealing…" : "Change & re-seal"}
        </Btn>
      }
    >
      <p className="text-[13px] text-ink/65 mb-3 leading-relaxed">The ledger is re-sealed with a fresh salt under the new passphrase. Old sync files stay valid (they use device keys, not the vault passphrase).</p>
      <Field label="Current passphrase">
        <TInput type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current" autoFocus />
      </Field>
      <Field label="New passphrase" hint="At least 6 characters. No recovery — forget it and the sealed ledger is gone.">
        <TInput type="password" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="New" />
      </Field>
      <Field label="Repeat new passphrase" right={p1 && p2 ? <span className={cx("text-[11px] font-bold", p1 === p2 ? "text-pine-600" : "text-flare-600")}>{p1 === p2 ? "match" : "doesn't match"}</span> : undefined}>
        <TInput type="password" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Again" />
      </Field>
    </Sheet>
  );
}

function VaultPassSheet({ mode, onClose }: { mode: "enable" | "lock"; onClose: () => void }) {
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= 6 && p1 === p2;

  const go = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const v = await import("../lib/vault");
      if (mode === "enable") await v.enableVault(p1);
      else await v.resealAndLock(p1);
      toast.push(mode === "enable" ? "Vault enabled — ledger sealed" : "Ledger sealed & locked");
      window.setTimeout(() => location.reload(), 600);
    } catch {
      toast.push("Could not seal the vault", "err");
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === "enable" ? "Enable Vault Lock" : "Lock now"}
      footer={
        <Btn className="w-full" size="lg" icon={<Lock size={16} />} disabled={!ok || busy} onClick={go}>
          {busy ? "Sealing…" : mode === "enable" ? "Seal ledger & lock" : "Re-seal & lock"}
        </Btn>
      }
    >
      <p className="text-[13px] text-ink/65 mb-3 leading-relaxed">
        {mode === "enable"
          ? "The whole ledger is encrypted on-device (AES-256-GCM, PBKDF2-SHA256 @ 600k rounds) and the plaintext tables are wiped. You'll enter this passphrase each time the app opens."
          : "The current ledger state is re-sealed with a fresh salt & nonce, then the plaintext tables are wiped until you unlock."}
      </p>
      <Field label="Passphrase" hint="At least 6 characters. There is NO recovery — forget it and the sealed ledger is gone.">
        <TInput type="password" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Passphrase" autoFocus />
      </Field>
      <Field label="Repeat passphrase" right={p1 && p2 ? <span className={cx("text-[11px] font-bold", ok ? "text-pine-600" : "text-flare-600")}>{ok ? "match" : "doesn't match"}</span> : undefined}>
        <TInput type="password" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Again" />
      </Field>
    </Sheet>
  );
}
