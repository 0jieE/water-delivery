import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, EmptyState, ErrorState, LoadingState, PageHeader, Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { BarList, ColumnChart, SERIES, StackedBarList, compact, type BarDatum, type ColumnDatum, type StackDatum } from "@/components/charts";
import { addDays, money, parseISODate, toISODate, todayISO } from "@/lib/format";
import type { Report, ReportColumn } from "@/lib/types";

const REPORTS = [
  { path: "sales/daily", label: "Daily sales" },
  { path: "sales/monthly", label: "Monthly sales" },
  { path: "orders-by-status", label: "Orders by status" },
  { path: "deliveries-per-rider", label: "Deliveries per rider" },
  { path: "top-services", label: "Top services" },
  { path: "cash", label: "Rider cash" },
] as const;

function firstOfMonthsAgo(n: number) {
  const d = new Date();
  return toISODate(new Date(d.getFullYear(), d.getMonth() - n, 1));
}

const PRESETS = [
  { label: "Last 7 days", range: () => [addDays(todayISO(), -6), todayISO()] },
  { label: "Last 30 days", range: () => [addDays(todayISO(), -29), todayISO()] },
  { label: "This month", range: () => [firstOfMonthsAgo(0), todayISO()] },
  { label: "Last 12 months", range: () => [firstOfMonthsAgo(11), todayISO()] },
] as const;

function cell(value: string | number | undefined, col: ReportColumn) {
  if (value === undefined || value === null) return "—";
  if (col.type === "money") return money(value);
  if (col.type === "number") return Number(value).toLocaleString("en-PH");
  return String(value);
}

const shortDay = (iso: string) => parseISODate(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
const longDay = (iso: string) => parseISODate(iso).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const monthDate = (ym: string) => parseISODate(`${ym}-01`);
const shortMonth = (ym: string) => monthDate(ym).toLocaleDateString("en-PH", { month: "short", year: "2-digit" }).replace(" ", " '");
const longMonth = (ym: string) => monthDate(ym).toLocaleDateString("en-PH", { month: "long", year: "numeric" });

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="mb-6 rounded-xl border border-slate-100 p-4">
      <figcaption className="mb-4 text-sm font-semibold text-slate-800">{title}</figcaption>
      {children}
    </figure>
  );
}

/** One chart per report type. The table below it is the table-view twin of every value shown here. */
function ReportChart({ report }: { report: Report }) {
  const rows = report.rows;
  const n = (v: string | number | undefined) => Number(v ?? 0);

  switch (report.report) {
    case "sales_daily":
    case "sales_monthly": {
      const monthly = report.report === "sales_monthly";
      if (rows.length < 2 || rows.every((r) => n(r.total_sales) === 0)) return null; // nothing to plot
      const data: ColumnDatum[] = rows.map((r) => ({
        key: String(r.period),
        label: monthly ? shortMonth(String(r.period)) : shortDay(String(r.period)),
        value: n(r.total_sales),
        tip: {
          title: monthly ? longMonth(String(r.period)) : longDay(String(r.period)),
          rows: [
            { label: "sales", value: money(r.total_sales), color: SERIES[0] },
            { label: n(r.orders) === 1 ? "order" : "orders", value: String(n(r.orders)) },
          ],
        },
      }));
      return (
        <ChartBlock title={monthly ? "Sales per month (PHP)" : "Sales per day (PHP)"}>
          <ColumnChart data={data} ariaLabel={`${report.title}, ${rows.length} periods`} tickFormat={(v) => `₱${compact(v)}`} valueFormat={(v) => money(v)} />
        </ChartBlock>
      );
    }

    case "orders_by_status": {
      const present = rows.filter((r) => n(r.orders) > 0);
      if (present.length === 0) return null;
      const data: BarDatum[] = present.map((r) => ({
        key: String(r.status),
        label: String(r.label),
        value: n(r.orders),
        display: String(n(r.orders)),
        tip: { title: String(r.label), rows: [{ label: "orders", value: String(n(r.orders)), color: SERIES[0] }, { label: "total value", value: money(r.total_amount) }] },
      }));
      return (
        <ChartBlock title="Orders by status">
          <BarList data={data} ariaLabel="Orders by status" />
        </ChartBlock>
      );
    }

    case "deliveries_per_rider": {
      if (rows.length === 0) return null;
      const data: StackDatum[] = rows.map((r) => ({
        key: String(r.rider_id),
        label: String(r.rider),
        values: { delivered: n(r.delivered), in_progress: n(r.in_progress), failed: n(r.failed) },
        total: String(n(r.assigned)),
        tip: {
          title: `${r.rider}${r.vehicle_type ? ` · ${r.vehicle_type}` : ""}`,
          rows: [
            { label: "delivered", value: String(n(r.delivered)), color: SERIES[0] },
            { label: "in progress", value: String(n(r.in_progress)), color: SERIES[1] },
            { label: "failed", value: String(n(r.failed)), color: SERIES[2] },
            { label: "delivered value", value: money(r.delivered_value) },
          ],
        },
      }));
      return (
        <ChartBlock title="Assigned deliveries per rider">
          <StackedBarList
            series={[
              { key: "delivered", label: "Delivered" },
              { key: "in_progress", label: "In progress" },
              { key: "failed", label: "Failed" },
            ]}
            data={data}
            ariaLabel="Deliveries per rider"
          />
        </ChartBlock>
      );
    }

    case "top_services": {
      if (rows.length === 0) return null;
      const data: BarDatum[] = rows.map((r) => ({
        key: String(r.service_id),
        label: String(r.service),
        value: n(r.quantity),
        display: n(r.quantity).toLocaleString("en-PH"),
        tip: {
          title: String(r.service),
          rows: [
            { label: "units sold", value: n(r.quantity).toLocaleString("en-PH"), color: SERIES[0] },
            { label: n(r.orders) === 1 ? "order" : "orders", value: String(n(r.orders)) },
            { label: "revenue", value: money(r.revenue) },
          ],
        },
      }));
      return (
        <ChartBlock title="Units sold per service">
          <BarList data={data} ariaLabel="Top services by units sold" />
        </ChartBlock>
      );
    }

    case "cash": {
      const holding = rows.filter((r) => n(r.outstanding) > 0);
      if (holding.length === 0) return null;
      const data: BarDatum[] = holding.map((r) => ({
        key: String(r.rider_id),
        label: String(r.rider),
        value: n(r.outstanding),
        display: money(r.outstanding),
        tip: {
          title: String(r.rider),
          rows: [
            { label: "still held now", value: money(r.outstanding), color: SERIES[0] },
            { label: "collected in range", value: money(r.collected) },
            { label: "handed in in range", value: money(r.remitted) },
          ],
        },
      }));
      return (
        <ChartBlock title="Cash still held by riders (PHP)">
          <BarList data={data} ariaLabel="Cash held by each rider" />
        </ChartBlock>
      );
    }

    default:
      return null;
  }
}
export default function ReportsPage() {
  const toast = useToast();
  const [path, setPath] = useState<(typeof REPORTS)[number]["path"]>(REPORTS[0].path);
  const [from, setFrom] = useState(addDays(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [limit, setLimit] = useState("10");
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);

  const rangeError = !from || !to ? "Choose both dates." : from > to ? "The start date must be on or before the end date." : "";
  const params = { date_from: from, date_to: to, ...(path === "top-services" ? { limit } : {}) };

  const report = useQuery({
    queryKey: ["reports", path, params],
    queryFn: async () => (await api.get<Report>(`/reports/${path}/`, { params })).data,
    enabled: !rangeError,
    // Changing the dates keeps the previous chart on screen (dimmed) instead of flashing a skeleton.
    // Switching to a different report must NOT reuse the old one, since the shapes differ.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === path ? previous : undefined),
  });

  async function exportAs(format: "pdf" | "xlsx") {
    setExporting(format);
    try {
      await downloadFile(`/reports/${path}/`, { ...params, format }, `${path.replace("/", "_")}.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  }



  return (
    <div>
      <PageHeader title="Reports" subtitle="Summaries by delivery date, with PDF and Excel export." />

      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {REPORTS.map((r) => (
          <button
            key={r.path}
            role="tab"
            aria-selected={r.path === path}
            onClick={() => setPath(r.path)}
            className={`chip ${r.path === path ? "chip-active" : ""}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="rf">From</label>
            <input id="rf" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="rt">To</label>
            <input id="rt" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
          {path === "top-services" && (
            <div>
              <label className="label" htmlFor="rl">Show top</label>
              <select id="rl" className="input" value={limit} onChange={(e) => setLimit(e.target.value)}>
                {["5", "10", "20", "50"].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary" disabled={!!rangeError || exporting !== null} onClick={() => exportAs("pdf")}>
              {exporting === "pdf" && <Spinner className="h-4 w-4" />} Export PDF
            </button>
            <button className="btn-secondary" disabled={!!rangeError || exporting !== null} onClick={() => exportAs("xlsx")}>
              {exporting === "xlsx" && <Spinner className="h-4 w-4" />} Export Excel
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="chip px-3 text-xs"
              onClick={() => {
                const [f, t] = p.range();
                setFrom(f);
                setTo(t);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {rangeError ? (
        <Alert>{rangeError}</Alert>
      ) : report.isPending ? (
        <LoadingState label="Generating report…" />
      ) : report.isError ? (
        <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} />
      ) : (
        <Card title={`${report.data.title} · ${report.data.date_from} to ${report.data.date_to}`}>
          {report.data.note && <p className="mb-3 text-xs text-slate-500">{report.data.note}</p>}
          <ReportChart report={report.data} />
          {report.data.rows.length === 0 ? (
            <EmptyState title="No data for this period" />
          ) : (
            <div className="table-wrap shadow-none">
              <table className="table">
                <thead>
                  <tr>
                    {report.data.columns.map((c) => (
                      <th key={c.key} className={c.type === "text" ? "" : "text-right"}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row, i) => (
                    <tr key={i}>
                      {report.data.columns.map((c) => (
                        <td key={c.key} className={c.type === "text" ? "" : "text-right tabular-nums"}>{cell(row[c.key], c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(report.data.totals).length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      {report.data.columns.map((c, idx) => (
                        <td key={c.key} className={c.type === "text" ? "" : "text-right tabular-nums"}>
                          {idx === 0 && !(c.key in report.data.totals) ? "Total" : c.key in report.data.totals ? cell(report.data.totals[c.key], c) : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          <p className="mt-3 text-right text-xs text-slate-400">Generated {report.data.generated_at}</p>
        </Card>
      )}
    </div>
  );
}


