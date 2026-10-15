import django_filters
from django.db.models import Prefetch
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsStaffOrAdmin
from apps.core.filters import MAX_ID, IdFilter
from apps.payments.models import Payment

from . import cash
from .models import CashRemittance
from .serializers import CashRemittanceSerializer, RemitCashSerializer


class CashHeldView(APIView):
    """Riders currently holding COD cash (riders holding nothing are left out). ?rider=<RiderProfile id>"""

    permission_classes = [IsStaffOrAdmin]

    def get(self, request):
        rider_id = request.query_params.get("rider")
        if rider_id is not None:
            field = serializers.IntegerField(min_value=1, max_value=MAX_ID)
            try:
                rider_id = field.run_validation(rider_id)
            except serializers.ValidationError as exc:
                raise ValidationError({"rider": exc.detail})

        rows = []
        for group in cash.held_by_rider(rider_id):
            payments = group["payments"]
            profile = group["rider"]
            rows.append(
                {
                    "rider": {
                        "id": profile.pk,
                        "full_name": group["name"],
                        "vehicle_type": profile.vehicle_type,
                    },
                    "orders_count": len(payments),
                    "amount_held": cash.money(cash.total_held(payments)),
                    "oldest_collected_at": cash.collected_at(payments[0]),
                    "orders": cash.order_lines(payments),
                }
            )
        rows.sort(key=lambda row: (-float(row["amount_held"]), row["rider"]["id"]))
        return Response(rows)


class RemitCashView(APIView):
    """Take cash in from a rider. Staff/admin. The amount is computed from the payments."""

    permission_classes = [IsStaffOrAdmin]

    def post(self, request):
        serializer = RemitCashSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        remittance = cash.remit(
            request.user, data["rider"], data.get("orders"), data.get("remarks", "")
        )
        remittance = remittance_queryset().get(pk=remittance.pk)
        return Response(CashRemittanceSerializer(remittance).data, status=status.HTTP_201_CREATED)


def remittance_queryset():
    return CashRemittance.objects.select_related("rider__user", "received_by").prefetch_related(
        Prefetch("payments", queryset=Payment.objects.only("id", "order_id", "amount", "remittance_id"))
    )


class RemittanceFilter(django_filters.FilterSet):
    rider = IdFilter(field_name="rider_id")
    date_from = django_filters.DateFilter(field_name="received_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="received_at", lookup_expr="date__lte")

    class Meta:
        model = CashRemittance
        fields: list[str] = []


class RemittanceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Remittance history. Read-only on purpose: a remittance is never edited or deleted."""

    permission_classes = [IsStaffOrAdmin]
    serializer_class = CashRemittanceSerializer
    filterset_class = RemittanceFilter
    ordering_fields = ["received_at", "amount", "id"]
    ordering = ["-received_at", "-id"]
    lookup_value_regex = "[0-9]+"

    def get_queryset(self):
        return remittance_queryset()
