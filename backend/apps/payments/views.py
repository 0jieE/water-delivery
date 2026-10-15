import django_filters
from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdmin, IsCustomer, IsStaffOrAdmin
from apps.core.filters import IdFilter, search_id

from . import services
from .models import Payment, PaymentSettings
from .serializers import (
    PaymentDetailSerializer,
    PaymentSettingsSerializer,
    RejectPaymentSerializer,
    UploadProofSerializer,
)


class PaymentFilter(django_filters.FilterSet):
    order = IdFilter(field_name="order_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    search = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = Payment
        fields = ["payment_status", "payment_method"]

    def filter_search(self, queryset, name, value):
        for term in value.split():
            q = (
                Q(reference_number__icontains=term)
                | Q(order__customer__username__icontains=term)
                | Q(order__customer__first_name__icontains=term)
                | Q(order__customer__last_name__icontains=term)
            )
            order_id = search_id(term)
            if order_id is not None:
                q |= Q(order_id=order_id)
            queryset = queryset.filter(q)
        return queryset


class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Customers see their own payments; staff/admin see all (the verification queue is
    GET /payments/?payment_status=pending_verification). Riders have no access."""

    serializer_class = PaymentDetailSerializer
    filterset_class = PaymentFilter
    ordering_fields = ["created_at", "amount", "id"]
    lookup_value_regex = "[0-9]+"

    def get_permissions(self):
        if self.action == "upload_proof":
            return [IsCustomer()]
        if self.action in ("verify", "reject"):
            return [IsStaffOrAdmin()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = Payment.objects.select_related("order__customer", "verified_by", "remittance")
        user = self.request.user
        if user.role == "customer":
            return qs.filter(order__customer=user)
        if user.role in ("staff", "admin"):
            return qs
        return qs.none()  # riders never see payment records

    def _respond(self, payment):
        payment = self.get_queryset().get(pk=payment.pk)
        return Response(self.get_serializer(payment).data)

    @action(
        detail=True,
        methods=["post"],
        url_path="upload-proof",
        url_name="upload-proof",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_proof(self, request, pk=None):
        """multipart/form-data: proof_image (file) + reference_number."""
        payment = self.get_object()
        serializer = UploadProofSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.upload_proof(
            payment,
            request.user,
            serializer.validated_data["proof_image"],
            serializer.validated_data["reference_number"],
        )
        return self._respond(payment)

    @action(detail=True, methods=["post"])
    def verify(self, request, pk=None):
        payment = self.get_object()
        services.verify(payment, request.user)
        return self._respond(payment)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        payment = self.get_object()
        serializer = RejectPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reject(payment, request.user, serializer.validated_data["remarks"])
        return self._respond(payment)


class PaymentSettingsView(APIView):
    """GET: any signed-in user (customers need the QR at checkout). PATCH: admin only."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_permissions(self):
        return [IsAdmin()] if self.request.method == "PATCH" else [IsAuthenticated()]

    def get(self, request):
        return Response(PaymentSettingsSerializer(PaymentSettings.load(), context={"request": request}).data)

    def patch(self, request):
        serializer = PaymentSettingsSerializer(
            PaymentSettings.load(), data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
