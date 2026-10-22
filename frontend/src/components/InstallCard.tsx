import { useState } from "react";
import { isIos, promptInstall, useCanInstall, useInstalled } from "@/lib/pwa";
import Icon from "./Icon";
import { Card } from "./ui";

/**
 * "Install the app" card (Profile page). Chrome/Edge/Android give us a real install prompt; iOS Safari has
 * none, so we show the Share -> Add to Home Screen steps. Hidden once the app is installed.
 */
export default function InstallCard() {
  const canInstall = useCanInstall();
  const installed = useInstalled();
  const [busy, setBusy] = useState(false);

  if (installed) return null;
  const ios = isIos();
  if (!canInstall && !ios) return null; // nothing the browser lets us offer

  return (
    <Card title="Install the app">
      <div className="flex items-start gap-3.5">
        <img src="/icons/icon-192.png" alt="" className="h-14 w-14 flex-none rounded-2xl shadow-soft" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Deep Water on your home screen</p>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
            Opens full-screen like a regular app, starts faster, and is one tap away.
          </p>
        </div>
      </div>

      {canInstall ? (
        <button
          className="btn-primary mt-4 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall();
            setBusy(false);
          }}
        >
          <Icon name="plus" className="h-4 w-4" strokeWidth={2.2} /> Install app
        </button>
      ) : (
        <ol className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3.5 text-[13px] leading-snug text-slate-600 ring-1 ring-slate-100">
          <li>
            <span className="font-semibold text-slate-800">1.</span> Open this page in <span className="font-semibold">Safari</span>.
          </li>
          <li>
            <span className="font-semibold text-slate-800">2.</span> Tap the <span className="font-semibold">Share</span> button (the square with an arrow).
          </li>
          <li>
            <span className="font-semibold text-slate-800">3.</span> Choose <span className="font-semibold">Add to Home Screen</span>, then <span className="font-semibold">Add</span>.
          </li>
        </ol>
      )}
    </Card>
  );
}
