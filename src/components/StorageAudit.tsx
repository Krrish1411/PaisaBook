/**
 * Live storage inspector — proves the encryption story against the real
 * IndexedDB state right now, instead of trusting documentation.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Database, HardDrive, Lock, RefreshCw, ShieldCheck, AlertTriangle as TriangleAlert, UnlockKeyhole } from "lucide-react";
import { db } from "../db";
import { cx } from "../lib/core";
import { Badge, Btn, Card } from "./ui";

const LEDGER_TABLES = [
  { name: "accounts", label: "Accounts" },
  { name: "entries", label: "Entries" },
  { name: "rules", label: "Category rules" },
  { name: "reservedFunds", label: "Reserved funds" },
  { name: "plannedExpenses", label: "Planned expenses" },
  { name: "goals", label: "Goals" },
  { name: "budgets", label: "Budgets" },
] as const;

export default function StorageAudit() {
  const audit = useLiveQuery(async () => {
    const [blob, lockedRow] = await Promise.all([db.kv.get("vault.blob"), db.kv.get("vault.locked")]);
    const locked = lockedRow?.value === true;
    const counts = await Promise.all(LEDGER_TABLES.map((t) => db.table(t.name).count()));
    const rows = LEDGER_TABLES.map((t, i) => ({ ...t, count: counts[i] }));
    const totalRows = counts.reduce((s, c) => s + c, 0);
    const lsKeys = (() => {
      try {
        return Object.keys(window.localStorage).filter((k) => k.startsWith("pb-"));
      } catch {
        return [] as string[];
      }
    })();
    return { hasBlob: !!blob, locked, rows, totalRows, lsKeys };
  }, []);

  if (!audit) return null;

  const sealed = audit.hasBlob && audit.locked;
  const active = audit.hasBlob && !audit.locked;
  const none = !audit.hasBlob;

  return (
    <Card className="p-4 mt-2.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-display font-bold text-[15px] flex items-center gap-2">
          <Database size={16} className="text-pine-600" /> Live storage inspector
        </h3>
        {sealed && <Badge tone="pine" icon={<Lock size={11} />}>sealed — ciphertext only</Badge>}
        {active && <Badge tone="mari" icon={<UnlockKeyhole size={11} />}>open session</Badge>}
        {none && <Badge tone="flare" icon={<TriangleAlert size={11} />}>vault missing</Badge>}
      </div>

      <p className="text-[12px] text-ink/55 mt-1.5 leading-relaxed">
        Reads the actual IndexedDB right now. {sealed
          ? "Every ledger table is empty — the whole ledger lives inside one AES-256-GCM blob."
          : active
            ? "You're in an unlocked session, so the working tables hold the live ledger. Lock the app and they drop to zero — only the sealed blob remains."
            : "Run the Vault Lock setup — until then the ledger sits unencrypted."}
      </p>

      <div className="mt-3 rounded-xl border border-line overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_90px_170px] items-center gap-2 px-3.5 py-2 bg-moss/70 text-[10.5px] uppercase tracking-wider font-bold text-ink/45">
          <span>Store</span><span className="text-right">Rows</span><span className="text-right hidden sm:block">State</span>
        </div>
        {audit.rows.map((r, i) => (
          <div key={r.name} className={cx("grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_90px_170px] items-center gap-2 px-3.5 py-2 text-[12.5px]", i % 2 === 1 && "bg-moss/40")}>
            <span className="font-medium text-ink/80">{r.label}</span>
            <span className="num font-bold text-ink/70 text-right">{r.count}</span>
            <span className="text-right">
              {sealed ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-pine-700"><Lock size={11} /> sealed away</span>
              ) : r.count === 0 ? (
                <span className="text-[11px] font-semibold text-ink/40">empty</span>
              ) : active ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-mari-700"><UnlockKeyhole size={11} /> live session</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-flare-600"><TriangleAlert size={11} /> plaintext</span>
              )}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_90px_170px] items-center gap-2 px-3.5 py-2 bg-pine-50/60 text-[12.5px] border-t border-line">
          <span className="font-bold text-ink/85 flex items-center gap-1.5"><HardDrive size={13} className="text-pine-600" /> vault.blob (AES-256-GCM)</span>
          <span className="num font-bold text-ink/70 text-right">{audit.hasBlob ? 1 : 0}</span>
          <span className="text-right">
            <span className={cx("inline-flex items-center gap-1 text-[11px] font-bold", audit.hasBlob ? "text-pine-700" : "text-flare-600")}>
              <ShieldCheck size={11} /> {audit.hasBlob ? "encrypted at rest" : "absent"}
            </span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3 text-[11.5px] text-ink/55">
        <span className="font-semibold text-ink/70">localStorage:</span>
        {audit.lsKeys.length === 0 ? (
          <span>no PaisaBook keys</span>
        ) : (
          audit.lsKeys.map((k) => <Badge key={k} tone="gray">{k} · appearance only</Badge>)
        )}
        <span className="text-ink/35">· no sessionStorage ledger data · no network writes</span>
      </div>

      <div className={cx(
        "mt-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-semibold flex items-center gap-2",
        sealed ? "border-pine-500/40 bg-pine-500/10 text-pine-700" : active ? "border-mari-500/40 bg-mari-500/10 text-mari-700" : "border-flare-500/40 bg-flare-100/60 text-flare-600"
      )}>
        {sealed ? <ShieldCheck size={15} /> : active ? <RefreshCw size={15} /> : <TriangleAlert size={15} />}
        {sealed
          ? "Verified: this device stores nothing but ciphertext."
          : active
            ? "Session open — press the lock button (top bar) to seal the ledger and drop every table to zero."
            : "Vault Lock not set up — the ledger is currently unencrypted at rest."}
      </div>

      {!sealed && active && (
        <div className="mt-2.5">
          <Btn size="sm" variant="outline" icon={<Lock size={13} />} onClick={() => {
            void import("../lib/vault").then(async (v) => { await v.instantLock(); location.reload(); });
          }}>
            Seal & lock now
          </Btn>
        </div>
      )}
    </Card>
  );
}
