import { useServerSlow } from "@/lib/serverStatus";
import { applyUpdate, useNeedRefresh, useOnline } from "@/lib/pwa";
import Icon from "./Icon";
import { Spinner } from "./ui";

/**
 * App-level status notices, stacked at the bottom of the screen above the tab bar so they never cover
 * the header or navigation: offline, "server is waking up" (slow API), and "new version ready".
 */
export default function PwaNotices() {
  const online = useOnline();
  const slow = useServerSlow();
  const needRefresh = useNeedRefresh();

  if (online && !slow && !needRefresh) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-[65] mx-auto flex max-w-sm flex-col items-stretch gap-2 md:bottom-6 md:left-auto md:right-6 md:mx-0">
      {!online && (
        <div
          role="status"
          className="pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-2xl bg-amber-500 px-4 py-3 text-xs font-semibold leading-snug text-amber-950 shadow-pop"
        >
          <Icon name="warning" className="mt-px h-4 w-4 flex-none" />
          <span>You're offline. You can look around, but orders, payments and deliveries can't be updated until you reconnect.</span>
        </div>
      )}

      {online && slow && (
        <div
          role="status"
          className="pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-medium leading-snug text-white shadow-pop"
        >
          <Spinner className="mt-px h-4 w-4 flex-none text-white" />
          <span>Still working… the server may be waking up. The first request after a pause can take up to a minute.</span>
        </div>
      )}

      {needRefresh && (
        <div
          role="alertdialog"
          aria-label="Update available"
          className="pointer-events-auto flex animate-slide-up items-center gap-3 rounded-2xl bg-slate-900 p-3.5 text-white shadow-pop"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/15">
            <Icon name="refresh" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">A new version is ready</p>
            <p className="text-xs text-slate-300">Update when it suits you. It reloads the app.</p>
          </div>
          <button className="btn h-9 flex-none rounded-full bg-white px-4 text-xs text-slate-900 hover:bg-slate-100" onClick={applyUpdate}>
            Update
          </button>
        </div>
      )}
    </div>
  );
}
