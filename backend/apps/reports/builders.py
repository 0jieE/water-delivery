"""Report data. Each builder returns (columns, rows, totals) from plain ORM aggregates.

Rules shared by all reports:
- the date range filters on the order's `delivery_date`;
- "sales" and "top services" count only `delivered` orders;
- money is returned as strings with two decimals (like the rest of the API).
"""
import datetime
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth

from apps.deliveries import cash as cash_service
from apps.deliveries.models import CashRemittance, RiderProfile
from apps.orders.models import Order, OrderDetail
from apps.payments.models import Payment

ZERO = Decimal("0.00")
S = Order.Status


def money(value):
    return str((value or ZERO).quantize(Decimal("0.01")))


def _col(key, label, type_="text"):
    return {"key": key, "label": label, "type": type_}


def sales_daily(date_from, date_to):
    rows_by_day = {
        r["delivery_date"]: r
        for r in Order.objects.filter(order_status=S.DELIVERED, delivery_date__range=(date_from, date_to))
        .values("delivery_date")
        .annotate(orders=Count("id"), total=Sum("total_amount"))
    }
    rows, orders, total = [], 0, ZERO
    day = date_from
    while day <= date_to:
        row = rows_by_day.get(day)
        count = row["orders"] if row else 0
        amount = row["total"] if row else ZERO
        rows.append({"period": day.isoformat(), "orders": count, "total_sales": money(amount)})
        orders += count
        total += amount
        day += datetime.timedelta(days=1)
    columns = [_col("period", "Date"), _col("orders", "Orders", "number"), _col("total_sales", "Total sales (PHP)", "money")]
    return columns, rows, {"orders": orders, "total_sales": money(total)}


def sales_monthly(date_from, date_to):
    rows_by_month = {
        r["month"]: r
        for r in Order.objects.filter(order_status=S.DELIVERED, delivery_date__range=(date_from, date_to))
        .annotate(month=TruncMonth("delivery_date"))
        .values("month")
        .annotate(orders=Count("id"), total=Sum("total_amount"))
    }
    rows, orders, total = [], 0, ZERO
    month = date_from.replace(day=1)
    while month <= date_to:
        row = rows_by_month.get(month)
        count = row["orders"] if row else 0
        amount = row["total"] if row else ZERO
        rows.append({"period": month.strftime("%Y-%m"), "orders": count, "total_sales": money(amount)})
        orders += count
        total += amount
        month = (month.replace(day=28) + datetime.timedelta(days=4)).replace(day=1)
    columns = [_col("period", "Month"), _col("orders", "Orders", "number"), _col("total_sales", "Total sales (PHP)", "money")]
    return columns, rows, {"orders": orders, "total_sales": money(total)}


def orders_by_status(date_from, date_to):
    found = {
        r["order_status"]: r
        for r in Order.objects.filter(delivery_date__range=(date_from, date_to))
        .values("order_status")
        .annotate(orders=Count("id"), total=Sum("total_amount"))
    }
    rows, orders, total = [], 0, ZERO
    for value, label in Order.Status.choices:
        row = found.get(value)
        count = row["orders"] if row else 0
        amount = row["total"] if row else ZERO
        rows.append({"status": value, "label": label, "orders": count, "total_amount": money(amount)})
        orders += count
        total += amount
    columns = [
        _col("label", "Status"),
        _col("orders", "Orders", "number"),
        _col("total_amount", "Order value (PHP)", "money"),
    ]
    return columns, rows, {"orders": orders, "total_amount": money(total)}


def deliveries_per_rider(date_from, date_to):
    in_range = Q(orders__delivery_date__range=(date_from, date_to))
    riders = RiderProfile.objects.select_related("user").annotate(
        delivered=Count("orders", filter=in_range & Q(orders__order_status=S.DELIVERED)),
        failed=Count("orders", filter=in_range & Q(orders__order_status=S.FAILED)),
        in_progress=Count(
            "orders",
            filter=in_range & Q(orders__order_status__in=[S.SCHEDULED, S.OUT_FOR_DELIVERY]),
        ),
        delivered_value=Sum("orders__total_amount", filter=in_range & Q(orders__order_status=S.DELIVERED)),
    )
    rows, totals = [], {"assigned": 0, "delivered": 0, "failed": 0, "in_progress": 0}
    value_total = ZERO
    for rider in riders.order_by("user__first_name", "user__last_name", "id"):
        assigned = rider.delivered + rider.failed + rider.in_progress
        rows.append(
            {
                "rider_id": rider.pk,
                "rider": rider.user.full_name,
                "vehicle_type": rider.vehicle_type,
                "assigned": assigned,
                "delivered": rider.delivered,
                "failed": rider.failed,
                "in_progress": rider.in_progress,
                "delivered_value": money(rider.delivered_value),
            }
        )
        totals["assigned"] += assigned
        totals["delivered"] += rider.delivered
        totals["failed"] += rider.failed
        totals["in_progress"] += rider.in_progress
        value_total += rider.delivered_value or ZERO
    totals["delivered_value"] = money(value_total)
    columns = [
        _col("rider", "Rider"),
        _col("vehicle_type", "Vehicle"),
        _col("assigned", "Assigned", "number"),
        _col("delivered", "Delivered", "number"),
        _col("failed", "Failed", "number"),
        _col("in_progress", "In progress", "number"),
        _col("delivered_value", "Delivered value (PHP)", "money"),
    ]
    return columns, rows, totals


def top_services(date_from, date_to, limit=10):
    found = (
        OrderDetail.objects.filter(
            order__order_status=S.DELIVERED, order__delivery_date__range=(date_from, date_to)
        )
        .values("service_id", "service__service_name")
        .annotate(quantity=Sum("quantity"), orders=Count("order", distinct=True), revenue=Sum("subtotal"))
        .order_by("-quantity", "-revenue", "service__service_name")[:limit]
    )
    rows, quantity, revenue = [], 0, ZERO
    for rank, row in enumerate(found, start=1):
        rows.append(
            {
                "rank": rank,
                "service_id": row["service_id"],
                "service": row["service__service_name"],
                "quantity": row["quantity"],
                "orders": row["orders"],
                "revenue": money(row["revenue"]),
            }
        )
        quantity += row["quantity"]
        revenue += row["revenue"]
    columns = [
        _col("rank", "#", "number"),
        _col("service", "Service"),
        _col("quantity", "Quantity sold", "number"),
        _col("orders", "Orders", "number"),
        _col("revenue", "Revenue (PHP)", "money"),
    ]
    return columns, rows, {"quantity": quantity, "revenue": money(revenue)}


def cash_report(date_from, date_to):
    """Per rider: COD cash collected in the range, cash handed in during the range, and what is
    still held right now (all time, not limited to the range)."""
    collected = {
        r["verified_by__rider_profile"]: r["total"]
        for r in Payment.objects.filter(
            payment_method=Payment.Method.COD,
            payment_status=Payment.Status.PAID,
            verified_by__rider_profile__isnull=False,
            payment_date__date__range=(date_from, date_to),
        )
        .values("verified_by__rider_profile")
        .annotate(total=Sum("amount"))
    }
    remitted = {
        r["rider"]: r["total"]
        for r in CashRemittance.objects.filter(received_at__date__range=(date_from, date_to))
        .values("rider")
        .annotate(total=Sum("amount"))
    }
    held = {
        group["rider"].pk: cash_service.total_held(group["payments"])
        for group in cash_service.held_by_rider()
    }
    rows, totals = [], {"collected": ZERO, "remitted": ZERO, "outstanding": ZERO}
    for rider in RiderProfile.objects.select_related("user").order_by("user__first_name", "user__last_name", "id"):
        row_values = {
            "collected": collected.get(rider.pk) or ZERO,
            "remitted": remitted.get(rider.pk) or ZERO,
            "outstanding": held.get(rider.pk) or ZERO,
        }
        rows.append(
            {"rider_id": rider.pk, "rider": rider.user.full_name, **{k: money(v) for k, v in row_values.items()}}
        )
        for key, value in row_values.items():
            totals[key] += value
    columns = [
        _col("rider", "Rider"),
        _col("collected", "Collected (PHP)", "money"),
        _col("remitted", "Handed in (PHP)", "money"),
        _col("outstanding", "Still held now (PHP)", "money"),
    ]
    return columns, rows, {k: money(v) for k, v in totals.items()}
