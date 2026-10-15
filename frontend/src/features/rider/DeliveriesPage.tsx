import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "@/components/Icon";
import { EmptyState, ErrorState, LoadingState, PageHeader, Pagination, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage, fieldErrors, parseApiError } from "@/lib/api";
import { RIDER_STATUS_LABEL, formatLongDate, money, todayISO } from "@/lib/format";
import { useAvailability, useDeliveries, useMyCash, useRiderMe, useStartDeliveries, type DeliveryScope } from "./api";
import DeliveryCard from "./DeliveryCard";

const STATUS_DOT = {
  available: "bg-emerald-500",
  on_delivery: "bg-water-500",
  off_duty: "bg-slate-400",
} as const;

function AvailabilityBar() {
  const toast = useToast();
  const me = useRiderMe();
  const set = useAvailability();
  const status = me.data?.rider_profile?.status;
  if (!status) return null;

  const onDelivery = status === "on_delivery";
  const next = status === "available" ? "off_duty" : "available";

  return (
    <div className="card mb-5 flex items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          {status === "available" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span className={`relative inline-flex h-3 w-3 rounded-full ${STATUS_DOT[status]}`} />
        </span>
        <div className="leading-tight">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your status</p>
          <p className="text-[15px] font-bold text-slate-900">{RIDER_STATUS_LABEL[status]}</p>
        </div>
      </div>
      {onDelivery ? (
        <p className="max-w-[9.5rem] text-right text-xs leading-snug text-slate-500">Finish all your deliveries to change status.</p>
      ) : (
        <button
          className={status === "available" ? "btn-secondary" : "btn-success"}
          disabled={set.isPending}
          onClick={() =>
            set.mutate(next, {
              onSuccess: () => toast.success(next === "available" ? "You're available for deliveries." : "You're now off duty."),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          {set.isPending && <Spinner className="h-4 w-4" />}
          {status === "available" ? "Go off duty" : "Go available"}
        </button>
      )}
    </div>
  );
}

/** Shown only while the rider is carrying cash: a nudge to hand it in. */
function CashSummary() {
  const cash = useMyCash();
  const held = Number(cash.data?.amount_held ?? 0);
  if (!(held > 0)) return null;
  return (
    <Link
      to="/rider/cash"
      className="mb-5 flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-4 transition active:scale-[0.99]"
    >
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-amber-500 text-white">
        <Icon name="coin" className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[11px] font-bold uppercase tracking-wider text-amber-800">Cash on hand</span>
        <span className="tabular block text-xl font-extrabold text-amber-950">{money(held)}</span>
        <span className="block text-xs text-amber-800">Hand it to the station staff</span>
      </span>
      <Icon name="chevronRight" className="h-5 w-5 text-amber-700" />
    </Link>
  );
}

export default function DeliveriesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [scope, setScope] = useState<Exclude<DeliveryScope, "history" | "active">>("today");
  const list = useDeliveries(scope);
  const startMany = useStartDeliveries();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const results = list.data?.results ?? [];
  const inProgress = results.filter((d) => d.order_status === "out_for_delivery");
  const startable = results.filter((d) => d.allowed_transitions.includes("out_for_delivery"));

  function leaveSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }
  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startSelected() {
    const ids = startable.filter((d) => selected.has(d.id)).map((d) => d.id);
    if (!ids.length) return;
    startMany.mutate(ids, {
      onSuccess: (started) => {
        toast.success(`${started.length} deliver${started.length === 1 ? "y" : "ies"} started. Drive safe!`);
        leaveSelectMode();
        navigate("/rider/trip");
      },
      onError: (e) => {
        const info = parseApiError(e);
        toast.error(fieldErrors(info).orders ?? errorMessage(e, info));
      },
    });
  }

  return (
    <div>
      <PageHeader title="Deliveries" subtitle={formatLongDate(todayISO())} />

      <AvailabilityBar />
      <CashSummary />

      <div className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-200/70 p-1" role="tablist">
        {(["today", "upcoming"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            onClick={() => {
              setScope(s);
              leaveSelectMode();
            }}
            className={`min-h-11 rounded-xl text-sm font-semibold transition ${scope === s ? "bg-white text-water-800 shadow-soft" : "text-slate-500"}`}
          >
            {s === "today" ? "Today" : "Upcoming"}
          </button>
        ))}
      </div>

      {/* A trip is every delivery already on the road. */}
      {!selectMode && inProgress.length > 0 && (
        <Link
          to="/rider/trip"
          className="mb-5 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-water-600 to-water-500 p-4 text-white shadow-glow transition active:scale-[0.99]"
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-white/20">
            <Icon name="route" className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[15px] font-bold">Current trip · {inProgress.length} stop{inProgress.length === 1 ? "" : "s"}</span>
            <span className="block text-xs text-water-100">See all stops and the route on one map</span>
          </span>
          <Icon name="chevronRight" className="h-5 w-5" />
        </Link>
      )}

      {startable.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {selectMode ? (
            <>
              <button
                className="btn-ghost btn-sm"
                onClick={() => setSelected(selected.size === startable.length ? new Set() : new Set(startable.map((d) => d.id)))}
              >
                {selected.size === startable.length ? "Clear selection" : `Select all (${startable.length})`}
              </button>
              <button className="btn-ghost btn-sm" onClick={leaveSelectMode}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                {startable.length} ready to start. Pick several to run them as one trip.
              </p>
              <button className="btn-secondary btn-sm" onClick={() => setSelectMode(true)}>
                <Icon name="check" className="h-4 w-4" /> Select
              </button>
            </>
          )}
        </div>
      )}

      {list.isPending ? (
        <LoadingState label="Loading deliveries…" />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="truck"
            title={scope === "today" ? "No deliveries for today" : "No upcoming deliveries"}
            hint="New assignments appear here automatically."
          />
        </div>
      ) : (
        <ul className={`space-y-3.5 transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
          {list.data.results.map((d) => (
            <li key={d.id}>
              <DeliveryCard d={d} selectMode={selectMode} selected={selected.has(d.id)} onToggle={() => toggle(d.id)} />
            </li>
          ))}
        </ul>
      )}

      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-0 z-20 mt-4 animate-slide-up">
          <button className="btn-primary btn-lg w-full shadow-pop" onClick={startSelected} disabled={startMany.isPending}>
            {startMany.isPending ? <Spinner className="h-5 w-5 text-white" /> : <Icon name="route" className="h-5 w-5" />}
            Start {selected.size} deliver{selected.size === 1 ? "y" : "ies"}
          </button>
        </div>
      )}
    </div>
  );
}
export function HistoryPage() {
  const [page, setPage] = useState(1);
  const list = useDeliveries("history", page);

  return (
    <div>
      <PageHeader title="History" subtitle="Your completed and failed deliveries" />

      {list.isPending ? (
        <LoadingState />
      ) : list.isError ? (
        <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
      ) : list.data.results.length === 0 ? (
        <div className="card">
          <EmptyState icon="clock" title="No past deliveries yet" />
        </div>
      ) : (
        <>
          <ul className={`space-y-3.5 transition-opacity ${list.isPlaceholderData ? "opacity-60" : ""}`}>
            {list.data.results.map((d) => (
              <li key={d.id}>
                <DeliveryCard d={d} />
              </li>
            ))}
          </ul>
          <Pagination page={page} count={list.data.count} pageSize={20} onPage={setPage} />
        </>
      )}
    </div>
  );
}

