from rest_framework import serializers

from apps.accounts.serializers import UserBriefSerializer
from apps.catalog.models import WaterRefillService
from apps.core.coordinates import latitude_field, longitude_field, validate_coordinate_pair
from apps.deliveries.models import RiderProfile
from apps.payments.models import ACCEPTED_METHODS
from apps.payments.serializers import PaymentSerializer

from . import services
from .models import Order, OrderDetail, OrderStatusLog

MAX_LINE_ITEMS = 20
MAX_QUANTITY = 500


class RiderBriefSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(source="user.full_name", read_only=True)
    contact_number = serializers.CharField(source="user.contact_number", read_only=True)

    class Meta:
        model = RiderProfile
        fields = ("id", "user_id", "full_name", "contact_number", "vehicle_type", "status")
        read_only_fields = fields


class OrderDetailSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source="service.service_name", read_only=True)

    class Meta:
        model = OrderDetail
        fields = ("id", "service", "service_name", "quantity", "unit_price", "subtotal")
        read_only_fields = fields


class OrderSerializer(serializers.ModelSerializer):
    customer = UserBriefSerializer(read_only=True)
    rider = RiderBriefSerializer(read_only=True)
    items = OrderDetailSerializer(many=True, read_only=True)
    payment = PaymentSerializer(read_only=True)
    order_status_display = serializers.CharField(source="get_order_status_display", read_only=True)
    # numbers (not strings) so a map can use them directly; null when the customer set no pin
    delivery_latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, coerce_to_string=False, read_only=True
    )
    delivery_longitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, coerce_to_string=False, read_only=True
    )
    allowed_transitions = serializers.SerializerMethodField()
    can_assign_rider = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id",
            "customer",
            "rider",
            "order_date",
            "delivery_date",
            "delivery_address",
            "delivery_latitude",
            "delivery_longitude",
            "notes",
            "total_amount",
            "order_status",
            "order_status_display",
            "items",
            "payment",
            "allowed_transitions",
            "can_assign_rider",
            "updated_at",
        )
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if self.context["request"].user.role == "rider":
            # Riders get what they need to deliver and collect, not contact email or payment proof.
            data["customer"].pop("email", None)
            if data.get("payment"):
                for key in ("proof_image", "reference_number", "verified_by", "remarks"):
                    data["payment"].pop(key, None)
        return data

    def get_allowed_transitions(self, obj):
        return services.allowed_transitions(obj, self.context["request"].user)

    def get_can_assign_rider(self, obj):
        return services.can_assign_rider(obj, self.context["request"].user)


class OrderItemInputSerializer(serializers.Serializer):
    service = serializers.PrimaryKeyRelatedField(queryset=WaterRefillService.objects.all())
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QUANTITY)

    def validate_service(self, value):
        if not value.is_active:
            raise serializers.ValidationError("This service is not available.")
        return value


class OrderCreateSerializer(serializers.Serializer):
    items = OrderItemInputSerializer(many=True, allow_empty=False)
    delivery_date = serializers.DateField()
    delivery_address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    delivery_latitude = latitude_field()
    delivery_longitude = longitude_field()
    notes = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    payment_method = serializers.ChoiceField(choices=ACCEPTED_METHODS)

    def validate_items(self, value):
        if len(value) > MAX_LINE_ITEMS:
            raise serializers.ValidationError(f"An order can have at most {MAX_LINE_ITEMS} items.")
        return value

    def validate_delivery_date(self, value):
        error = services.past_date_error(value)
        if error:
            raise serializers.ValidationError(error)
        return value

    def validate(self, attrs):
        validate_coordinate_pair(attrs, "delivery_latitude", "delivery_longitude")
        address = (attrs.get("delivery_address") or "").strip() or self.context["request"].user.address
        if not address:
            raise serializers.ValidationError(
                {"delivery_address": ["Delivery address is required (or set one on your profile)."]}
            )
        attrs["delivery_address"] = address

        # Same service listed twice -> one line with the summed quantity.
        merged = {}
        for item in attrs["items"]:
            service = item["service"]
            merged[service.pk] = (service, merged.get(service.pk, (service, 0))[1] + item["quantity"])
        too_many = [s.service_name for s, qty in merged.values() if qty > MAX_QUANTITY]
        if too_many:
            raise serializers.ValidationError(
                {"items": [f"Quantity for {too_many[0]} exceeds {MAX_QUANTITY}."]}
            )
        attrs["items"] = list(merged.values())
        attrs.setdefault("notes", "")
        attrs.setdefault("delivery_latitude", None)
        attrs.setdefault("delivery_longitude", None)
        return attrs

    def create(self, validated_data):
        return services.create_order(self.context["request"].user, **validated_data)


class CancelOrderSerializer(serializers.Serializer):
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=500)


class RejectOrderSerializer(serializers.Serializer):
    remarks = serializers.CharField(max_length=500)


class ScheduleOrderSerializer(serializers.Serializer):
    delivery_date = serializers.DateField()
    rider = serializers.PrimaryKeyRelatedField(
        queryset=RiderProfile.objects.select_related("user"), required=False, allow_null=True
    )
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=500)


class AssignRiderSerializer(serializers.Serializer):
    rider = serializers.PrimaryKeyRelatedField(queryset=RiderProfile.objects.select_related("user"))


class UpdateStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Order.Status.choices)
    remarks = serializers.CharField(required=False, allow_blank=True, max_length=500)
    delivery_date = serializers.DateField(required=False)
    cod_collected = serializers.BooleanField(required=False, default=False)


class OrderStatusLogSerializer(serializers.ModelSerializer):
    changed_by = serializers.SerializerMethodField()
    from_status_display = serializers.CharField(source="get_from_status_display", read_only=True)
    to_status_display = serializers.CharField(source="get_to_status_display", read_only=True)

    class Meta:
        model = OrderStatusLog
        fields = (
            "id",
            "from_status",
            "from_status_display",
            "to_status",
            "to_status_display",
            "changed_by",
            "remarks",
            "created_at",
        )
        read_only_fields = fields

    def get_changed_by(self, obj):
        user = obj.changed_by
        return {"id": user.pk, "full_name": user.full_name, "role": user.role} if user else None
