/**
 * Google Drive cloud sync panel — zero-knowledge.
 * Drive only ever receives the sealed vault blob (AES-256-GCM ciphertext).
 */
import { useEffect, useState } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, Cloud, CloudOff, ExternalLink, KeyRound, RefreshCw, ShieldCheck, Trash2, Wifi, WifiOff,
} from "lucide-react";
import {
  clearCloudVault, disconnectToken, ensureToken, fetchRemote, getCloudState, hasToken, pullCloud, pushCloud,
  saveCloudState, startCloudWatcher, subscribeCloud, type CloudState,
} from "../lib/gdrive";
import { verifyVaultPassphrase } from "../lib/vault";
import { cx } from "../lib/core";
import { Badge, Btn, Card, Confirm, Field, SectionTitle, Sheet, TInput, Toggle, useToast } from "./ui";

export default function CloudSync() {
  const toast = useToast();
  const [, force] = useState(0);
  const [state, setState] = useState<CloudState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [remoteMeta, setRemoteMeta] = useState<{ rev: number; updatedAt: string; device: string } | null>(null);

  useEffect(() => {
    void getCloudState().then(setState);
    return subscribeCloud(() => void getCloudState().then(setState));
  }, []);

  useEffect(() => {
    if (state?.enabled) startCloudWatcher();
  }, [state?.enabled]);

  const refreshRemote = async (s: CloudState) => {
    try {
      await ensureToken(s.clientId);
      const r = await fetchRemote(s.clientId);
      setRemoteMeta(r ? { rev: r.envelope.rev, updatedAt: r.envelope.updatedAt, device: r.envelope.device } : null);
    } catch {
      setRemoteMeta(null);
    }
  };

  useEffect(() => {
    if (state?.enabled && state.clientId && hasToken()) void refreshRemote(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.enabled, state?.rev]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Drive request failed", "err");
    }
    setBusy(null);
  };

  if (!state) return null;
  const connected = state.enabled && !!state.clientId;

  return (
    <>
      <SectionTitle right={connected ? <Badge tone="pine" icon={<ShieldCheck size={11} />}>zero-knowledge</Badge> : <Badge tone="gray">optional</Badge>}>
        Google Drive sync
      </SectionTitle>

      {!connected ? (
        /* ---------- setup ---------- */
        <Card className="p-4 lift anim-fade-up">
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 rounded-xl hero-weave grid place-items-center text-mari-300 shrink-0"><Cloud size={20} /></span>
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-[15.5px] text-ink">Back up & sync through your own Google Drive</div>
              <p className="text-[12.5px] text-ink/60 mt-1 leading-relaxed">
                PaisaBook writes one file — <b>paisabook-vault.paisa.json</b> — into Drive's hidden <b>appDataFolder</b>, using the narrowest scope (<span className="num">drive.appdata</span>).
                The file is the sealed vault blob: AES-256-GCM ciphertext under your vault passphrase. <b>Google sees only ciphertext and a filename.</b> Two devices with the same passphrase sync by pushing/pulling that file.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Btn icon={<KeyRound size={14} />} onClick={() => setSetupOpen(true)}>Connect Google Drive</Btn>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        /* ---------- connected ---------- */
        <Card className="p-4 lift anim-fade-up">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
              hasToken() ? "bg-pine-700 text-pine-50 border-pine-700" : "bg-moss text-ink/60 border-line")}>
              <span className={cx("w-1.5 h-1.5 rounded-full", hasToken() ? "bg-mari-400 blink-dot" : "bg-ink/30")} />
              {hasToken() ? "Drive connected" : "Drive linked · sign in needed"}
            </span>
            {state.auto && <Badge tone="sky" icon={<RefreshCw size={11} />}>auto-sync on</Badge>}
            {remoteMeta && <Badge tone="gray" icon={<Cloud size={11} />}>vault rev {remoteMeta.rev}</Badge>}
          </div>

          <div className="grid sm:grid-cols-3 gap-2 mt-3">
            <div className="rounded-xl border border-line bg-moss/60 px-3.5 py-2.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">Drive file</div>
              <div className="font-display font-bold text-[13px] text-ink mt-0.5 truncate">paisabook-vault.paisa.json</div>
              <div className="text-[10.5px] text-ink/50">appDataFolder · ciphertext only</div>
            </div>
            <div className="rounded-xl border border-line bg-moss/60 px-3.5 py-2.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">On Drive</div>
              <div className="font-display font-bold text-[13px] text-ink mt-0.5 num">
                {remoteMeta ? `rev ${remoteMeta.rev} · ${new Date(remoteMeta.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : "—"}
              </div>
              <div className="text-[10.5px] text-ink/50">{remoteMeta ? `sealed by device ${remoteMeta.device.slice(0, 8)}…` : "nothing pushed yet"}</div>
            </div>
            <div className="rounded-xl border border-line bg-moss/60 px-3.5 py-2.5">
              <div className="text-[10px] uppercase tracking-wider font-bold text-ink/45">This device</div>
              <div className="font-display font-bold text-[13px] text-ink mt-0.5 num">rev {state.rev}</div>
              <div className="text-[10.5px] text-ink/50">{state.lastSyncAt ? `last sync ${new Date(state.lastSyncAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "never synced"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3.5">
            <Btn size="sm" icon={busy === "push" ? <RefreshCw size={13} className="animate-spin" /> : <ArrowUpFromLine size={13} />} disabled={!!busy}
              onClick={() => void run("push", async () => { const rev = await pushCloud(state); toast.push(`Sealed ledger pushed to Drive (rev ${rev})`); })}>
              {busy === "push" ? "Sealing & pushing…" : "Push now"}
            </Btn>
            <Btn size="sm" variant="outline" icon={busy === "pull" ? <RefreshCw size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />} disabled={!!busy}
              onClick={() => void run("pull", async () => {
                const res = await pullCloud(state, null);
                if (res.neededPassphrase && !res.applied) { setAskPass(true); return; }
                toast.push("Drive vault restored");
              })}>
              {busy === "pull" ? "Pulling…" : "Pull & restore"}
            </Btn>
            <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} />} disabled={!!busy} onClick={() => void run("meta", async () => { await refreshRemote(state); toast.push("Drive status refreshed"); })}>
              Refresh
            </Btn>
            <span className="flex-1" />
            <Btn size="sm" variant="danger" icon={<CloudOff size={13} />} onClick={() => setConfirmOff(true)}>Disconnect</Btn>
          </div>

          <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-dashed border-line">
            <div className="pr-3">
              <div className="text-[13px] font-semibold text-ink/85 flex items-center gap-1.5"><Wifi size={13} className="text-pine-600" /> Automatic sync</div>
              <div className="text-[11.5px] text-ink/45 mt-0.5">Pushes a fresh sealed snapshot ~20s after any change, while the app is open and online.</div>
            </div>
            <Toggle on={state.auto} onChange={(v) => void saveCloudState({ auto: v })} label="automatic sync" />
          </div>

          <p className="text-[11px] text-ink/45 mt-3 flex items-start gap-1.5 leading-relaxed">
            <ShieldCheck size={12} className="shrink-0 mt-0.5 text-pine-600" />
            Zero-knowledge: the OAuth token lives in memory for one hour and is never stored; only ciphertext touches Google. A different device restores by entering the same vault passphrase.
          </p>
        </Card>
      )}

      {/* ---------- setup sheet ---------- */}
      <SetupSheet
        open={setupOpen}
        initial={state.clientId}
        onClose={() => setSetupOpen(false)}
        onDone={async (clientId) => {
          await saveCloudState({ enabled: true, clientId, auto: state.auto });
          startCloudWatcher();
          toast.push("Drive connected — push your first sealed backup");
          setSetupOpen(false);
        }}
      />

      {/* ---------- passphrase for cross-device pull ---------- */}
      <PassSheet
        open={askPass}
        onClose={() => setAskPass(false)}
        onDone={async (pass) => {
          const ok = await verifyVaultPassphrase(pass);
          if (!ok) throw new Error("That passphrase doesn't match this device's vault.");
          const res = await pullCloud(state, pass);
          if (!res.applied) throw new Error("Could not open the Drive vault with that passphrase.");
          toast.push("Drive vault decrypted & restored");
          setAskPass(false);
        }}
      />

      <Confirm
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Disconnect Google Drive?"
        desc="Stops syncing and forgets the Client ID on this device. The sealed vault file stays on your Drive — delete it separately if you want it gone."
        yesLabel="Disconnect"
        onYes={async () => {
          disconnectToken();
          await saveCloudState({ enabled: false, clientId: "" });
          toast.push("Drive disconnected");
        }}
      />
      <Confirm
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        danger
        title="Delete the vault file from Drive?"
        desc="Removes paisabook-vault.paisa.json from your Drive appDataFolder on every device that shares it. This cannot be undone."
        yesLabel="Delete from Drive"
        onYes={async () => {
          await clearCloudVault(state.clientId);
          await saveCloudState({ fileId: null, rev: 0, lastSyncAt: null });
          setRemoteMeta(null);
          toast.push("Drive vault deleted");
        }}
      />

      {connected && (
        <div className="mt-2 px-1">
          <button onClick={() => setConfirmWipe(true)} className="text-[11.5px] font-semibold text-flare-600 hover:underline inline-flex items-center gap-1">
            <Trash2 size={12} /> Delete the sealed vault from Drive
          </button>
        </div>
      )}

      <div className="mt-1 px-1 flex items-center gap-1.5 text-[11px] text-ink/40">
        <WifiOff size={12} /> Offline? Everything keeps working locally — sync resumes the next time you push, pull, or auto-sync fires.
      </div>
    </>
  );
}

/* ---------------- setup ---------------- */

function SetupSheet({ open, initial, onClose, onDone }: { open: boolean; initial: string; onClose: () => void; onDone: (clientId: string) => Promise<void> }) {
  const toast = useToast();
  const [clientId, setClientId] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setClientId(initial);
  }, [open, initial]);

  const connect = async () => {
    const id = clientId.trim();
    if (!id || !id.includes(".apps.googleusercontent.com")) {
      toast.push("That doesn't look like an OAuth Client ID", "err");
      return;
    }
    setBusy(true);
    try {
      await ensureToken(id); // proves the ID works before saving anything
      await onDone(id);
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Google sign-in failed", "err");
    }
    setBusy(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Cloud size={17} className="text-pine-600" /> Connect your Google Drive</span>}
      footer={<Btn className="w-full" size="lg" icon={<KeyRound size={16} />} disabled={busy || !clientId.trim()} onClick={() => void connect()}>{busy ? "Waiting for Google…" : "Sign in & connect"}</Btn>}
    >
      <p className="text-[13px] text-ink/65 leading-relaxed mb-3">
        PaisaBook uses <b>your own</b> Google Cloud OAuth client, so no third party (including us) ever holds keys or tokens. One-time setup, ~3 minutes:
      </p>
      <ol className="space-y-2 text-[12.5px] text-ink/70">
        {[
          <>Open <a className="text-pine-700 font-semibold inline-flex items-center gap-1 hover:underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com <ExternalLink size={11} /></a> → pick (or create) a project.</>,
          <><b>APIs & Services → Library</b> → enable <b>Google Drive API</b>.</>,
          <><b>OAuth consent screen</b> → External → add your Google account under <b>Test users</b> (no verification needed for personal use).</>,
          <><b>Credentials → Create credentials → OAuth client ID</b> → type <b>Web application</b>.</>,
          <>Under <b>Authorized JavaScript origins</b> add this app's address: <code className="num text-[11px] bg-moss border border-line rounded px-1.5 py-0.5">{typeof window !== "undefined" ? window.location.origin : "https://your-app-url"}</code></>,
          <>Copy the <b>Client ID</b> (ends in <span className="num">.apps.googleusercontent.com</span>) and paste it below.</>,
        ].map((step, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full bg-pine-700 text-white text-[11px] font-bold grid place-items-center shrink-0 mt-0.5">{i + 1}</span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
      <div className="mt-4">
        <Field label="OAuth Client ID">
          <TInput value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456-abc….apps.googleusercontent.com" className="num text-[12.5px]" />
        </Field>
      </div>
      <p className="text-[11.5px] text-ink/45 leading-relaxed">
        The Client ID is stored on this device only; access tokens are kept in memory for one hour and never persisted. Scope requested: <b>drive.appdata</b> (the app's own hidden folder — nothing else in your Drive is accessible).
      </p>
    </Sheet>
  );
}

/* ---------------- passphrase sheet ---------------- */

function PassSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (pass: string) => Promise<void> }) {
  const toast = useToast();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!pass || busy) return;
    setBusy(true);
    try {
      await onDone(pass);
      setPass("");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Could not restore", "err");
    }
    setBusy(false);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><KeyRound size={17} className="text-pine-600" /> Unlock the Drive vault</span>}
      footer={<Btn className="w-full" size="lg" icon={<ArrowDownToLine size={16} />} disabled={!pass || busy} onClick={() => void go()}>{busy ? "Decrypting…" : "Decrypt & restore"}</Btn>}
    >
      <p className="text-[13px] text-ink/65 leading-relaxed mb-3">
        The vault on Drive was sealed by another device with its vault passphrase. Enter that passphrase to decrypt and restore it here. (If it was this device's passphrase, it would have opened automatically.)
      </p>
      <Field label="Vault passphrase">
        <TInput type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Passphrase" autoFocus />
      </Field>
    </Sheet>
  );
}
