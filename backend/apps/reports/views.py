import datetime

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin

from . import builders, exports

DELIVERED_NOTE = "Counts delivered orders only, by delivery date."
DELIVERY_DATE_NOTE = "Orders are grouped by delivery date."

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _parse_date(request, name, default):
    raw = request.query_params.get(name)
    if not raw:
        return default
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({name: ["Use the format YYYY-MM-DD."]})


class BaseReportView(APIView):
    """Admin-only report. ?date_from=&date_to=YYYY-MM-DD and ?format=json (default) | pdf | xlsx."""

    permission_classes = [IsAdmin]
    key = ""
    title = ""
    note = ""
    max_days = 3660

    def default_from(self, today):
        return today - datetime.timedelta(days=29)

    def build(self, request, date_from, date_to):
        raise NotImplementedError

    def get(self, request):
        fmt = request.query_params.get("format", "json").lower()
        if fmt not in ("json", "pdf", "xlsx"):
            raise ValidationError({"format": ["Use one of: json, pdf, xlsx."]})

        today = timezone.localdate()
        date_to = _parse_date(request, "date_to", today)
        date_from = _parse_date(request, "date_from", self.default_from(date_to))
        if date_from > date_to:
            raise ValidationError({"date_from": ["date_from must not be after date_to."]})
        if (date_to - date_from).days > self.max_days:
            raise ValidationError({"date_to": [f"The range can be at most {self.max_days} days."]})

        columns, rows, totals = self.build(request, date_from, date_to)
        report = {
            "report": self.key,
            "title": self.title,
            "note": self.note,
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "generated_at": timezone.localtime().strftime("%Y-%m-%d %H:%M"),
            "columns": columns,
            "rows": rows,
            "totals": totals,
        }
        if fmt == "json":
            return Response(report)

        filename = f"{self.key}_{report['date_from']}_to_{report['date_to']}"
        if fmt == "xlsx":
            response = HttpResponse(exports.to_xlsx(report), content_type=XLSX_TYPE)
        else:
            response = HttpResponse(exports.to_pdf(report), content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}.{fmt}"'
        return response


class DailySalesView(BaseReportView):
    key = "sales_daily"
    title = "Daily Sales"
    note = DELIVERED_NOTE
    max_days = 366

    def build(self, request, date_from, date_to):
        return builders.sales_daily(date_from, date_to)


class MonthlySalesView(BaseReportView):
    key = "sales_monthly"
    title = "Monthly Sales"
    note = DELIVERED_NOTE

    def default_from(self, today):
        year, month = today.year, today.month - 11
        if month < 1:
            year, month = year - 1, month + 12
        return datetime.date(year, month, 1)

    def build(self, request, date_from, date_to):
        return builders.sales_monthly(date_from, date_to)


class OrdersByStatusView(BaseReportView):
    key = "orders_by_status"
    title = "Orders by Status"
    note = DELIVERY_DATE_NOTE

    def build(self, request, date_from, date_to):
        return builders.orders_by_status(date_from, date_to)


class DeliveriesPerRiderView(BaseReportView):
    key = "deliveries_per_rider"
    title = "Deliveries per Rider"
    note = DELIVERY_DATE_NOTE

    def build(self, request, date_from, date_to):
        return builders.deliveries_per_rider(date_from, date_to)


class CashReportView(BaseReportView):
    key = "cash"
    title = "Cash Remittance"
    note = (
        "COD cash collected by riders and handed in to staff within the period; "
        "'Still held now' is what riders hold today, regardless of the period."
    )

    def build(self, request, date_from, date_to):
        return builders.cash_report(date_from, date_to)


class TopServicesView(BaseReportView):
    key = "top_services"
    title = "Top Services"
    note = DELIVERED_NOTE + " Add ?limit=N (1-50, default 10)."

    def build(self, request, date_from, date_to):
        raw = request.query_params.get("limit", "10")
        if not raw.isdigit() or not 1 <= int(raw) <= 50:
            raise ValidationError({"limit": ["Use a whole number from 1 to 50."]})
        return builders.top_services(date_from, date_to, limit=int(raw))
