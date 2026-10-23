"""Data for the admin home page (the dashboard) and the environment badge."""
import datetime
import json

from django.conf import settings
from django.db.models import Count
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone
from django.utils.html import format_html
from django.utils.safestring import mark_safe

from apps.deliveries import cash
from apps.deliveries.models import RiderProfile
from apps.orders.models import Order
from apps.payments.models import Payment
from apps.reports import builders

from .admin_labels import ORDER_STATUS_COLORS


def environment_callback(request):
    """The badge next to the site name: tells production apart from a development copy."""
    return ["Development", "info"] if settings.DEBUG else ["Live", "danger"]


def _label(text, color):
    return mark_safe(render_to_string("unfold/helpers/label.html", {"text": text, "variant": color, "size": "md"}))


def _money(value):
    return f"PHP {value:,.2f}"


def dashboard_callback(request, context):
    today = timezone.localdate()
    orders_url = reverse("admin:orders_order_changelist")
    payments_url = reverse("admin:payments_payment_changelist")

    due_today = Order.objects.filter(delivery_date=today).count()
    pending = Order.objects.filter(order_status=Order.Status.PENDING).count()
    to_verify = Payment.objects.filter(payment_status=Payment.Status.PENDING_VERIFICATION).count()
    on_the_road = Order.objects.filter(order_status=Order.Status.OUT_FOR_DELIVERY).count()
    held_groups = cash.held_by_rider()
    held_total = cash.outstanding_total()
    riders = dict(RiderProfile.objects.values_list("status").annotate(n=Count("id")))

    week_start = today - datetime.timedelta(days=6)
    _, week_rows, week_totals = builders.sales_daily(week_start, today)

    # sales for the last 14 days as a bar chart
    _, chart_rows, _ = builders.sales_daily(today - datetime.timedelta(days=13), today)
    chart = {
        "labels": [datetime.date.fromisoformat(r["period"]).strftime("%b %d") for r in chart_rows],
        "datasets": [
            {
                "label": "Sales (PHP)",
                "data": [float(r["total_sales"]) for r in chart_rows],
                "backgroundColor": "var(--color-primary-600)",
                "borderRadius": 4,
            }
        ],
    }

    recent = Order.objects.select_related("customer").order_by("-order_date", "-id")[:8]
    recent_table = {
        "headers": ["Order", "Customer", "Status", "Delivery date", "Total"],
        "rows": [
            [
                format_html('<a class="font-semibold text-primary-600" href="{}">#{}</a>', reverse("admin:orders_order_change", args=[o.pk]), o.pk),
                o.customer.full_name,
                _label(o.get_order_status_display(), ORDER_STATUS_COLORS.get(o.order_status, "base")),
                o.delivery_date.strftime("%b %d, %Y"),
                _money(o.total_amount),
            ]
            for o in recent
        ],
    }
    cash_table = {
        "headers": ["Rider", "Orders", "Cash held"],
        "rows": [
            [g["name"], len(g["payments"]), _money(cash.total_held(g["payments"]))]
            for g in sorted(held_groups, key=lambda g: -cash.total_held(g["payments"]))
        ],
    }

    context.update(
        {
            "kpis": [
                {"title": "Orders due today", "value": due_today, "icon": "local_shipping", "href": orders_url, "hint": f"{on_the_road} on the road now"},
                {"title": "Waiting for confirmation", "value": pending, "icon": "pending_actions", "href": f"{orders_url}?order_status__exact=pending", "hint": "pending orders"},
                {"title": "Payments to verify", "value": to_verify, "icon": "fact_check", "href": f"{payments_url}?payment_status__exact=pending_verification", "hint": "proofs waiting for staff"},
                {"title": "Cash held by riders", "value": _money(held_total), "icon": "savings", "href": reverse("admin:deliveries_cashremittance_changelist"), "hint": f"{len(held_groups)} rider(s) to hand in"},
                {"title": "Riders available", "value": riders.get("available", 0), "icon": "two_wheeler", "href": reverse("admin:deliveries_riderprofile_changelist"), "hint": f"{riders.get('on_delivery', 0)} on delivery, {riders.get('off_duty', 0)} off duty"},
                {"title": "Sales, last 7 days", "value": _money(float(week_totals["total_sales"])), "icon": "trending_up", "href": orders_url, "hint": f"{week_totals['orders']} delivered orders"},
            ],
            "sales_chart": json.dumps(chart),
            "recent_orders_table": recent_table,
            "cash_table": cash_table,
        }
    )
    return context
