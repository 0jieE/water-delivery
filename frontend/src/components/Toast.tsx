import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  /** Neutral heads-up, e.g. "a new payment needs verification". Stays a little longer. */
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Light haptic feedback on phones that support it (Android). Skipped when the user prefers reduced motion. */
function buzz(kind: Kind) {
  try {
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (kind === "success") navigator.vibrate(12);
    else if (kind === "error") navigator.vibrate([24, 50, 24]);
  } catch {
    /* vibration is a nicety, never a requirement */
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (kind: Kind, message: string) => {
      buzz(kind);
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === "success" ? 3800 : 6500);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m), info: (m) => push("info", m) }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-2xl border border-slate-200/80 bg-white py-3 pl-3.5 pr-2 shadow-lift"
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full ${
                t.kind === "success"
                  ? "bg-emerald-100 text-emerald-600"
                  : t.kind === "info"
                    ? "bg-water-100 text-water-600"
                    : "bg-red-100 text-red-600"
              }`}
            >
              <Icon name={t.kind === "success" ? "check" : t.kind === "info" ? "bell" : "x"} className="h-3.5 w-3.5" strokeWidth={t.kind === "info" ? 2 : 3} />
            </span>
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800">{t.message}</p>
            <button
              className="rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-500"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
