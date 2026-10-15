from rest_framework import serializers

from .models import WaterRefillService


class WaterRefillServiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = WaterRefillService
        fields = (
            "id",
            "service_name",
            "description",
            "price",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
