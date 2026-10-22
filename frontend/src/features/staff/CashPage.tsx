import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "@/components/Icon";
import {
  Alert,
  Avatar,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
  TextAreaField,
} from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { formatDateTime, money, timeAgo } from "@/lib/format";
import { useCashHeld, useRemit, useRemittances, useRiders } from "@/lib/queries";
import type { CashHeld } from "@/lib/types";
import { useBase } from "./useBase";

const PAGE_SIZE = 15;

/** Confirm taking cash from a rider. The amount shown is only a preview: the server works out the real one. */
function RemitModal({
  held,
  picked,
  onClose,
}: {
  held: CashHeld | null;
  /** The specific orders chosen, or null to hand in everything the rider holds. */
  picked: number[] | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const remit = useRemit();
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");

  const lines = held ? (picked ? held.orders.filter((o) => picked.includes(o.order_id)) : held.orders) : [];
  const preview = lines.reduce((n, o) => n + Number(o.amount), 0);

  function close() {
    setRemarks("");
    setError("");
    onClose();
  }

  function submit() {
    if (!held) return;
    setError("");
    remit.mutate(
      { rider: held.rider.id, orders: picked ?? undefined, remarks: remarks.trim() },
      {
        onSuccess: (r) => {
          toast.success(`Received ${money(r.amount)} from ${r.rider.full_name}.`);
          close();
        },
        onError: (e) => {
          const info = parseApiError(e);
          setError(fieldErrors(info).orders ?? errorMessage(e, info));
        },
      }
    );
  }

  return (
    <Modal
      open={held !== null}
      onClose={close}
      title="Confirm cash hand-in"
      footer={
        <>
          <button className="btn-secondary" onClick={close} disabled={remit.isPending}>Cancel</button>
          <button className="btn-success" onClick={submit} disabled={remit.isPending || lines.length === 0}>
            {remit.isPending && <Spinner className="h-4 w-4 text-white" />} I received {money(preview)}
          </button>
        </>
      }
    >
      {held && (
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
            <Avatar name={held.rider.full_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{held.rider.full_name}</p>
              <p className="text-xs text-slate-500">{lines.length} order{lines.length === 1 ? "" : "s"}</p>
            </div>
            <p className="tabular text-xl font-bold text-emerald-700">{money(preview)}</p>
          </div>
          <p className="text-sm text-slate-600">
            Count the cash before you confirm. This records the hand-in and <span className="font-semibold">can't be edited afterwards</span>.
          </p>
          <TextAreaField
            label="Remarks (optional)"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            maxLength={500}
            placeholder="e.g. End of day, short by ₱5"
          />
        </div>
      )}
    </Modal>
  );
}

function RiderCashCard({ held, onRemit }: { held: CashHeld; onRemit: (picked: number[] | null) => void }) {
  const base = useBase();
  const [choose, setChoose] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const pickedTotal = held.orders.filter((o) => picked.has(o.order_id)).reduce((n, o) => n + Number(o.amount), 0);
  const oldDays = Math.floor((Date.now() - new Date(held.oldest_collected_at).getTime()) / 86_400_000);

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-4">
        <Avatar name={held.rider.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-slate-900">{held.rider.full_name}</p>
          <p className="text-xs text-slate-500">{held.rider.vehicle_type || "Rider"} · {held.orders_count} order{held.orders_count === 1 ? "" : "s"}</p>
          <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${oldDays >= 1 ? "text-amber-700" : "text-slate-400"}`}>
            <Icon name="clock" className="h-3.5 w-3.5" /> Oldest collected {timeAgo(held.oldest_collected_at)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Holding</p>
          <p className="tabular text-2xl font-extrabold tracking-tight text-slate-900">{money(held.amount_held)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
        <button className="btn-success" onClick={() => onRemit(null)}>
          <Icon name="coin" className="h-4 w-4" /> Hand in all · {money(held.amount_held)}
        </button>
        <button className="btn-secondary" onClick={() => setChoose((c) => !c)} aria-expanded={choose}>
          {choose ? "Hide orders" : "Choose orders"}
        </button>
      </div>

      {choose && (
        <div className="border-t border-slate-100 px-4 py-3">
          <ul className="divide-y divide-slate-100">
            {held.orders.map((o) => (
              <li key={o.order_id}>
                <label className="flex cursor-pointer items-center gap-3 py-2.5">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={picked.has(o.order_id)} onChange={() => toggle(o.order_id)} />
                  <span className="flex-1 text-sm">
                    <Link to={`${base}/orders/${o.order_id}`} className="font-semibold text-water-700 hover:underline" onClick={(e) => e.stopPropagation()}>
                      Order #{o.order_id}
                    </Link>
                    <span className="ml-2 text-xs text-slate-400">{formatDateTime(o.collected_at)}</span>
                  </span>
                  <span className="tabular text-sm font-semibold text-slate-900">{money(o.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">
              {picked.size} selected · <span className="tabular font-semibold text-slate-900">{money(pickedTotal)}</span>
            </span>
            <button className="btn-success btn-sm" disabled={picked.size === 0} onClick={() => onRemit([...picked])}>
              Hand in selected
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function History() {
  const base = useBase();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const riders = useRiders();
  const list = useRemittances({ rider: get("rider"), date_from: get("date_from"), date_to: get("date_to"), page, page_size: PAGE_SIZE });

  function update(next: Record<string, string | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v ? p.set(k, v) : p.delete(k));
    if (!("page" in next)) p.delete("page");
    setParams(p, { replace: true });
  }

  return (
    <div>
      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="hr">Rider</label>
          <select id="hr" className="input" value={get("rider")} onChange={(e) => update({ rider: e.target.value || undefined })}>
            <option value="">All riders</option>
            {(riders.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="hf">From</label>
          <input id="hf" type="date" className="input" value={get("date_from")} max={get("date_to") || undefined} onChange={(e) => update({ date_from: e.target.value || undefined })} />
        </div>
        <div>
          <label className="label" htmlFor="ht">To</label>
          <input id="ht" type="date" className="input" value={get("date_to")} min={get("date_from") || undefined} onChange={(e) => update({ date_to: e.target.value || undefined })} />
        </div>
      </div>

      {list.isPending ? (
        <LoadingState label="Loading history…" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <div className="card"><EmptyState icon="coin" title="No hand-ins yet" hint="Cash that riders hand in will be listed here." /></div>
      ) : (
        <>
          <ul className={`grid gap-3 md:grid-cols-2 lg:hidden ${list.isPlaceholderData ? "opacity-60" : ""}`}>
            {list.data.results.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={r.rider.full_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{r.rider.full_name}</p>
                    <p className="text-xs text-slate-400">{formatDateTime(r.received_at)}</p>
                  </div>
                  <p className="tabular text-lg font-bold text-emerald-700">{money(r.amount)}</p>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Received by {r.received_by.full_name}
                  {r.remarks ? ` · ${r.remarks}` : ""}
                </p>
                <p className="mt-1 text-xs">
                  {r.orders.map((o, i) => (
                    <span key={o.order_id}>
                      {i > 0 && ", "}
                      <Link to={`${base}/orders/${o.order_id}`} className="font-medium text-water-700 hover:underline">#{o.order_id}</Link>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>

          <div className={`table-wrap hidden lg:block ${list.isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="table">
              <thead>
                <tr><th>Received</th><th>Rider</th><th className="text-right">Amount</th><th>Orders</th><th>Received by</th><th>Remarks</th></tr>
              </thead>
              <tbody>
                {list.data.results.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDateTime(r.received_at)}</td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.rider.full_name} size="sm" />
                        <span className="font-medium text-slate-900">{r.rider.full_name}</span>
                      </div>
                    </td>
                    <td className="tabular text-right font-semibold text-slate-900">{money(r.amount)}</td>
                    <td className="max-w-48 text-xs">
                      {r.orders.map((o, i) => (
                        <span key={o.order_id}>
                          {i > 0 && ", "}
                          <Link to={`${base}/orders/${o.order_id}`} className="font-medium text-water-700 hover:underline">#{o.order_id}</Link>
                        </span>
                      ))}
                    </td>
                    <td>{r.received_by.full_name}</td>
                    <td className="max-w-56 truncate text-slate-500" title={r.remarks}>{r.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} count={list.data.count} pageSize={PAGE_SIZE} onPage={(p) => update({ page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}

export default function CashPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "holding";
  const held = useCashHeld();
  const [remitting, setRemitting] = useState<{ held: CashHeld; picked: number[] | null } | null>(null);

  const total = (held.data ?? []).reduce((n, h) => n + Number(h.amount_held), 0);

  return (
    <div>
      <PageHeader title="Rider cash" subtitle="Cash-on-delivery money riders have collected and not yet handed in." />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {[
          { key: "holding", label: "Holding cash" },
          { key: "history", label: "Hand-in history" },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`chip ${tab === t.key ? "chip-active" : ""}`}
            onClick={() => setParams(t.key === "holding" ? {} : { tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <History />
      ) : held.isPending ? (
        <LoadingState label="Loading rider cash…" />
      ) : held.isError ? (
        <ErrorState message={errorMessage(held.error)} onRetry={() => held.refetch()} />
      ) : held.data.length === 0 ? (
        <div className="card">
          <EmptyState icon="checkCircle" title="All settled" hint="No rider is holding cash right now. New cash appears here when a rider delivers a cash-on-delivery order." />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 py-4 text-white shadow-lift">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-100">Total with riders</p>
              <p className="tabular mt-0.5 text-3xl font-extrabold tracking-tight">{money(total)}</p>
            </div>
            <p className="text-right text-sm text-emerald-50">{held.data.length} rider{held.data.length === 1 ? "" : "s"}<br />holding cash</p>
          </div>
          {held.data.map((h) => (
            <RiderCashCard key={h.rider.id} held={h} onRemit={(picked) => setRemitting({ held: h, picked })} />
          ))}
        </div>
      )}

      <RemitModal held={remitting?.held ?? null} picked={remitting?.picked ?? null} onClose={() => setRemitting(null)} />
    </div>
  );
}
