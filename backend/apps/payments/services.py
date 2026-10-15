"""Payment rules: proof upload by the customer, verification by staff."""
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.notifications.services import notify, notify_staff
from apps.orders.models import Order

from .models import Payment

CLOSED_ORDER_STATUSES = (Order.Status.CANCELLED, Order.Status.REJECTED)


def _lock(payment):
    return Payment.objects.select_for_update().select_related("order__customer").get(pk=payment.pk)


@transaction.atomic
def upload_proof(payment, actor, image, reference_number):
    payment = _lock(payment)
    order = payment.order
    if order.customer_id != actor.pk:
        raise PermissionDenied("You can only pay for your own orders.")
    if payment.payment_method == Payment.Method.COD:
        raise ValidationError("Cash on delivery orders are paid to the rider; no proof is needed.")
    if order.order_status in CLOSED_ORDER_STATUSES:
        raise ValidationError(f"This order is {order.order_status}; payment is no longer needed.")
    if payment.payment_status not in (Payment.Status.UNPAID, Payment.Status.REJECTED):
        raise ValidationError(
            f"Payment is already {payment.get_payment_status_display().lower()}; proof cannot be replaced."
        )

    if payment.proof_image:
        payment.proof_image.delete(save=False)  # a rejected proof is being replaced
    payment.proof_image = image
    payment.reference_number = reference_number
    payment.payment_status = Payment.Status.PENDING_VERIFICATION
    payment.remarks = ""
    payment.verified_by = None
    payment.payment_date = None
    payment.amount = order.total_amount
    payment.save()

    notify_staff(
        "Payment proof uploaded",
        f"{actor.full_name} uploaded proof for order #{order.pk} (PHP {payment.amount}). Please verify.",
        order=order,
    )
    return payment


def _require_pending(payment):
    if payment.payment_status != Payment.Status.PENDING_VERIFICATION:
        raise ValidationError(
            f"Only payments pending verification can be reviewed (this one is '{payment.payment_status}')."
        )
    if payment.order.order_status in CLOSED_ORDER_STATUSES:
        raise ValidationError(f"The order is {payment.order.order_status}.")


@transaction.atomic
def verify(payment, actor):
    payment = _lock(payment)
    _require_pending(payment)
    payment.payment_status = Payment.Status.PAID
    payment.payment_date = timezone.now()
    payment.verified_by = actor
    payment.remarks = ""
    payment.save()
    notify(
        payment.order.customer,
        "Payment confirmed",
        f"Your payment for order #{payment.order_id} (PHP {payment.amount}) has been confirmed.",
        order=payment.order,
    )
    return payment


@transaction.atomic
def reject(payment, actor, remarks):
    payment = _lock(payment)
    _require_pending(payment)
    payment.payment_status = Payment.Status.REJECTED
    payment.verified_by = actor
    payment.payment_date = None
    payment.remarks = remarks
    payment.save()
    notify(
        payment.order.customer,
        "Payment rejected",
        f"Your payment proof for order #{payment.order_id} was rejected. Reason: {remarks} "
        "Please upload a new proof.",
        order=payment.order,
    )
    return payment
