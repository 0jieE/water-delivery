import { useState } from "react";
import { Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/api";
import { usePaymentAction } from "@/lib/queries";
import { RejectPaymentModal } from "./orderModals";

/** Verify / reject buttons for a payment that is `pending_verification`. */
export default function PaymentActions({
  paymentId,
  orderId,
  size = "md",
}: {
  paymentId: number;
  orderId: number;
  size?: "sm" | "md";
}) {
  const toast = useToast();
  const action = usePaymentAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [error, setError] = useState("");
  const sm = size === "sm" ? "btn-sm" : "";

  function verify() {
    action.mutate(
      { paymentId, action: "verify" },
      {
        onSuccess: () => toast.success(`Payment for order #${orderId} verified.`),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  }

  function reject(remarks: string) {
    setError("");
    action.mutate(
      { paymentId, action: "reject", remarks },
      {
        onSuccess: () => {
          toast.success(`Payment for order #${orderId} rejected.`);
          setRejectOpen(false);
        },
        onError: (e) => setError(errorMessage(e)),
      }
    );
  }

  const verifying = action.isPending && action.variables?.action === "verify";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button className={`btn-success ${sm}`} onClick={verify} disabled={action.isPending}>
          {verifying && <Spinner className="h-4 w-4 text-white" />} Verify payment
        </button>
        <button
          className={`btn-secondary ${sm} text-red-700`}
          onClick={() => {
            setError("");
            setRejectOpen(true);
          }}
          disabled={action.isPending}
        >
          Reject
        </button>
      </div>
      <RejectPaymentModal
        open={rejectOpen}
        title={`Reject payment · order #${orderId}`}
        onClose={() => setRejectOpen(false)}
        onSubmit={reject}
        busy={action.isPending && action.variables?.action === "reject"}
        error={error}
      />
    </>
  );
}
