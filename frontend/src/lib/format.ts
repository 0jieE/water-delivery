import type { OrderStatus, PaymentMethod, PaymentStatus, RiderStatus } from "./types";

export const POLL_MS = 15_000;

export function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `₱${(Number.isFinite(n) ? n : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" matches the user's wall clock). */
export function toISODate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Parse a YYYY-MM-DD string as a local date (avoids the off-by-one that `new Date(str)` causes). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return parseISODate(iso.slice(0, 10)).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatLongDate(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
  failed: "Failed",
};

export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  pending_verification: "Pending verification",
  paid: "Paid",
  rejected: "Rejected",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: "Cash on delivery",
  gcash: "GCash",
  bank_transfer: "Bank transfer",
};

export const RIDER_STATUS_LABEL: Record<RiderStatus, string> = {
  available: "Available",
  on_delivery: "On delivery",
  off_duty: "Off duty",
};

export const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  confirmed: "bg-sky-100 text-sky-800",
  scheduled: "bg-indigo-100 text-indigo-800",
  out_for_delivery: "bg-water-100 text-water-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
  rejected: "bg-red-100 text-red-800",
  failed: "bg-orange-100 text-orange-800",
};

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  unpaid: "bg-slate-200 text-slate-700",
  pending_verification: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

export const RIDER_STATUS_STYLE: Record<RiderStatus, string> = {
  available: "bg-emerald-100 text-emerald-800",
  on_delivery: "bg-water-100 text-water-800",
  off_duty: "bg-slate-200 text-slate-700",
};
