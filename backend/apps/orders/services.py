"""Business rules for orders.

Everything that changes an order goes through this module so the transition map,
rider/payment side effects, status log and notifications can never get out of sync.
"""
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.deliveries.models import RiderProfile
from apps.notifications.services import notify, notify_staff
from apps.payments.models import Payment

from .models import Order, OrderDetail, OrderStatusLog

S = Order.Status

STAFF = frozenset({"staff", "admin"})
RIDER = frozenset({"rider"})
CUSTOMER = frozenset({"customer"})

# from_status -> {to_status: roles allowed to perform it}
TRANSITIONS = {
    S.PENDING: {S.CONFIRMED: STAFF, S.REJECTED: STAFF, S.CANCELLED: CUSTOMER},
    S.CONFIRMED: {S.SCHEDULED: STAFF, S.CANCELLED: STAFF},
    # scheduled -> scheduled is a reschedule (new date) and is logged like any change
    S.SCHEDULED: {S.SCHEDULED: STAFF, S.OUT_FOR_DELIVERY: RIDER, S.CANCELLED: STAFF},
    S.OUT_FOR_DELIVERY: {S.DELIVERED: RIDER, S.FAILED: RIDER},
    S.FAILED: {S.SCHEDULED: STAFF, S.CANCELLED: STAFF},
    S.DELIVERED: {},
    S.CANCELLED: {},
    S.REJECTED: {},
}

# Statuses in which staff may (re)assign a rider.
RIDER_ASSIGNABLE = frozenset({S.CONFIRMED, S.SCHEDULED, S.FAILED})

# Orders that count towards a rider's workload (the per-rider cap).
RIDER_ACTIVE_STATUSES = (S.CONFIRMED, S.SCHEDULED, S.OUT_FOR_DELIVERY)

# Transitions that must carry a written reason.
REMARKS_REQUIRED = frozenset({S.REJECTED, S.FAILED})


def allowed_transitions(order, user):
    """Statuses `user` may move `order` to right now (empty if none)."""
    if not user.is_authenticated:
        return []
    if user.role == "customer" and order.customer_id != user.pk:
        return []
    if user.role == "rider" and (order.rider_id is None or order.rider.user_id != user.pk):
        return []
    return [
        str(to) for to, roles in TRANSITIONS.get(order.order_status, {}).items() if user.role in roles
    ]


def can_assign_rider(order, user):
    return user.is_authenticated and user.role in STAFF and order.order_status in RIDER_ASSIGNABLE


def orders_out_for_delivery(rider, exclude_order=None):
    """Orders this rider has on the road right now."""
    qs = Order.objects.filter(rider=rider, order_status=S.OUT_FOR_DELIVERY)
    return qs.exclude(pk=exclude_order.pk) if exclude_order is not None else qs


def settle_rider_status(rider, finished_order):
    """After a delivery ends: 'on_delivery' while other orders are still out, else 'available'."""
    still_out = orders_out_for_delivery(rider, exclude_order=finished_order).exists()
    rider.status = RiderProfile.Status.ON_DELIVERY if still_out else RiderProfile.Status.AVAILABLE
    rider.save(update_fields=["status"])


def past_date_error(value):
    if value < timezone.localdate():
        return "Delivery date cannot be in the past."
    return None


# --------------------------------------------------------------------------- create


@transaction.atomic
def create_order(
    customer,
    *,
    items,
    delivery_date,
    delivery_address,
    notes,
    payment_method,
    delivery_latitude=None,
    delivery_longitude=None,
):
    """`items` is a list of (WaterRefillService, quantity). Prices come from the DB, never the client."""
    order = Order.objects.create(
        customer=customer,
        delivery_date=delivery_date,
        delivery_address=delivery_address,
        delivery_latitude=delivery_latitude,
        delivery_longitude=delivery_longitude,
        notes=notes,
    )
    total = Decimal("0.00")
    for service, quantity in items:
        subtotal = service.price * quantity
        OrderDetail.objects.create(
            order=order,
            service=service,
            quantity=quantity,
            unit_price=service.price,
            subtotal=subtotal,
        )
        total += subtotal
    order.total_amount = total
    order.save(update_fields=["total_amount"])

    Payment.objects.create(order=order, payment_method=payment_method, amount=total)
    OrderStatusLog.objects.create(
        order=order, from_status="", to_status=S.PENDING, changed_by=customer, remarks="Order placed"
    )

    notify(
        customer,
        "Order placed",
        f"We received your order #{order.pk} (total PHP {total}). "
        f"Delivery date: {delivery_date:%B %d, %Y}. We will confirm it shortly.",
        order=order,
    )
    notify_staff(
        "New order",
        f"Order #{order.pk} from {customer.full_name} - PHP {total}, delivery on {delivery_date}.",
        order=order,
    )
    return order


# --------------------------------------------------------------------------- transitions


def _lock_order(order):
    return Order.objects.select_for_update().get(pk=order.pk)


def _reason(remarks):
    return f" Reason: {remarks}" if remarks else ""


def _customer_message(order, to_status, remarks):
    n = order.pk
    return {
        S.CONFIRMED: (
            "Order confirmed",
            f"Your order #{n} has been confirmed. We will schedule your delivery shortly.",
        ),
        S.REJECTED: ("Order rejected", f"Sorry, your order #{n} was rejected.{_reason(remarks)}"),
        S.SCHEDULED: (
            "Delivery scheduled",
            f"Your order #{n} is scheduled for delivery on {order.delivery_date:%B %d, %Y}.",
        ),
        S.OUT_FOR_DELIVERY: ("Out for delivery", f"Your order #{n} is on its way."),
        S.DELIVERED: ("Order delivered", f"Your order #{n} has been delivered. Thank you!"),
        S.FAILED: (
            "Delivery failed",
            f"We could not deliver order #{n}.{_reason(remarks)} We will contact you to reschedule.",
        ),
        S.CANCELLED: ("Order cancelled", f"Your order #{n} was cancelled.{_reason(remarks)}"),
    }[to_status]


def _notify_status_change(order, to_status, actor, remarks):
    title, message = _customer_message(order, to_status, remarks)
    if actor.pk != order.customer_id:
        notify(order.customer, title, message, order=order)

    if to_status == S.CANCELLED and order.rider_id:
        notify(
            order.rider.user,
            "Delivery cancelled",
            f"Order #{order.pk} was cancelled. You no longer need to deliver it.",
            order=order,
        )
    if to_status == S.CANCELLED and actor.pk == order.customer_id:
        notify_staff("Order cancelled", f"{actor.full_name} cancelled order #{order.pk}.", order=order)
    if to_status == S.FAILED:
        notify_staff(
            "Delivery failed",
            f"Delivery of order #{order.pk} failed.{_reason(remarks)}",
            order=order,
        )
    if to_status == S.SCHEDULED and order.rider_id:
        notify(
            order.rider.user,
            "Delivery scheduled",
            f"Order #{order.pk} is scheduled for {order.delivery_date:%B %d, %Y}.",
            order=order,
        )


@transaction.atomic
def change_status(order, to_status, actor, *, remarks="", delivery_date=None, cod_collected=False):
    """Move `order` to `to_status` on behalf of `actor`, applying every side effect.

    400 (ValidationError): the transition does not exist from the current status, or a rule
    (past date, missing reason, rider busy, cash not collected) is violated.
    403 (PermissionDenied): the transition exists but this actor/role may not perform it.
    """
    order = _lock_order(order)
    current = order.order_status
    targets = TRANSITIONS.get(current, {})

    if actor.role == "customer" and to_status == S.CANCELLED and current != S.PENDING:
        raise ValidationError("Only pending orders can be cancelled.")
    if to_status not in targets:
        raise ValidationError(f"An order that is '{current}' cannot be changed to '{to_status}'.")
    if actor.role not in targets[to_status]:
        raise PermissionDenied(f"Your role ({actor.role}) cannot change an order to '{to_status}'.")
    if actor.role == "customer" and order.customer_id != actor.pk:
        raise PermissionDenied("You can only change your own orders.")
    if actor.role == "rider" and (order.rider_id is None or order.rider.user_id != actor.pk):
        raise PermissionDenied("This delivery is not assigned to you.")

    remarks = (remarks or "").strip()
    if to_status in REMARKS_REQUIRED or (to_status == S.CANCELLED and actor.role in STAFF):
        if not remarks:
            raise ValidationError({"remarks": ["A reason is required for this change."]})

    if to_status == S.SCHEDULED:
        new_date = delivery_date or order.delivery_date
        error = past_date_error(new_date)
        if error:
            raise ValidationError({"delivery_date": [error]})
        order.delivery_date = new_date

    rider = None
    if order.rider_id and to_status in (S.OUT_FOR_DELIVERY, S.DELIVERED, S.FAILED):
        rider = RiderProfile.objects.select_for_update().get(pk=order.rider_id)

    if to_status == S.OUT_FOR_DELIVERY:
        # several deliveries may be out at once (a multi-stop trip); only an off-duty rider cannot start
        if rider.status == RiderProfile.Status.OFF_DUTY:
            raise ValidationError("You are off duty. Set yourself available before starting a delivery.")
        rider.status = RiderProfile.Status.ON_DELIVERY
        rider.save(update_fields=["status"])
    elif to_status == S.DELIVERED:
        payment = order.payment
        if payment.payment_method == Payment.Method.COD:
            if not cod_collected:
                raise ValidationError(
                    {"cod_collected": ["Confirm that the cash on delivery was collected."]}
                )
            payment.payment_status = Payment.Status.PAID
            payment.payment_date = timezone.now()
            payment.verified_by = actor  # the rider who collected the cash
            payment.amount = order.total_amount
            payment.save()
        settle_rider_status(rider, order)
    elif to_status == S.FAILED:
        settle_rider_status(rider, order)

    order.order_status = to_status
    order.save()
    OrderStatusLog.objects.create(
        order=order, from_status=current, to_status=to_status, changed_by=actor, remarks=remarks
    )
    _notify_status_change(order, to_status, actor, remarks)
    return order


# --------------------------------------------------------------------------- riders


@transaction.atomic
def assign_rider(order, actor, rider):
    """Assign a rider to the order (staff/admin only; view enforces the role).

    The rider may be 'available' or already 'on_delivery' (they can take more stops), but not
    'off_duty', and not beyond settings.MAX_ACTIVE_ORDERS_PER_RIDER active orders.
    """
    order = _lock_order(order)
    if order.order_status not in RIDER_ASSIGNABLE:
        raise ValidationError(
            f"A rider can only be assigned while the order is confirmed, scheduled or failed "
            f"(currently '{order.order_status}')."
        )
    rider = RiderProfile.objects.select_for_update().select_related("user").get(pk=rider.pk)
    if order.rider_id == rider.pk:
        return order  # already assigned: nothing to do
    if not rider.user.is_active:
        raise ValidationError({"rider": ["This rider's account is deactivated."]})
    if rider.status == RiderProfile.Status.OFF_DUTY:
        raise ValidationError({"rider": ["Rider is off duty and cannot be assigned orders."]})
    limit = settings.MAX_ACTIVE_ORDERS_PER_RIDER
    if limit:
        active = Order.objects.filter(rider=rider, order_status__in=RIDER_ACTIVE_STATUSES).count()
        if active >= limit:
            raise ValidationError(
                {"rider": [f"Rider already has {active} active orders (maximum {limit})."]}
            )

    previous = order.rider
    order.rider = rider
    order.save()

    notify(
        rider.user,
        "New delivery assigned",
        f"Order #{order.pk} for {order.customer.full_name} is assigned to you. "
        f"Deliver on {order.delivery_date:%B %d, %Y} to: {order.delivery_address}.",
        order=order,
    )
    if previous:
        notify(
            previous.user,
            "Delivery reassigned",
            f"Order #{order.pk} is no longer assigned to you.",
            order=order,
        )
    return order
