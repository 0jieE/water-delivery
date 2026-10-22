import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clearSession, useSession } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { useMediaQuery } from "@/lib/hooks";
import { usePullToRefresh } from "@/lib/pullToRefresh";
import type { Role } from "@/lib/types";
import Icon from "./Icon";
import NotificationBell from "./NotificationBell";
import PullIndicator from "./PullIndicator";
import { Brand, navFor } from "./nav";

/**
 * Mobile app layout for customers and riders.
 *
 *  - On a phone (< lg) the PAGE itself scrolls, with a sticky header and a fixed bottom tab bar. That is what
 *    lets the browser collapse its address bar (and bottom toolbar) while you scroll, giving the app the full
 *    screen, and it respects notches / safe areas and phone landscape.
 *  - On a desktop (lg+) it is a phone-sized frame centred on the page, with its own inner scrolling. The frame
 *    carries a CSS transform, which makes `position: fixed` descendants (modals, the notification sheet) position
 *    against the frame instead of the browser window.
 *
 * The `phone` class is also what the `wide:` Tailwind variant checks to switch desktop-only styles off.
 */
export default function PhoneShell({ role }: { role: Role }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = useSession();
  const qc = useQueryClient();
  const cart = useCart();
  const scroller = useRef<HTMLElement>(null);
  const framed = useMediaQuery("(min-width: 1024px)");
  const items = navFor(role);
  const first = (session.user?.first_name || session.user?.username || "").trim();

  // Pull down from the top of the screen to refresh everything (touch screens only).
  const ptr = usePullToRefresh(() => qc.invalidateQueries(), framed ? scroller : undefined);

  // New screen -> start at the top.
  useEffect(() => {
    if (framed) scroller.current?.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }, [pathname, framed]);

  function logout() {
    clearSession();
    cart.clear();
    qc.clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-dvh justify-center bg-gradient-to-br from-water-100 via-slate-100 to-water-50 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:items-center lg:py-6">
      <div className="phone relative flex min-h-dvh w-full max-w-md flex-col bg-slate-50 lg:h-[min(calc(100dvh-3rem),54rem)] lg:min-h-0 lg:overflow-clip lg:rounded-[2.25rem] lg:border-[6px] lg:border-slate-900/90 lg:shadow-pop lg:[transform:translateZ(0)]">
        <header
          className={`sticky top-0 z-30 flex min-h-16 flex-none items-center gap-2 border-b border-slate-200/70 bg-white/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur short:min-h-11 lg:static`}
        >
          <Brand compact />
          <span className="ml-1 hidden text-[13px] text-slate-500 min-[380px]:block">
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

        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} threshold={ptr.threshold} className="fixed left-1/2 top-16 z-40 lg:absolute" />

        <main
          ref={scroller}
          className="flex-1 px-4 pb-32 pt-5 short:pb-20 short:pt-3 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-6"
        >
          <Outlet />
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md flex-none border-t border-slate-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:static lg:mx-0"
          aria-label="Main"
        >
          <div className="grid px-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="group flex min-w-0 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold short:flex-row short:justify-center short:gap-1.5 short:py-1"
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 short:h-8 short:w-10 ${
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
                    <span className={`max-w-full truncate short:text-xs ${isActive ? "text-water-800" : "text-slate-500"}`}>{item.label}</span>
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
