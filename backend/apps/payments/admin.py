from django.contrib import admin

from .models import Payment, PaymentSettings


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "order",
        "payment_method",
        "payment_status",
        "amount",
        "payment_date",
        "verified_by",
    )
    list_filter = ("payment_method", "payment_status")
    search_fields = ("order__id", "reference_number")
    readonly_fields = ("remittance",)


@admin.register(PaymentSettings)
class PaymentSettingsAdmin(admin.ModelAdmin):
    list_display = ("__str__", "gcash_account_name", "gcash_number", "updated_at")

    def has_add_permission(self, request):
        return not PaymentSettings.objects.exists()  # single record

    def has_delete_permission(self, request, obj=None):
        return False
