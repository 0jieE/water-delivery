import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearSession, useSession } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { usePullToRefresh } from "@/lib/pullToRefresh";
import type { Role } from "@/lib/types";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import PullIndicator from "./PullIndicator";
import { Brand, navFor } from "./nav";

/**
 * Mobile app layout for customers and riders, on every screen size. On a desktop it is a phone-sized
 * column centred on the page.
 *
 * The frame has a fixed height and scrolls its own content (like a native app), and it carries a
 * CSS transform. A transform makes `position: fixed` descendants (modals, the notification sheet)
 * position against the frame instead of the whole browser window, so they stay inside the "phone".
 * The `phone` class is also what the `wide:` Tailwind variant checks to switch desktop-only styles off.
 */
export default function PhoneShell({ role }: { role: Role }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = useSession();
  const qc = useQueryClient();
  const cart = useCart();
  const scroller = useRef<HTMLElement>(null);
  const items = navFor(role);
  const first = (session.user?.first_name || session.user?.username || "").trim();

  // Pull down from the top of the screen to refresh everything (touch screens only).
  const ptr = usePullToRefresh(() => qc.invalidateQueries(), scroller);

  // New screen -> start at the top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [pathname]);

  function logout() {
    clearSession();
    cart.clear();
    qc.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-dvh justify-center bg-gradient-to-br from-water-100 via-slate-100 to-water-50 lg:items-center lg:py-6">
      <div className="phone relative flex h-dvh w-full max-w-md flex-col overflow-clip bg-slate-50 [transform:translateZ(0)] lg:h-[min(calc(100dvh-3rem),54rem)] lg:rounded-[2.25rem] lg:border-[6px] lg:border-slate-900/90 lg:shadow-pop">
        <header className="flex h-16 flex-none items-center gap-2 border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur">
          <Brand compact />
          <span className="ml-1 hidden min-[380px]:block text-[13px] text-slate-500">
            · Hi, <span className="font-semibold text-slate-700">{first}</span>
          </span>
          <div className="ml-auto flex items-center">
            <NotificationBell sheet />
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
              onClick={logout}
              aria-label="Log out"
              title="Log out"
            >
              <Icon name="logout" className="h-5 w-5" />
            </button>
          </div>
        </header>

        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} threshold={ptr.threshold} className="absolute left-1/2 top-16 z-40" />

        <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-5">
          <Outlet />
        </main>

        <nav className="flex-none border-t border-slate-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="Main">
          <div className="grid px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="group flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold">
                {({ isActive }) => (
                  <>
                    <span
                      className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${
                        isActive ? "bg-water-100 text-water-700" : "text-slate-400 group-hover:text-slate-600"
                      }`}
                    >
                      <Icon name={item.icon} className="h-[22px] w-[22px]" strokeWidth={isActive ? 2 : 1.6} />
                      {item.cart && cart.count > 0 && (
                        <span className="absolute right-2 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {cart.count}
                        </span>
                      )}
                    </span>
                    <span className={isActive ? "text-water-800" : "text-slate-500"}>{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
