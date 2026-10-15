from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.core.coordinates import latitude_field, longitude_field, validate_coordinate_pair

User = get_user_model()


def unique_email(value, exclude_pk=None):
    value = (value or "").strip()
    if value:
        qs = User.objects.filter(email__iexact=value)
        if exclude_pk:
            qs = qs.exclude(pk=exclude_pk)
        if qs.exists():
            raise serializers.ValidationError("A user with this email already exists.")
    return value


def password_errors(password, user):
    """Run Django's password validators; return the list of messages (empty if fine)."""
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        return list(exc.messages)
    return []


class RiderProfileBriefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    vehicle_type = serializers.CharField()
    status = serializers.CharField()


class UserSerializer(serializers.ModelSerializer):
    """Read representation used by /me, /register and admin user endpoints."""

    full_name = serializers.CharField(read_only=True)
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6, coerce_to_string=False, read_only=True)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6, coerce_to_string=False, read_only=True)
    rider_profile = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "full_name",
            "role",
            "contact_number",
            "address",
            "latitude",
            "longitude",
            "is_active",
            "created_at",
            "rider_profile",
        )
        read_only_fields = fields

    def get_rider_profile(self, obj):
        profile = getattr(obj, "rider_profile", None) if obj.role == User.Role.RIDER else None
        return RiderProfileBriefSerializer(profile).data if profile else None


class UserBriefSerializer(serializers.ModelSerializer):
    """Small embeddable user (used inside orders, timelines, notifications)."""

    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "username", "full_name", "role", "contact_number", "email", "address")
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    latitude = latitude_field()
    longitude = longitude_field()

    class Meta:
        model = User
        fields = (
            "username",
            "password",
            "email",
            "first_name",
            "last_name",
            "contact_number",
            "address",
            "latitude",
            "longitude",
        )
        extra_kwargs = {
            "email": {"required": True, "allow_blank": False},
            "first_name": {"required": True, "allow_blank": False},
            "last_name": {"required": True, "allow_blank": False},
            "contact_number": {"required": True, "allow_blank": False},
        }

    def validate_email(self, value):
        return unique_email(value)

    def validate(self, attrs):
        validate_coordinate_pair(attrs, "latitude", "longitude")
        return attrs

    def validate_password(self, value):
        data = self.initial_data
        candidate = User(
            username=data.get("username", ""),
            email=data.get("email", ""),
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
        )
        errors = password_errors(value, candidate)
        if errors:
            raise serializers.ValidationError(errors)
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        return User.objects.create_user(role=User.Role.CUSTOMER, password=password, **validated_data)


class MeUpdateSerializer(serializers.ModelSerializer):
    latitude = latitude_field()
    longitude = longitude_field()

    class Meta:
        model = User
        fields = ("first_name", "last_name", "email", "contact_number", "address", "latitude", "longitude")

    def validate(self, attrs):
        # A PATCH that touches one coordinate must send both (send both as null to clear the pin).
        validate_coordinate_pair(attrs, "latitude", "longitude")
        return attrs

    def validate_email(self, value):
        return unique_email(value, exclude_pk=self.instance.pk)


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_old_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        errors = password_errors(value, self.context["request"].user)
        if errors:
            raise serializers.ValidationError(errors)
        return value


class AdminUserSerializer(serializers.ModelSerializer):
    """Admin create/update. `password` is required on create, optional on update."""

    password = serializers.CharField(
        write_only=True, required=False, style={"input_type": "password"}
    )

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "password",
            "email",
            "first_name",
            "last_name",
            "role",
            "contact_number",
            "address",
            "is_active",
        )

    def validate_email(self, value):
        return unique_email(value, exclude_pk=self.instance.pk if self.instance else None)

    def validate(self, attrs):
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": ["This field is required."]})
        if attrs.get("password"):
            candidate = self.instance or User(
                **{k: v for k, v in attrs.items() if k != "password"}
            )
            errors = password_errors(attrs["password"], candidate)
            if errors:
                raise serializers.ValidationError({"password": errors})
        request = self.context.get("request")
        if self.instance is not None and request is not None and self.instance.pk == request.user.pk:
            if attrs.get("is_active") is False:
                raise serializers.ValidationError({"is_active": ["You cannot deactivate yourself."]})
            if "role" in attrs and attrs["role"] != self.instance.role:
                raise serializers.ValidationError({"role": ["You cannot change your own role."]})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        return User.objects.create_user(password=password, **validated_data)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance

    def to_representation(self, instance):
        return UserSerializer(instance, context=self.context).data


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """JWT carries role/name so the frontend can route right after login."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["name"] = user.full_name
        token["username"] = user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user, context=self.context).data
        return data
