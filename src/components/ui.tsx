import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cx, type ThemeId } from "../lib/core";
import { Check, Info, AlertTriangle as TriangleAlert } from "lucide-react";

/* ---------------- toasts ---------------- */

interface ToastItem { id: number; msg: string; tone: "ok" | "err" | "warn" }
const ToastCtx = createContext<{ push: (msg: string, tone?: ToastItem["tone"]) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(1);
  const push = useCallback((msg: string, tone: ToastItem["tone"] = "ok") => {
    const id = idRef.current++;
    setItems((xs) => [...xs.slice(-2), { id, msg, tone }]);
    window.setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 3400);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className="fixed bottom-24 lg:bottom-6 inset-x-0 z-[80] flex flex-col items-center gap-2 px-4 pointer-events-none">
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              className={cx(
                "anim-pop pointer-events-auto flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold shadow-xl backdrop-blur",
                t.tone === "ok" && "bg-pine-900/95 border-pine-700 text-pine-50",
                t.tone === "err" && "bg-flare-500/95 border-flare-600 text-white",
                t.tone === "warn" && "bg-mari-100/95 border-mari-400 text-mari-700"
              )}
            >
              {t.tone === "ok" ? <Check size={15} /> : t.tone === "err" ? <TriangleAlert size={15} /> : <Info size={15} />}
              {t.msg}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}

/* ---------------- primitives ---------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(8,45,34,0.05),0_10px_30px_-18px_rgba(8,45,34,0.25)]", className)}>{children}</div>;
}

export function Badge({ children, tone = "gray", icon, className }: { children: ReactNode; tone?: "gray" | "pine" | "mari" | "sky" | "ink" | "flare"; icon?: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide",
        tone === "gray" && "bg-moss text-ink/55 border-line",
        tone === "pine" && "bg-pine-50 text-pine-700 border-pine-200/70",
        tone === "mari" && "bg-mari-100 text-mari-700 border-mari-400/40",
        tone === "sky" && "bg-skyx-100 text-skyx-700 border-skyx-600/25",
        tone === "ink" && "bg-ink text-moss border-ink",
        tone === "flare" && "bg-flare-100 text-flare-700 border-flare-500/30",
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

type BtnVariant = "solid" | "outline" | "ghost" | "dark" | "danger";
type BtnSize = "xs" | "sm" | "md" | "lg";

export function Btn({
  children, onClick, disabled, variant = "solid", size = "md", icon, className, type = "button",
}: {
  children?: ReactNode; onClick?: () => void; disabled?: boolean; variant?: BtnVariant; size?: BtnSize; icon?: ReactNode; className?: string; type?: "button" | "submit";
}) {
  const iconSize = size === "xs" ? 12 : size === "lg" ? 17 : 14;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap",
        size === "xs" && "px-2.5 py-1.5 text-[11.5px]",
        size === "sm" && "px-3.5 py-2 text-[12.5px]",
        size === "md" && "px-4 py-2.5 text-[13.5px]",
        size === "lg" && "px-5 py-3 text-[14.5px]",
        variant === "solid" && "bg-pine-700 hover:bg-pine-600 text-white shadow-sm shadow-pine-900/25",
        variant === "outline" && "border border-line bg-card text-pine-700 hover:border-pine-300 hover:bg-pine-50",
        variant === "ghost" && "text-pine-700 hover:bg-pine-50",
        variant === "dark" && "bg-pine-900 hover:bg-pine-800 text-pine-50 shadow-sm",
        variant === "danger" && "border border-flare-500/30 bg-flare-100/60 text-flare-600 hover:bg-flare-100",
        className
      )}
    >
      {icon && <span style={{ display: "inline-flex", width: iconSize, height: iconSize }}>{icon}</span>}
      {children}
    </button>
  );
}

export function ProgressBar({ value, max, tone = "pine", className }: { value: number; max: number; tone?: "pine" | "mari" | "flare" | "sky"; className?: string }) {
  const p = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cx("h-2 w-full rounded-full bg-line/60 overflow-hidden", className)}>
      <div
        className={cx(
          "h-full rounded-full transition-all duration-500",
          tone === "pine" && "bg-pine-500",
          tone === "mari" && "bg-mari-500",
          tone === "flare" && "bg-flare-500",
          tone === "sky" && "bg-skyx-600"
        )}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.06 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{ opacity: on ? 1 : 0, transform: on ? "none" : "translateY(10px)", transition: `opacity 0.45s ease ${delay}ms, transform 0.45s ease ${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2.5 px-1">
      <h2 className="font-display font-bold text-[15px] tracking-tight text-ink">{children}</h2>
      {right}
    </div>
  );
}

/* ---------------- fields ---------------- */

export function Field({ label, hint, right, children }: { label: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[11.5px] font-bold uppercase tracking-wider text-ink/50">{label}</span>
        {right}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink/45 mt-1">{hint}</span>}
    </label>
  );
}

const fieldCls = "w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink/30 outline-none transition-colors focus:border-pine-400 focus:ring-2 focus:ring-pine-400/20";

export function TInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldCls, className)} />;
}

export function TSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(fieldCls, "appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function TArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldCls, "resize-y leading-relaxed", className)} />;
}

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-all active:scale-95",
        active ? "bg-pine-700 border-pine-700 text-white shadow-sm" : "bg-card border-line text-ink/60 hover:border-pine-300 hover:text-ink",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx("relative w-11 shrink-0 rounded-full border transition-colors", on ? "bg-pine-600 border-pine-600" : "bg-line/70 border-line")}
      style={{ height: 26 }}
    >
      <span className={cx("absolute top-[2.5px] w-[21px] h-[21px] rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-[2.5px]")} />
    </button>
  );
}

export function Seg<T extends string>({ value, onChange, options, className }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ v: T; label: string; icon?: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex rounded-xl border border-line bg-moss/70 p-1 gap-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cx(
            "flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-all",
            value === o.v ? "bg-card text-ink shadow-sm border border-line" : "text-ink/50 hover:text-ink"
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- overlays ---------------- */

export function Sheet({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  // portal to <body>: an ancestor's transform/backdrop-filter would otherwise
  // become the containing block and pin this "fixed" overlay mid-page
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-pine-950/55 backdrop-blur-[2px] anim-fade" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative flex w-full flex-col overflow-hidden rounded-3xl border border-line bg-card shadow-2xl anim-pop",
          "max-h-[88dvh] sm:max-h-[85dvh]",
          wide ? "max-w-2xl" : "max-w-lg"
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line/70 px-5 pb-3 pt-4">
          <h3 className="font-display text-[16px] font-bold tracking-tight text-ink">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink/50 transition-colors hover:bg-moss hover:text-ink">✕</button>
        </div>
        {/* min-h-0 is what actually lets this region scroll inside the flex column */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 rounded-b-3xl border-t border-line/70 bg-moss/40 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export function Confirm({ open, onClose, title, desc, yesLabel = "Confirm", danger, onYes }: {
  open: boolean; onClose: () => void; title: string; desc?: string; yesLabel?: string; danger?: boolean; onYes: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 sm:p-5">
      <div className="absolute inset-0 bg-pine-950/55 backdrop-blur-[2px] anim-fade" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" className="relative w-full max-w-sm max-h-[85dvh] overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl anim-pop">
        <div className={cx("w-10 h-10 rounded-xl grid place-items-center mb-3", danger ? "bg-flare-100 text-flare-600" : "bg-pine-100 text-pine-700")}>
          {danger ? <TriangleAlert size={19} /> : <Info size={19} />}
        </div>
        <h3 className="font-display font-bold text-[16px] text-ink">{title}</h3>
        {desc && <p className="text-[13px] text-ink/60 mt-1.5 leading-relaxed">{desc}</p>}
        <div className="flex gap-2.5 mt-5">
          <Btn variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Btn>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onYes();
              setBusy(false);
              onClose();
            }}
            className={cx(
              "flex-1 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-50",
              danger ? "bg-flare-500 hover:bg-flare-600" : "bg-pine-700 hover:bg-pine-600"
            )}
          >
            {busy ? "Working…" : yesLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function EmptyState({ icon, title, desc, action }: { icon: ReactNode; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-10 px-6">
      <div className="w-14 h-14 rounded-2xl bg-pine-100/80 border border-pine-200 grid place-items-center text-pine-600 mb-3.5">
        {icon}
      </div>
      <div className="font-display font-bold text-ink text-[16.5px]">{title}</div>
      <p className="text-[13px] text-ink/55 mt-1 max-w-[320px] leading-relaxed">{desc}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------------- tween ---------------- */

export function useTween(target: number, ms = 550): number {
  const [v, setV] = useState(target);
  const fromRef = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * e;
      setV(val);
      fromRef.current = val;
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

/* ---------------- theme picker ---------------- */

const THEMES: Array<{ id: ThemeId; label: string; sw: [string, string, string]; dark?: boolean }> = [
  { id: "pine", label: "Pine", sw: ["#edf4ee", "#12855a", "#e8940a"] },
  { id: "sand", label: "Sand", sw: ["#f3edde", "#7a8f38", "#c2660f"] },
  { id: "ember", label: "Ember", sw: ["#f2ecdc", "#7d5a2e", "#a44416"] },
  { id: "ocean", label: "Ocean", sw: ["#e7f0f6", "#2a7b9e", "#de7433"] },
  { id: "night", label: "Night", sw: ["#0a0f0c", "#6cba97", "#e8940a"], dark: true },
  { id: "dusk", label: "Dusk", sw: ["#10131c", "#5179c9", "#e39c2b"], dark: true },
  { id: "berry", label: "Berry", sw: ["#170f14", "#cf4b82", "#e79d26"], dark: true },
  { id: "graphite", label: "Graphite", sw: ["#0c0e0d", "#34b377", "#e8940a"], dark: true },
];

export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (t: ThemeId) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {THEMES.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            title={`${t.label} theme`}
            aria-label={`${t.label} theme`}
            aria-pressed={active}
            className={cx(
              "flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2 transition-all active:scale-95",
              active ? "border-pine-500 bg-pine-50 shadow-sm -translate-y-0.5" : "border-line bg-card hover:border-pine-300 hover:-translate-y-0.5"
            )}
          >
            <span className="relative flex w-full h-7 rounded-lg overflow-hidden border border-black/10">
              <span className="flex-1" style={{ background: t.sw[0] }} />
              <span className="flex-1" style={{ background: t.sw[1] }} />
              <span className="flex-1" style={{ background: t.sw[2] }} />
              {active && (
                <span className="absolute inset-0 grid place-items-center bg-black/10">
                  <span className="w-4 h-4 rounded-full bg-card grid place-items-center text-pine-600 shadow"><Check size={10} /></span>
                </span>
              )}
            </span>
            <span className={cx("text-[10.5px] font-bold tracking-wide", active ? "text-pine-700" : "text-ink/60")}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
