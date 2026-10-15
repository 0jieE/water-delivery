from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.accounts.serializers import password_errors, unique_email
from apps.core.filters import MAX_ID
from apps.orders.models import Order
from apps.orders.serializers import OrderSerializer
from apps.orders.services import orders_out_for_delivery
from apps.payments.models import Payment

from .models import CashRemittance, RiderProfile

User = get_user_model()


class RiderProfileSerializer(serializers.ModelSerializer):
    """Read representation of a rider."""

    username = serializers.CharField(source="user.username", read_only=True)
    user_id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    email = serializers.CharField(source="user.email", read_only=True)
    contact_number = serializers.CharField(source="user.contact_number", read_only=True)
    is_active = serializers.BooleanField(source="user.is_active", read_only=True)

    class Meta:
        model = RiderProfile
        fields = (
            "id",
            "user_id",
            "username",
            "full_name",
            "first_name",
            "last_name",
            "email",
            "contact_number",
            "is_active",
            "vehicle_type",
            "status",
            "created_at",
        )
        read_only_fields = fields


class RiderCreateSerializer(serializers.Serializer):
    """Creates the rider's login account and profile in one call."""

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    contact_number = serializers.CharField(max_length=20)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    vehicle_type = serializers.CharField(max_length=50, required=False, allow_blank=True)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with that username already exists.")
        return value

    def validate_email(self, value):
        return unique_email(value)

    def validate_password(self, value):
        data = self.initial_data
        candidate = User(
            username=data.get("username", ""),
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
        )
        errors = password_errors(value, candidate)
        if errors:
            raise serializers.ValidationError(errors)
        return value

    def create(self, validated_data):
        vehicle_type = validated_data.pop("vehicle_type", "")
        password = validated_data.pop("password")
        user = User.objects.create_user(role=User.Role.RIDER, password=password, **validated_data)
        profile = user.rider_profile  # created by the post_save signal
        profile.vehicle_type = vehicle_type
        profile.save(update_fields=["vehicle_type"])
        return profile


class RiderUpdateSerializer(serializers.Serializer):
    vehicle_type = serializers.CharField(max_length=50, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=RiderProfile.Status.choices, required=False)
    is_active = serializers.BooleanField(required=False)

    def validate_status(self, value):
        if value == RiderProfile.Status.ON_DELIVERY:
            raise serializers.ValidationError(
                "'on_delivery' is set automatically when a delivery starts."
            )
        if value == RiderProfile.Status.OFF_DUTY and orders_out_for_delivery(self.instance).exists():
            raise serializers.ValidationError(
                "This rider has orders out for delivery and cannot be set off duty yet."
            )
        return value

    def update(self, instance, validated_data):
        is_active = validated_data.pop("is_active", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if is_active is not None and instance.user.is_active != is_active:
            instance.user.is_active = is_active
            instance.user.save(update_fields=["is_active"])
        return instance


class DeliverySerializer(OrderSerializer):
    """An order as the assigned rider sees it."""

    amount_to_collect = serializers.SerializerMethodField()
    rider_status = serializers.CharField(source="rider.status", read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = OrderSerializer.Meta.fields + ("amount_to_collect", "rider_status")
        read_only_fields = fields

    def get_amount_to_collect(self, obj):
        payment = obj.payment
        if payment.payment_method == Payment.Method.COD and payment.payment_status != Payment.Status.PAID:
            return str(obj.total_amount)
        return "0.00"


class DeliveryStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            (Order.Status.OUT_FOR_DELIVERY.value, "Out for delivery"),
            (Order.Status.DELIVERED.value, "Delivered"),
            (Order.Status.FAILED.value, "Failed"),
        ]
    )
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=500)
    cod_collected = serializers.BooleanField(required=False, default=False)


class AvailabilitySerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            (RiderProfile.Status.AVAILABLE.value, "Available"),
            (RiderProfile.Status.OFF_DUTY.value, "Off duty"),
        ]
    )


class StartDeliveriesSerializer(serializers.Serializer):
    """Order ids to start in one go. Repeated ids are ignored; the first occurrence sets the order."""

    orders = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=MAX_ID),
        allow_empty=False,
        max_length=50,
    )

    def validate_orders(self, value):
        return list(dict.fromkeys(value))


class CashRemittanceSerializer(serializers.ModelSerializer):
    rider = serializers.SerializerMethodField()
    received_by = serializers.SerializerMethodField()
    orders = serializers.SerializerMethodField()

    class Meta:
        model = CashRemittance
        fields = ("id", "rider", "amount", "orders", "received_by", "received_at", "remarks")
        read_only_fields = fields

    def get_rider(self, obj):
        return {"id": obj.rider_id, "full_name": obj.rider.user.full_name}

    def get_received_by(self, obj):
        return {"id": obj.received_by_id, "full_name": obj.received_by.full_name}

    def get_orders(self, obj):
        payments = sorted(obj.payments.all(), key=lambda p: p.order_id)
        return [{"order_id": p.order_id, "amount": str(p.amount)} for p in payments]


class RemitCashSerializer(serializers.Serializer):
    """Which rider's cash to take in. The amount is never accepted: the server sums the payments."""

    rider = serializers.PrimaryKeyRelatedField(queryset=RiderProfile.objects.select_related("user"))
    orders = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=MAX_ID),
        required=False,
        allow_empty=False,
        max_length=500,
    )
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate_orders(self, value):
        return list(dict.fromkeys(value))
