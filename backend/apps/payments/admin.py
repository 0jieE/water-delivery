from django.contrib import admin
from unfold.admin import ModelAdmin
from unfold.decorators import display

from apps.core.admin_labels import PAYMENT_STATUS_COLORS

from .models import Payment, PaymentSettings


@admin.register(Payment)
class PaymentAdmin(ModelAdmin):
    compressed_fields = True
    list_display = (
        "id",
        "order",
        "payment_method",
        "status_badge",
        "amount",
        "payment_date",
        "verified_by",
    )
    list_filter = ("payment_method", "payment_status")
    search_fields = ("order__id", "reference_number")
    readonly_fields = ("remittance",)
    list_select_related = ("order", "verified_by")
    list_per_page = 25

    @display(description="Status", ordering="payment_status", label=PAYMENT_STATUS_COLORS)
    def status_badge(self, obj):
        return obj.payment_status, obj.get_payment_status_display()


@admin.register(PaymentSettings)
class PaymentSettingsAdmin(ModelAdmin):
    list_display = ("__str__", "gcash_account_name", "gcash_number", "updated_at")

    def has_add_permission(self, request):
        return not PaymentSettings.objects.exists()  # single record

    def has_delete_permission(self, request, obj=None):
        return False
