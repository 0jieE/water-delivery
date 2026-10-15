import { useState } from "react";
import { errorMessage } from "@/lib/api";
import { usePaymentSettings } from "@/lib/queries";
import Icon from "./Icon";
import { useToast } from "./Toast";
import { Alert, ErrorState, Modal, Skeleton } from "./ui";

/** Shows the station's GCash QR with the account name and number as a fallback if it can't be scanned. */
export default function GcashPay({ amount }: { amount?: string }) {
  const settings = usePaymentSettings();
  const toast = useToast();
  const [zoom, setZoom] = useState(false);

  async function copyNumber(number: string) {
    try {
      await navigator.clipboard.writeText(number.replace(/\s+/g, ""));
      toast.success("GCash number copied.");
    } catch {
      toast.error("Couldn't copy. Please type the number instead.");
    }
  }

  if (settings.isPending) {
    return (
      <div className="flex items-center gap-4" role="status" aria-busy="true">
        <Skeleton className="h-28 w-28 flex-none rounded-2xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    );
  }
  if (settings.isError) return <ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />;

  const { gcash_qr_image: qr, gcash_account_name: name, gcash_number: number } = settings.data;

  if (!qr && !name && !number) {
    return <Alert kind="info">GCash payment details haven't been set up yet. Please contact the station, or choose cash on delivery.</Alert>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-4">
        {qr && (
          <>
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="group relative flex-none overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-soft transition hover:shadow-lift"
              aria-label="Enlarge GCash QR code"
            >
              <img src={qr} alt="GCash QR code" className="h-32 w-32 object-contain" />
              <span className="absolute inset-x-0 bottom-0 bg-slate-900/60 py-0.5 text-center text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
                Tap to enlarge
              </span>
            </button>
            <Modal open={zoom} onClose={() => setZoom(false)} title="Scan to pay with GCash">
              <img src={qr} alt="GCash QR code" className="mx-auto max-h-[60vh] w-full max-w-xs object-contain" />
              {(name || number) && (
                <p className="mt-3 text-center text-sm text-slate-600">
                  {name} {number && <span className="font-semibold text-slate-900">· {number}</span>}
                </p>
              )}
            </Modal>
          </>
        )}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-slate-900">Pay with GCash</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[13px] leading-snug text-slate-500">
            <li>Open GCash and scan the QR{amount ? <>, then send <span className="font-semibold text-slate-800">{amount}</span></> : ""}.</li>
            <li>Take a screenshot of your receipt.</li>
            <li>Upload it with the reference number.</li>
          </ol>
        </div>
      </div>

      {(name || number) && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-slate-100">
          <div className="min-w-0 leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Can't scan? Send to</p>
            {name && <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{name}</p>}
            {number && <p className="tabular text-sm text-slate-600">{number}</p>}
          </div>
          {number && (
            <button type="button" className="btn-secondary btn-sm flex-none" onClick={() => copyNumber(number)}>
              <Icon name="check" className="h-3.5 w-3.5" /> Copy
            </button>
          )}
        </div>
      )}
    </div>
  );
}
