import {
  forwardRef,
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_STYLE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_STYLE,
  RIDER_STATUS_LABEL,
  RIDER_STATUS_STYLE,
} from "@/lib/format";
import type { OrderStatus, PaymentStatus, RiderStatus } from "@/lib/types";
import Icon, { type IconName } from "./Icon";

// ---- Feedback states --------------------------------------------------------------------------

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-water-600 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Skeleton placeholders hold the page's shape while data loads (less jarring than a lone spinner). */
export function LoadingState({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-500" role="status">
        <Spinner /> {label}
      </div>
    );
  }
  return (
    <div className="animate-fade-in space-y-3" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon = "drop",
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
      <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-b from-water-50 to-water-100 text-water-500 ring-8 ring-water-50/60">
        <Icon name={icon} className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {hint && <p className="max-w-xs text-sm leading-relaxed text-slate-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500 ring-8 ring-red-50/60">
        <Icon name="warning" className="h-7 w-7" />
      </div>
      <p className="max-w-xs text-sm font-medium text-slate-700">{message}</p>
      {onRetry && (
        <button className="btn-secondary btn-sm" onClick={onRetry}>
          <Icon name="refresh" className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const style = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-water-200 bg-water-50 text-water-900",
  }[kind];
  const icon: IconName = { error: "warning", success: "checkCircle", info: "info" }[kind] as IconName;
  return (
    <div
      className={`flex animate-fade-in items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug ${style}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon name={icon} className="mt-px h-[18px] w-[18px] flex-none" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// ---- Badges -----------------------------------------------------------------------------------

const badge =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-black/5";
const dot = <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />;

export function OrderStatusBadge({ status, label }: { status: OrderStatus; label?: string }) {
  return (
    <span className={`${badge} ${ORDER_STATUS_STYLE[status]}`}>
      {dot}
      {label ?? ORDER_STATUS_LABEL[status]}
    </span>
  );
}

export function PaymentStatusBadge({ status, label }: { status: PaymentStatus; label?: string }) {
  return (
    <span className={`${badge} ${PAYMENT_STATUS_STYLE[status]}`}>
      {dot}
      {label ?? PAYMENT_STATUS_LABEL[status]}
    </span>
  );
}

export function RiderStatusBadge({ status }: { status: RiderStatus }) {
  return (
    <span className={`${badge} ${RIDER_STATUS_STYLE[status]}`}>
      {dot}
      {RIDER_STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "red" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
  };
  return <span className={`${badge} ${tones[tone]}`}>{children}</span>;
}

// ---- Identity ---------------------------------------------------------------------------------

const AVATAR_TONES = [
  "from-sky-400 to-blue-600",
  "from-cyan-400 to-teal-600",
  "from-violet-400 to-indigo-600",
  "from-emerald-400 to-green-600",
  "from-amber-400 to-orange-600",
  "from-rose-400 to-pink-600",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";
  const tone = AVATAR_TONES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const dim = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-lg" }[size];
  return (
    <span
      className={`inline-flex flex-none items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-soft ${tone} ${dim}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// ---- Page chrome ------------------------------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-slate-500 hover:text-water-700">
      <Icon name="arrowLeft" className="h-4 w-4" /> {children}
    </Link>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  icon,
  to,
  tone = "water",
  hint,
}: {
  label: string;
  value: number | string;
  icon: IconName;
  to?: string;
  tone?: "water" | "amber" | "red" | "green";
  hint?: string;
}) {
  const tones = {
    water: "bg-water-50 text-water-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    green: "bg-emerald-50 text-emerald-600",
  }[tone];
  const body = (
    <>
      <div className="flex items-start justify-between">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        {to && <Icon name="chevronRight" className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-water-500" />}
      </div>
      <p className="tabular mt-4 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-0.5 text-[13px] font-medium text-slate-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </>
  );
  const cls = "card group block p-4";
  return to ? (
    <Link to={to} className={`${cls} card-hover`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function DefinitionList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:wide:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt>
          <dd className="mt-1 text-sm font-medium text-slate-800">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- Order progress ---------------------------------------------------------------------------

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Placed" },
  { status: "confirmed", label: "Confirmed" },
  { status: "scheduled", label: "Scheduled" },
  { status: "out_for_delivery", label: "On the way" },
  { status: "delivered", label: "Delivered" },
];

/** At-a-glance progress through the happy path; dead ends (cancelled, rejected, failed) get a banner. */
export function StatusStepper({ status }: { status: OrderStatus }) {
  const closed: Partial<Record<OrderStatus, string>> = {
    cancelled: "This order was cancelled.",
    rejected: "This order was rejected.",
    failed: "The delivery failed. Our staff will reschedule or cancel it.",
  };
  if (closed[status]) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
        <Icon name="xCircle" className="h-5 w-5 flex-none" /> {closed[status]}
      </div>
    );
  }
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="flex items-start" aria-label="Order progress">
      {STEPS.map((s, i) => {
        const done = i < current || status === "delivered";
        const active = i === current && status !== "delivered";
        return (
          <li key={s.status} className="relative flex flex-1 flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {i > 0 && (
              <span
                className={`absolute right-1/2 top-[15px] h-0.5 w-full ${i <= current || status === "delivered" ? "bg-water-500" : "bg-slate-200"}`}
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition ${
                done
                  ? "border-water-600 bg-water-600 text-white"
                  : active
                    ? "animate-pulse-ring border-water-600 bg-white text-water-700"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              {done ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={`mt-1.5 text-[11px] font-medium leading-tight ${active ? "text-water-800" : done ? "text-slate-700" : "text-slate-400"}`}>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Form controls ----------------------------------------------------------------------------

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}

export function FieldShell({ label, error, hint, required, children, htmlFor }: FieldShellProps) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600" role="alert">
          <Icon name="warning" className="h-3.5 w-3.5 flex-none" />
          {error}
        </p>
      )}
    </div>
  );
}

type BaseProps = { label: string; error?: string; hint?: string };

export const TextField = forwardRef<HTMLInputElement, BaseProps & InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ label, error, hint, className = "", id, required, ...rest }, ref) {
    const fieldId = id ?? `f-${rest.name ?? label}`;
    return (
      <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
        <input
          ref={ref}
          id={fieldId}
          required={false /* validation is ours, so messages are consistent */}
          aria-invalid={!!error}
          className={`input ${error ? "input-error" : ""} ${className}`}
          {...rest}
        />
      </FieldShell>
    );
  }
);

/** Password input with a show/hide toggle. */
export function PasswordField({
  label,
  error,
  hint,
  id,
  required,
  className = "",
  ...rest
}: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  const fieldId = id ?? `f-${rest.name ?? label}`;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
      <div className="relative">
        <input
          id={fieldId}
          type={shown ? "text" : "password"}
          aria-invalid={!!error}
          className={`input pr-11 ${error ? "input-error" : ""} ${className}`}
          {...rest}
        />
        <button
          type="button"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-slate-600"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
        >
          <Icon name={shown ? "eyeOff" : "eye"} className="h-[18px] w-[18px]" />
        </button>
      </div>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  className = "",
  id,
  required,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const fieldId = id ?? `f-${rest.name ?? label}`;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        rows={3}
        aria-invalid={!!error}
        className={`input ${error ? "input-error" : ""} ${className}`}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  className = "",
  id,
  required,
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const fieldId = id ?? `f-${rest.name ?? label}`;
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} htmlFor={fieldId}>
      <select
        id={fieldId}
        aria-invalid={!!error}
        className={`input ${error ? "input-error" : ""} ${className}`}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

// ---- Modal ------------------------------------------------------------------------------------

/** A bottom sheet on small screens and a centred dialog from `sm` up. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl" }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative flex max-h-[92%] w-full animate-slide-up flex-col rounded-t-3xl bg-white shadow-pop sm:max-h-[88vh] sm:animate-scale-in sm:rounded-2xl ${width}`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 flex-none rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <header className="flex flex-none items-center justify-between gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button className="-mr-2 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600" onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && (
          <footer className="flex flex-none flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:rounded-b-2xl">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

// ---- Pagination -------------------------------------------------------------------------------

export function Pagination({
  page,
  count,
  pageSize,
  onPage,
}: {
  page: number;
  count: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (count <= pageSize) return null;
  return (
    <div className="mt-5 flex items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        Page <span className="font-semibold text-slate-800">{page}</span> of {pages} · {count} total
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <Icon name="chevronLeft" className="h-4 w-4" /> Prev
        </button>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
