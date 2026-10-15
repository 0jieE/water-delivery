import os
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


def proof_upload_path(instance, filename):
    # Random name: proof images are served from /media/, so the URL must not be guessable.
    extension = os.path.splitext(filename)[1].lower()
    return f"payment_proofs/{uuid.uuid4().hex}{extension}"


def qr_upload_path(instance, filename):
    extension = os.path.splitext(filename)[1].lower()
    return f"payment_settings/{uuid.uuid4().hex}{extension}"


class Payment(models.Model):
    class Method(models.TextChoices):
        COD = "cod", "Cash on delivery"
        GCASH = "gcash", "GCash"
        # Retired: new orders cannot use it (see ACCEPTED_METHODS) but old rows still read and filter.
        BANK_TRANSFER = "bank_transfer", "Bank transfer"

    class Status(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PENDING_VERIFICATION = "pending_verification", "Pending verification"
        PAID = "paid", "Paid"
        REJECTED = "rejected", "Rejected"

    order = models.OneToOneField("orders.Order", on_delete=models.CASCADE, related_name="payment")
    payment_method = models.CharField(max_length=20, choices=Method.choices)
    payment_status = models.CharField(
        max_length=24, choices=Status.choices, default=Status.UNPAID, db_index=True
    )
    reference_number = models.CharField(max_length=100, blank=True)
    proof_image = models.ImageField(upload_to=proof_upload_path, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    payment_date = models.DateTimeField(null=True, blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verified_payments",
    )
    remarks = models.TextField(blank=True)  # e.g. why a payment was rejected
    # Set when a rider hands the cash of this COD payment in to staff (see deliveries.CashRemittance).
    remittance = models.ForeignKey(
        "deliveries.CashRemittance",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="payments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            # Online payments need a proof image as soon as they are submitted or accepted.
            models.CheckConstraint(
                condition=Q(payment_method="cod")
                | Q(payment_status__in=["unpaid", "rejected"])
                | ~Q(proof_image=""),
                name="payment_online_requires_proof",
            )
        ]

    def __str__(self):
        return f"Payment for order {self.order_id}: {self.payment_status}"


# What a customer may choose for a NEW order.
ACCEPTED_METHODS = [
    (Payment.Method.COD.value, Payment.Method.COD.label),
    (Payment.Method.GCASH.value, Payment.Method.GCASH.label),
]


class PaymentSettings(models.Model):
    """The station's GCash details shown at checkout. Exactly one row (pk=1), created by a migration."""

    gcash_qr_image = models.ImageField(upload_to=qr_upload_path, null=True, blank=True)
    gcash_account_name = models.CharField(max_length=100, blank=True)
    gcash_number = models.CharField(max_length=20, blank=True)  # fallback when the QR cannot be scanned
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "payment settings"

    def save(self, *args, **kwargs):
        self.pk = 1  # single record
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        """The one settings row; recreated empty if it was ever deleted, so it is never 'not found'."""
        settings_row, _ = cls.objects.get_or_create(pk=1)
        return settings_row

    def __str__(self):
        return "Payment settings"
