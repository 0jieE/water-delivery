"""Latitude/longitude support shared by orders (delivery pin) and users (saved home location)."""
import math
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from rest_framework import serializers

PRECISION = Decimal("0.000001")  # 6 decimal places is roughly 0.1 m


def latitude_model_field():
    return models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("-90")), MaxValueValidator(Decimal("90"))],
    )


def longitude_model_field():
    return models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("-180")), MaxValueValidator(Decimal("180"))],
    )


class CoordinateField(serializers.FloatField):
    """Optional, nullable number within +-`limit`.

    Map libraries hand back long floats (7.0083333333333), so extra decimals are rounded to
    6 places instead of being rejected.
    """

    def __init__(self, *, limit, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(min_value=-limit, max_value=limit, **kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not math.isfinite(value):  # "nan" / "inf" parse as floats
            self.fail("invalid")
        return Decimal(str(value)).quantize(PRECISION)


def latitude_field(**kwargs):
    return CoordinateField(limit=90, **kwargs)


def longitude_field(**kwargs):
    return CoordinateField(limit=180, **kwargs)


def validate_coordinate_pair(attrs, lat_key, lon_key):
    """Both coordinates or neither. The error lands on the one that is missing/null."""
    lat, lon = attrs.get(lat_key), attrs.get(lon_key)
    if (lat is None) == (lon is None):
        return
    missing, given = (lat_key, lon_key) if lat is None else (lon_key, lat_key)
    raise serializers.ValidationError({missing: [f"Required when {given} is provided."]})
