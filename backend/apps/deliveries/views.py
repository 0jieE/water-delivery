from django.db import transaction
from django.db.models import ProtectedError, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin, IsRider, IsStaffOrAdmin
from apps.orders import services as order_services
from apps.orders.models import Order
from apps.orders.views import order_queryset

from . import cash
from .models import CashRemittance, RiderProfile
from .serializers import (
    AvailabilitySerializer,
    DeliverySerializer,
    DeliveryStatusSerializer,
    RiderCreateSerializer,
    RiderProfileSerializer,
    RiderUpdateSerializer,
    StartDeliveriesSerializer,
)

ACTIVE_STATUSES = [Order.Status.SCHEDULED, Order.Status.OUT_FOR_DELIVERY]
HISTORY_STATUSES = [Order.Status.DELIVERED, Order.Status.FAILED]
ASSIGNABLE_RIDER_STATUSES = [RiderProfile.Status.AVAILABLE, RiderProfile.Status.ON_DELIVERY]


class RiderViewSet(viewsets.ModelViewSet):
    """Admin: full CRUD. Staff: read-only. For the assignment picker use ?assignable=true."""

    queryset = RiderProfile.objects.select_related("user")
    pagination_class = None
    lookup_value_regex = "[0-9]+"
    filterset_fields = ["status"]
    search_fields = ["user__username", "user__first_name", "user__last_name", "vehicle_type"]
    ordering_fields = ["id", "status", "user__first_name"]

    def get_queryset(self):
        qs = super().get_queryset()
        is_active = self.request.query_params.get("is_active")  # ?is_active=true|false
        if is_active in ("true", "false"):
            qs = qs.filter(user__is_active=(is_active == "true"))
        # ?assignable=true -> active riders who are available or already on a trip (not off duty)
        assignable = self.request.query_params.get("assignable")
        if assignable in ("true", "false"):
            can_take_orders = Q(user__is_active=True, status__in=ASSIGNABLE_RIDER_STATUSES)
            qs = qs.filter(can_take_orders) if assignable == "true" else qs.exclude(can_take_orders)
        return qs

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [IsStaffOrAdmin()]
        return [IsAdmin()]

    def get_serializer_class(self):
        if self.action == "create":
            return RiderCreateSerializer
        if self.action in ("update", "partial_update"):
            return RiderUpdateSerializer
        return RiderProfileSerializer

    def create(self, request, *args, **kwargs):
        serializer = RiderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()
        return Response(RiderProfileSerializer(profile).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        profile = self.get_object()
        serializer = RiderUpdateSerializer(
            profile, data=request.data, partial=kwargs.get("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        profile.refresh_from_db()
        return Response(RiderProfileSerializer(profile).data)

    def destroy(self, request, *args, **kwargs):
        profile = self.get_object()
        try:
            profile.user.delete()  # removes the login account and (by cascade) the profile
        except ProtectedError:
            raise ValidationError(
                "This rider has delivery history and cannot be deleted. Deactivate the rider instead."
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyDeliveryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The signed-in rider's own deliveries. ?scope= active (default) | today | upcoming | history."""

    permission_classes = [IsRider]
    serializer_class = DeliverySerializer
    filter_backends: list = []
    lookup_value_regex = "[0-9]+"

    def get_queryset(self):
        qs = order_queryset().filter(rider__user=self.request.user)
        scope = self.request.query_params.get("scope", "active")
        today = timezone.localdate()
        if scope == "history":
            return qs.filter(order_status__in=HISTORY_STATUSES).order_by("-delivery_date", "-id")
        qs = qs.filter(order_status__in=ACTIVE_STATUSES)
        if scope == "today":  # includes overdue deliveries that were never completed
            qs = qs.filter(delivery_date__lte=today)
        elif scope == "upcoming":
            qs = qs.filter(delivery_date__gt=today)
        elif scope != "active":
            raise ValidationError({"scope": ["Use one of: active, today, upcoming, history."]})
        # deliveries already on the road first ("out_for_delivery" sorts before "scheduled"), then by date
        return qs.order_by("order_status", "delivery_date", "id")

    def _respond(self, order, http_status=status.HTTP_200_OK):
        order = order_queryset().get(pk=order.pk)
        return Response(DeliverySerializer(order, context={"request": self.request}).data, http_status)

    @action(detail=True, methods=["post"], url_path="status", url_name="status")
    def update_status(self, request, pk=None):
        """Rider updates a delivery: out_for_delivery | delivered | failed."""
        order = self.get_object()
        serializer = DeliveryStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        order_services.change_status(
            order,
            data["status"],
            request.user,
            remarks=data.get("remarks", ""),
            cod_collected=data["cod_collected"],
        )
        return self._respond(order)

    @action(detail=False, methods=["get"], url_path="cash", url_name="cash")
    def cash_on_hand(self, request):
        """The rider's own cash balance (COD cash collected and not yet handed in) and recent hand-ins."""
        groups = cash.held_by_rider(RiderProfile.objects.get(user=request.user).pk)
        payments = groups[0]["payments"] if groups else []
        recent = CashRemittance.objects.filter(rider__user=request.user).select_related("received_by")[:10]
        return Response(
            {
                "amount_held": cash.money(cash.total_held(payments)),
                "orders": cash.order_lines(payments),
                "recent_remittances": [
                    {
                        "id": r.pk,
                        "amount": str(r.amount),
                        "received_at": cash.local(r.received_at),
                        "received_by": r.received_by.full_name,
                    }
                    for r in recent
                ],
            }
        )

    @action(detail=False, methods=["post"])
    def start(self, request):
        """Start several scheduled deliveries at once (all or nothing).

        Same effects as calling `status` with out_for_delivery for each order: one status log row
        and one customer notification per order. Any order that is not assigned to this rider or
        not `scheduled` -> 400 naming it, and nothing changes.
        """
        serializer = StartDeliveriesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["orders"]
        with transaction.atomic():
            owned = {o.pk: o for o in Order.objects.filter(pk__in=ids, rider__user=request.user)}
            for order_id in ids:
                order = owned.get(order_id)
                if order is None:  # also covers unknown ids, so nothing leaks about other riders' orders
                    raise ValidationError({"orders": [f"Order #{order_id} is not assigned to you."]})
                if order.order_status != Order.Status.SCHEDULED:
                    raise ValidationError(
                        {
                            "orders": [
                                f"Order #{order_id} cannot be started (it is '{order.order_status}'; "
                                "only scheduled orders can)."
                            ]
                        }
                    )
            for order_id in ids:
                order_services.change_status(owned[order_id], Order.Status.OUT_FOR_DELIVERY, request.user)
        by_id = {o.pk: o for o in order_queryset().filter(pk__in=ids)}
        data = DeliverySerializer([by_id[i] for i in ids], many=True, context={"request": request}).data
        return Response(data)

    @action(detail=False, methods=["post"])
    def availability(self, request):
        """Rider goes available / off duty. Not possible while any delivery is out."""
        serializer = AvailabilitySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            profile = RiderProfile.objects.select_for_update().get(user=request.user)
            if order_services.orders_out_for_delivery(profile).exists():
                raise ValidationError("Finish your current deliveries before changing your availability.")
            profile.status = serializer.validated_data["status"]
            profile.save(update_fields=["status"])
        return Response(RiderProfileSerializer(profile).data)
