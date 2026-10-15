import re

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Payment, PaymentSettings


class PaymentSerializer(serializers.ModelSerializer):
    """Payment as embedded inside an order."""

    payment_method_display = serializers.CharField(
        source="get_payment_method_display", read_only=True
    )
    payment_status_display = serializers.CharField(
        source="get_payment_status_display", read_only=True
    )
    verified_by = serializers.SerializerMethodField()
    remitted_at = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id",
            "order",
            "payment_method",
            "payment_method_display",
            "payment_status",
            "payment_status_display",
            "reference_number",
            "proof_image",
            "amount",
            "payment_date",
            "verified_by",
            "remarks",
            "remittance",
            "remitted_at",
            "created_at",
        )
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        if request is None or request.user.role not in ("staff", "admin"):
            # cash-handling details are for staff and admin only
            data.pop("remittance", None)
            data.pop("remitted_at", None)
        return data

    def get_remitted_at(self, obj):
        return timezone.localtime(obj.remittance.received_at) if obj.remittance_id else None

    def get_verified_by(self, obj):
        user = obj.verified_by
        return {"id": user.pk, "full_name": user.full_name} if user else None


class PaymentDetailSerializer(PaymentSerializer):
    """Payment with a summary of its order - used by the /payments/ endpoints."""

    order_summary = serializers.SerializerMethodField()

    class Meta(PaymentSerializer.Meta):
        fields = PaymentSerializer.Meta.fields + ("order_summary",)
        read_only_fields = fields

    def get_order_summary(self, obj):
        order = obj.order
        return {
            "id": order.pk,
            "customer_id": order.customer_id,
            "customer_name": order.customer.full_name,
            "order_status": order.order_status,
            "delivery_date": order.delivery_date,
            "total_amount": str(order.total_amount),
        }


def check_image_size(value):
    """Same limit for payment proofs and the GCash QR image (settings.MAX_PROOF_IMAGE_BYTES)."""
    if value is not None and value.size > settings.MAX_PROOF_IMAGE_BYTES:
        limit_mb = settings.MAX_PROOF_IMAGE_BYTES // (1024 * 1024)
        raise serializers.ValidationError(f"Image is too large (max {limit_mb} MB).")
    return value


class UploadProofSerializer(serializers.Serializer):
    proof_image = serializers.ImageField()
    reference_number = serializers.CharField(max_length=100)

    def validate_proof_image(self, value):
        return check_image_size(value)


class RejectPaymentSerializer(serializers.Serializer):
    remarks = serializers.CharField(max_length=500)


PHONE_CHARS = re.compile(r"^[0-9+()\-\s]*$")


class PaymentSettingsSerializer(serializers.ModelSerializer):
    """The station's GCash details. `gcash_qr_image` is an absolute URL or null.

    On write: a new file replaces the old one; an empty value (multipart) or null (JSON) removes it.
    """

    gcash_qr_image = serializers.ImageField(required=False, allow_null=True)

    class Meta:
        model = PaymentSettings
        fields = ("gcash_qr_image", "gcash_account_name", "gcash_number")

    def validate_gcash_qr_image(self, value):
        return check_image_size(value)

    def validate_gcash_number(self, value):
        value = value.strip()
        if not PHONE_CHARS.match(value):
            raise serializers.ValidationError("Use digits, spaces, + - ( ) only.")
        return value

    def validate_gcash_account_name(self, value):
        return value.strip()

    def update(self, instance, validated_data):
        replacing_image = "gcash_qr_image" in validated_data
        old_name = instance.gcash_qr_image.name if replacing_image else None
        instance = super().update(instance, validated_data)
        # drop the previous file only after the new state is saved
        if old_name and old_name != instance.gcash_qr_image.name:
            instance.gcash_qr_image.storage.delete(old_name)
        return instance
