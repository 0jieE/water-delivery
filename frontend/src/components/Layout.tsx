import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearSession, useSession } from "@/lib/auth";
import { usePullToRefresh } from "@/lib/pullToRefresh";
import { useDashboard } from "@/lib/queries";
import type { Role } from "@/lib/types";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import PullIndicator from "./PullIndicator";
import { useToast } from "./Toast";
import { Avatar, Modal } from "./ui";
import { Brand, BrandMark, navFor, roleLabel, type NavItem } from "./nav";

/** Group consecutive nav items under their section heading. */
function grouped(items: NavItem[]) {
  const out: { title: string; items: NavItem[] }[] = [];
  for (const it of items) {
    const title = it.group ?? "";
    const last = out[out.length - 1];
    if (last && last.title === title) last.items.push(it);
    else out.push({ title, items: [it] });
  }
  return out;
}

/**
 * Staff and admin layout, built for touch first:
 *  - phone  (< md):  header + bottom tab bar (4 pinned tabs and "More"),
 *  - tablet (md-lg): a slim icon rail on the left,
 *  - desktop (lg+):  the full sidebar.
 */
export default function Layout({ role }: { role: Role }) {
  const session = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const [more, setMore] = useState(false);

  const items = navFor(role);
  const sections = grouped(items);
  const tabs = items.filter((i) => i.tab);
  const rest = items.filter((i) => !i.tab);
  const name = session.user?.full_name || session.user?.username || "";

  // Live counters (polled every 15 s) drive the nav badges and the "new payment" alert.
  const toast = useToast();
  const dash = useDashboard();
  const pendingPayments = dash.data?.pending_payments;
  const prevPayments = useRef<number | null>(null);
  useEffect(() => {
    if (pendingPayments === undefined) return;
    const prev = prevPayments.current;
    prevPayments.current = pendingPayments;
    if (prev !== null && pendingPayments > prev) {
      const n = pendingPayments - prev;
      toast.info(`${n === 1 ? "A new payment is" : `${n} new payments are`} waiting for verification.`);
    }
  }, [pendingPayments, toast]);

  // Pull down from the top to refresh everything on screen (touch screens only).
  const ptr = usePullToRefresh(() => qc.invalidateQueries());

  // Any navigation closes the "More" sheet.
  useEffect(() => setMore(false), [pathname]);

  function logout() {
    clearSession();
    qc.clear();
    navigate("/login", { replace: true });
  }

  const count = (item: NavItem) => (item.badge ? (dash.data?.[item.badge] ?? 0) : 0);
  const moreActive = rest.some((i) => pathname === i.to || pathname.startsWith(i.to + "/"));

  // ---- sidebar (lg) / rail (md) ------------------------------------------------------------------
  const railLink = ({ isActive }: { isActive: boolean }) =>
    `group relative flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-semibold transition
     lg:flex-row lg:gap-3 lg:px-3 lg:text-sm lg:font-medium ${
       isActive ? "bg-water-50 text-water-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:text-slate-600"
     }`;

  const sidebar = (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col border-r border-slate-200/70 bg-white md:flex lg:w-64">
      <div className="flex h-16 flex-none items-center justify-center lg:justify-start lg:px-6">
        <span className="lg:hidden"><BrandMark /></span>
        <span className="hidden lg:block"><Brand /></span>
      </div>
      <nav className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 lg:px-3" aria-label="Main">
        {sections.map((s, si) => (
          <div key={s.title} className="space-y-0.5">
            {s.title && (
              <>
                <p className="hidden px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400 lg:block">{s.title}</p>
                {si > 0 && <div className="mx-3 my-2 border-t border-slate-100 lg:hidden" />}
              </>
            )}
            {s.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={railLink} aria-label={item.label} title={item.label}>
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-water-600" aria-hidden />}
                    <span className="relative">
                      <Icon name={item.icon} className="h-6 w-6 lg:h-5 lg:w-5" strokeWidth={isActive ? 1.9 : 1.6} />
                      {count(item) > 0 && (
                        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white lg:hidden">
                          {count(item)}
                        </span>
                      )}
                    </span>
                    <span className="lg:hidden">{item.short ?? item.label}</span>
                    <span className="hidden lg:inline">{item.label}</span>
                    {count(item) > 0 && (
                      <span className="ml-auto hidden h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-none text-white lg:flex">
                        {count(item)}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-none p-2 lg:p-3">
        <div className="hidden items-center gap-3 rounded-2xl bg-slate-50 p-3 lg:flex">
          <Avatar name={name} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
            <div className="text-xs text-slate-500">{roleLabel[role]}</div>
          </div>
          <button className="rounded-lg p-2 text-slate-400 transition hover:bg-white hover:text-red-600" onClick={logout} aria-label="Log out" title="Log out">
            <Icon name="logout" className="h-5 w-5" />
          </button>
        </div>
        <button
          className="flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-red-600 lg:hidden"
          onClick={logout}
          aria-label="Log out"
        >
          <Icon name="logout" className="h-6 w-6" /> Log out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-dvh">
      {sidebar}
      <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} threshold={ptr.threshold} />

      <div className="md:pl-20 lg:pl-64">
        {/* phone header */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur md:hidden">
          <Brand compact />
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell sheet />
            <button className="rounded-full p-1" onClick={() => setMore(true)} aria-label="Account and more">
              <Avatar name={name} size="sm" />
            </button>
          </div>
        </header>

        {/* tablet / desktop top bar */}
        <div className="sticky top-0 z-20 hidden h-16 items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 backdrop-blur-md md:flex lg:px-8">
          <p className="text-sm text-slate-500">
            Hi, <span className="font-semibold text-slate-800">{session.user?.first_name || name}</span>
          </p>
          <NotificationBell />
        </div>

        <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          <Outlet />
        </main>
      </div>

      {/* phone bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        <div className="grid grid-cols-5 px-1">
          {tabs.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="group flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold">
              {({ isActive }) => (
                <>
                  <span
                    className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${
                      isActive ? "bg-water-100 text-water-700" : "text-slate-400"
                    }`}
                  >
                    <Icon name={item.icon} className="h-[22px] w-[22px]" strokeWidth={isActive ? 2 : 1.6} />
                    {count(item) > 0 && (
                      <span className="absolute right-1.5 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                        {count(item)}
                      </span>
                    )}
                  </span>
                  <span className={isActive ? "text-water-800" : "text-slate-500"}>{item.short ?? item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button className="group flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold" onClick={() => setMore(true)} aria-haspopup="dialog">
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${
                moreActive ? "bg-water-100 text-water-700" : "text-slate-400"
              }`}
            >
              <Icon name="menu" className="h-[22px] w-[22px]" strokeWidth={moreActive ? 2 : 1.6} />
            </span>
            <span className={moreActive ? "text-water-800" : "text-slate-500"}>More</span>
          </button>
        </div>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
            <Avatar name={name} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
              <div className="text-xs text-slate-500">{roleLabel[role]}</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {rest.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMore(false)}
                className={({ isActive }) =>
                  `flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center text-xs font-semibold transition active:scale-95 ${
                    isActive ? "bg-water-50 text-water-800 ring-1 ring-water-200" : "bg-slate-50 text-slate-700 ring-1 ring-slate-100"
                  }`
                }
              >
                <Icon name={item.icon} className="h-6 w-6" />
                {item.short ?? item.label}
              </NavLink>
            ))}
          </div>
          <button className="btn-secondary w-full text-red-700" onClick={logout}>
            <Icon name="logout" className="h-4 w-4" /> Log out
          </button>
        </div>
      </Modal>
    </div>
  );
}
