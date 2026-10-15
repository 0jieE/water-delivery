import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearSession, useSession } from "@/lib/auth";
import { useDashboard } from "@/lib/queries";
import type { Role } from "@/lib/types";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import { useToast } from "./Toast";
import { Brand, navFor, roleLabel, type NavItem } from "./nav";
import { Avatar } from "./ui";

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

/** Desktop layout for staff and admin: sidebar on large screens, drawer on small ones. */
export default function Layout({ role }: { role: Role }) {
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [drawer, setDrawer] = useState(false);

  const sections = grouped(navFor(role));
  const name = session.user?.full_name || session.user?.username || "";

  // Live counters (polled every 15 s) drive the sidebar badges and the "new payment" alert.
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

  function logout() {
    clearSession();
    qc.clear();
    navigate("/login", { replace: true });
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
      isActive ? "bg-water-50 text-water-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  const navContent = (onClick?: () => void) =>
    sections.map((s) => (
      <div key={s.title} className="space-y-1">
        {s.title && <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.title}</p>}
        {s.items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={onClick}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-water-600" aria-hidden />}
                <Icon name={item.icon} className="h-5 w-5" strokeWidth={isActive ? 1.9 : 1.6} />
                {item.label}
                {item.badge && (dash.data?.[item.badge] ?? 0) > 0 && (
                  <span
                    className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold leading-none text-white"
                    title={item.badge === "pending_payments" ? "Payments to verify" : "Orders to confirm"}
                  >
                    {dash.data?.[item.badge]}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    ));

  const userCard = (
    <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
      <Avatar name={name} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
        <div className="text-xs text-slate-500">{roleLabel[role]}</div>
      </div>
      <button
        className="rounded-lg p-2 text-slate-400 transition hover:bg-white hover:text-red-600"
        onClick={logout}
        aria-label="Log out"
        title="Log out"
      >
        <Icon name="logout" className="h-5 w-5" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md lg:hidden">
        <div className="flex h-14 items-center gap-2 px-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
          >
            <Icon name="menu" className="h-6 w-6" strokeWidth={1.8} />
          </button>
          <Brand compact />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </div>
      </header>

      <div className="lg:flex">
        <aside className="hidden w-64 flex-none border-r border-slate-200/70 bg-white lg:block">
          <div className="sticky top-0 flex h-screen flex-col px-3 pb-3">
            <div className="px-3 py-5">
              <Brand />
            </div>
            <nav className="-mr-1 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Main">
              {navContent()}
            </nav>
            <div className="pt-3">{userCard}</div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 hidden h-16 items-center justify-end gap-2 border-b border-slate-200/70 bg-white/80 px-8 backdrop-blur-md lg:flex">
            <NotificationBell />
          </div>
          <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] animate-fade-in flex-col bg-white px-3 pb-3 shadow-pop">
            <div className="flex items-center justify-between px-3 py-4">
              <Brand />
              <button className="rounded-full p-2 text-slate-400 hover:bg-slate-100" onClick={() => setDrawer(false)} aria-label="Close menu">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Main">
              {navContent(() => setDrawer(false))}
            </nav>
            <div className="pt-3">{userCard}</div>
          </aside>
        </div>
      )}
    </div>
  );
}
