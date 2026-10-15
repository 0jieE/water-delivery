"""Cash-on-delivery remittance: what riders hold and the hand-in to staff.

A COD payment is "cash held by a rider" when it is a paid COD payment, was marked paid by that
rider (`verified_by`), and has not been put into a remittance yet. Every amount here is summed
from the payments themselves on the server; the client never sends one.
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.notifications.services import notify
from apps.payments.models import Payment

from .models import CashRemittance, RiderProfile

ZERO = Decimal("0.00")


def money(value):
    return str((value or ZERO).quantize(Decimal("0.01")))


def held_filter():
    """Conditions of 'a paid COD payment not yet remitted' (no joins, so it can be locked)."""
    return {
        "payment_method": Payment.Method.COD,
        "payment_status": Payment.Status.PAID,
        "remittance__isnull": True,
    }


def held_payments():
    """Every held COD payment, whichever rider collected it."""
    return Payment.objects.filter(**held_filter(), verified_by__rider_profile__isnull=False)


def local(value):
    """Datetimes in the API are in the server's local time (+08:00), like every other field."""
    return timezone.localtime(value) if value else None


def collected_at(payment):
    return local(payment.payment_date)


def held_by_rider(rider_id=None):
    """[{'rider': RiderProfile, 'name': str, 'payments': [Payment, ...]}] for riders holding cash."""
    payments = held_payments().select_related("verified_by__rider_profile").order_by("payment_date", "id")
    if rider_id is not None:
        payments = payments.filter(verified_by__rider_profile__id=rider_id)
    groups = {}
    for payment in payments:
        profile = payment.verified_by.rider_profile
        group = groups.setdefault(
            profile.pk, {"rider": profile, "name": payment.verified_by.full_name, "payments": []}
        )
        group["payments"].append(payment)
    return list(groups.values())


def total_held(payments):
    return sum((p.amount for p in payments), ZERO)


def order_lines(payments):
    return [
        {"order_id": p.order_id, "amount": money(p.amount), "collected_at": collected_at(p)}
        for p in payments
    ]


def outstanding_total():
    """Cash held by all riders right now (for the dashboard)."""
    return sum((p.amount for p in held_payments().only("amount")), ZERO)


@transaction.atomic
def remit(actor, rider, order_ids=None, remarks=""):
    """Record that `rider` handed cash in to `actor`.

    `order_ids=None` remits everything the rider holds. All or nothing: any order that is not held
    by this rider, or was already remitted, aborts the whole call with a 400 naming the order.
    """
    held = {
        p.order_id: p
        for p in Payment.objects.select_for_update()
        .filter(**held_filter(), verified_by=rider.user)
        .order_by("payment_date", "id")
    }

    if order_ids is None:
        chosen = list(held.values())
    else:
        chosen = []
        for order_id in order_ids:
            payment = held.get(order_id)
            if payment is None:
                raise ValidationError({"orders": [_why_not_held(order_id, rider)]})
            chosen.append(payment)
    if not chosen:
        raise ValidationError("This rider is not holding any cash to hand in.")

    remittance = CashRemittance.objects.create(
        rider=rider,
        amount=total_held(chosen),
        received_by=actor,
        remarks=(remarks or "").strip(),
    )
    Payment.objects.filter(pk__in=[p.pk for p in chosen]).update(remittance=remittance)

    notify(
        rider.user,
        "Cash handed in",
        f"Cash handed in: PHP {money(remittance.amount)} confirmed.",
    )
    return remittance


def _why_not_held(order_id, rider):
    payment = Payment.objects.filter(order_id=order_id).first()
    if payment is not None and payment.remittance_id:
        return f"Order #{order_id} was already remitted (remittance #{payment.remittance_id})."
    return f"Order #{order_id} is not cash held by this rider."


def rider_profile_for(user):
    return RiderProfile.objects.get(user=user)
