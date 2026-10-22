import { useState } from "react";
import Icon from "@/components/Icon";
import { Spinner } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/api";
import { useOrderAction } from "@/lib/queries";
import type { Order } from "@/lib/types";
import { AssignRiderModal, ReasonModal } from "./orderModals";

/**
 * The one obvious next step for an order, right on its card, so staff don't have to open it:
 *  - pending            -> Confirm / Reject
 *  - needs a rider      -> Assign rider
 * Renders nothing when there is no quick action. Buttons come from the server's `allowed_transitions`.
 */
export default function OrderQuickActions({ order }: { order: Order }) {
  const toast = useToast();
  const action = useOrderAction(order.id);
  const [modal, setModal] = useState<null | "reject" | "assign">(null);

  const canConfirm = order.allowed_transitions.includes("confirmed");
  const canAssign = !canConfirm && order.can_assign_rider && !order.rider;
  if (!canConfirm && !canAssign) return null;

  function confirm() {
    action.mutate(
      { action: "confirm" },
      {
        onSuccess: () => toast.success(`Order #${order.id} confirmed.`),
        onError: (e) => toast.error(errorMessage(e)),
      }
    );
  }

  return (
    <>
      {canConfirm ? (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary btn-sm" onClick={confirm} disabled={action.isPending}>
            {action.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />} Confirm
          </button>
          <button className="btn-secondary btn-sm text-red-700" onClick={() => setModal("reject")} disabled={action.isPending}>
            Reject
          </button>
        </div>
      ) : (
        <button className="btn-secondary btn-sm w-full" onClick={() => setModal("assign")}>
          <Icon name="truck" className="h-4 w-4 text-water-600" /> Assign rider
        </button>
      )}
      {modal === "reject" && <ReasonModal order={order} kind="reject" open onClose={() => setModal(null)} />}
      {modal === "assign" && <AssignRiderModal order={order} open onClose={() => setModal(null)} />}
    </>
  );
}
