from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsCustomer, IsStaffOrAdmin
from apps.deliveries import cash
from apps.deliveries.models import RiderProfile
from apps.payments.models import Payment

from . import services
from .filters import OrderFilter
from .models import Order
from .serializers import (
    AssignRiderSerializer,
    CancelOrderSerializer,
    OrderCreateSerializer,
    OrderSerializer,
    OrderStatusLogSerializer,
    RejectOrderSerializer,
    ScheduleOrderSerializer,
    UpdateStatusSerializer,
)

STAFF_ACTIONS = {
    "confirm",
    "reject",
    "schedule",
    "assign_rider",
    "update_status",
    "dashboard",
}


def order_queryset():
    return Order.objects.select_related(
        "customer", "rider__user", "payment__verified_by", "payment__remittance"
    ).prefetch_related("items__service")


class OrderViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Orders. Every role is scoped to what it may see:

    customer -> own orders, rider -> orders assigned to them, staff/admin -> all.
    Anything outside that scope is a 404.
    """

    lookup_value_regex = "[0-9]+"
    filterset_class = OrderFilter
    ordering_fields = ["order_date", "delivery_date", "total_amount", "id", "order_status"]
    ordering = ["-order_date", "-id"]

    # -- plumbing ---------------------------------------------------------------

    def get_permissions(self):
        if self.action == "create" or self.action == "cancel":
            return [IsCustomer()]
        if self.action in STAFF_ACTIONS:
            return [IsStaffOrAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = order_queryset()
        if user.role == "customer":
            return qs.filter(customer=user)
        if user.role == "rider":
            return qs.filter(rider__user=user)
        if user.role in ("staff", "admin"):
            return qs
        return qs.none()

    def get_serializer_class(self):
        return OrderCreateSerializer if self.action == "create" else OrderSerializer

    def _respond(self, order, http_status=status.HTTP_200_OK):
        order = order_queryset().get(pk=order.pk)
        return Response(OrderSerializer(order, context={"request": self.request}).data, http_status)

    def _input(self, serializer_class):
        serializer = serializer_class(data=self.request.data, context={"request": self.request})
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    # -- customer ---------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = OrderCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        order = serializer.save()
        return self._respond(order, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """Customer cancels their own order (only allowed while it is still pending)."""
        order = self.get_object()
        data = self._input(CancelOrderSerializer)
        services.change_status(
            order, Order.Status.CANCELLED, request.user, remarks=data.get("remarks", "")
        )
        return self._respond(order)

    # -- staff / admin ----------------------------------------------------------

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        order = self.get_object()
        services.change_status(order, Order.Status.CONFIRMED, request.user)
        return self._respond(order)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        order = self.get_object()
        data = self._input(RejectOrderSerializer)
        services.change_status(order, Order.Status.REJECTED, request.user, remarks=data["remarks"])
        return self._respond(order)

    @action(detail=True, methods=["post"])
    def schedule(self, request, pk=None):
        """Set the delivery date (confirmed -> scheduled; also reschedules or retries a failed one)."""
        order = self.get_object()
        data = self._input(ScheduleOrderSerializer)
        with transaction.atomic():
            services.change_status(
                order,
                Order.Status.SCHEDULED,
                request.user,
                remarks=data.get("remarks", ""),
                delivery_date=data["delivery_date"],
            )
            if data.get("rider"):
                services.assign_rider(order, request.user, data["rider"])
        return self._respond(order)

    @action(detail=True, methods=["post"], url_path="assign-rider", url_name="assign-rider")
    def assign_rider(self, request, pk=None):
        order = self.get_object()
        data = self._input(AssignRiderSerializer)
        services.assign_rider(order, request.user, data["rider"])
        return self._respond(order)

    @action(detail=True, methods=["post"], url_path="update-status", url_name="update-status")
    def update_status(self, request, pk=None):
        """Generic staff status change. Rider-only statuses (out_for_delivery, delivered, failed) -> 403."""
        order = self.get_object()
        data = self._input(UpdateStatusSerializer)
        services.change_status(
            order,
            data["status"],
            request.user,
            remarks=data.get("remarks", ""),
            delivery_date=data.get("delivery_date"),
        )
        return self._respond(order)

    @action(detail=False, methods=["get"])
    def dashboard(self, request):
        """Counters for the staff/admin dashboard."""
        today = timezone.localdate()
        counts = dict(
            Order.objects.filter(delivery_date=today)
            .values_list("order_status")
            .annotate(n=Count("id"))
        )
        today_by_status = {value: counts.get(value, 0) for value, _ in Order.Status.choices}
        return Response(
            {
                "date": today,
                "today_by_status": today_by_status,
                "today_total": sum(today_by_status.values()),
                "pending_orders": Order.objects.filter(order_status=Order.Status.PENDING).count(),
                "pending_payments": Payment.objects.filter(
                    payment_status=Payment.Status.PENDING_VERIFICATION
                ).count(),
                "needs_rider": Order.objects.filter(
                    order_status__in=services.RIDER_ASSIGNABLE, rider__isnull=True
                ).count(),
                "cash_outstanding": cash.money(cash.outstanding_total()),
                "available_riders": RiderProfile.objects.filter(
                    status=RiderProfile.Status.AVAILABLE, user__is_active=True
                ).count(),
            }
        )

    # -- shared -----------------------------------------------------------------

    @action(detail=True, methods=["get"])
    def timeline(self, request, pk=None):
        """Status history, oldest first (the customer's tracking timeline)."""
        order = self.get_object()
        logs = order.status_logs.select_related("changed_by")
        return Response(OrderStatusLogSerializer(logs, many=True).data)
