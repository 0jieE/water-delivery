import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import { Brand } from "./nav";

const POINTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "truck", title: "Delivered to your door", text: "Order in a few taps and track your rider." },
  { icon: "pin", title: "Pin your exact spot", text: "Drop a pin once and we remember it." },
  { icon: "card", title: "Pay your way", text: "Cash on delivery or GCash." },
];

/** Shared shell for the sign-in and sign-up pages: brand panel on large screens, compact header on phones. */
export default function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-water-500 via-water-700 to-water-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <span className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10" aria-hidden />
        <span className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5" aria-hidden />
        <Brand light />
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-[1.1] tracking-tight !text-white">Fresh, clean water. Right on time.</h2>
          <p className="mt-4 text-base leading-relaxed text-water-100">
            Deep Water Refilling Station makes ordering and delivering water simple for customers, staff and riders.
          </p>
          <ul className="mt-10 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex items-start gap-4">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur">
                  <Icon name={p.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold">{p.title}</span>
                  <span className="block text-sm text-water-100">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-water-200">Kidapawan City</p>
      </aside>

      <main className="flex min-h-dvh flex-col bg-gradient-to-b from-water-50 to-white px-5 py-8 sm:px-10 lg:min-h-0 lg:justify-center lg:bg-white lg:from-white">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-center text-sm text-slate-600">{footer}</div>
        </div>
      </main>
    </div>
  );
}
