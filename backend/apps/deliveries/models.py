from django.conf import settings
from django.db import models
from django.utils import timezone


class RiderProfile(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        ON_DELIVERY = "on_delivery", "On delivery"
        OFF_DUTY = "off_duty", "Off duty"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="rider_profile",
        limit_choices_to={"role": "rider"},
    )
    vehicle_type = models.CharField(max_length=50, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["user__first_name", "user__last_name", "id"]

    def __str__(self):
        return f"{self.user.full_name} [{self.status}]"


class CashRemittance(models.Model):
    """Cash a rider handed in to staff. Created once by the server; never edited or deleted."""

    rider = models.ForeignKey(RiderProfile, on_delete=models.PROTECT, related_name="remittances")
    amount = models.DecimalField(max_digits=10, decimal_places=2)  # always computed by the server
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="cash_received"
    )
    received_at = models.DateTimeField(default=timezone.now)
    remarks = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at", "-id"]

    def __str__(self):
        return f"PHP {self.amount} from {self.rider} on {self.received_at:%Y-%m-%d}"
