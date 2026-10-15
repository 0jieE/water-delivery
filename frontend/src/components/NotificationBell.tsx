import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage } from "@/lib/api";
import { getRole } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/lib/queries";
import { orderPath } from "@/lib/routes";
import type { AppNotification } from "@/lib/types";
import Icon from "./Icon";
import { useToast } from "./Toast";
import { ErrorState, LoadingState, Spinner } from "./ui";

/** `sheet`: always open as a full-width sheet under the header (phone layout) instead of a dropdown. */
export default function NotificationBell({ sheet = false }: { sheet?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  const unread = useUnreadCount();
  const list = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = unread.data ?? 0;

  // Unread count in the browser tab title, so it shows even when the tab is in the background.
  useEffect(() => {
    document.title = count > 0 ? `(${count}) Deep Water Refilling Station` : "Deep Water Refilling Station";
    return () => {
      document.title = "Deep Water Refilling Station";
    };
  }, [count]);

  function openNotification(n: AppNotification) {
    if (!n.is_read) markRead.mutate(n.id, { onError: (e) => toast.error(errorMessage(e)) });
    setOpen(false);
    if (n.order) navigate(orderPath(getRole(), n.order));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className={`relative flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-slate-100 ${
          open ? "bg-slate-100 text-water-700" : "text-slate-600"
        }`}
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
      >
        <Icon name="bell" className="h-[22px] w-[22px]" strokeWidth={1.7} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`fixed inset-x-2 top-16 z-40 max-h-[70vh] animate-scale-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop ${
            sheet ? "" : "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold">Notifications</h2>
            <button
              className="rounded-lg px-2 py-1 text-xs font-semibold text-water-700 hover:bg-water-50 disabled:text-slate-300 disabled:hover:bg-transparent"
              disabled={count === 0 || markAll.isPending}
              onClick={() => markAll.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}
            >
              {markAll.isPending ? <Spinner className="inline h-3 w-3" /> : "Mark all read"}
            </button>
          </div>
          <div className="max-h-[58vh] overflow-y-auto">
            {list.isPending ? (
              <LoadingState compact />
            ) : list.isError ? (
              <ErrorState message="Could not load notifications." onRetry={() => list.refetch()} />
            ) : list.data.results.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Icon name="check" className="h-6 w-6" />
                </span>
                <p className="text-sm font-medium text-slate-600">You're all caught up</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {list.data.results.map((n) => (
                  <li key={n.id}>
                    <button
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${n.is_read ? "" : "bg-water-50/60"}`}
                      onClick={() => openNotification(n)}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-none rounded-full ${n.is_read ? "bg-transparent" : "bg-water-500"}`}
                        aria-label={n.is_read ? undefined : "Unread"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-sm ${n.is_read ? "text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                          <span className="flex-none text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                        </span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{n.message}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
