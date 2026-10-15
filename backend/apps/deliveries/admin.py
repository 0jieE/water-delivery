from django.contrib import admin

from .models import CashRemittance, RiderProfile


@admin.register(RiderProfile)
class RiderProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "vehicle_type", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("user__username", "user__first_name", "user__last_name")


@admin.register(CashRemittance)
class CashRemittanceAdmin(admin.ModelAdmin):
    """Read-only: a remittance is a financial record, never edited or deleted."""

    list_display = ("id", "rider", "amount", "received_by", "received_at")
    list_filter = ("rider",)
    readonly_fields = ("rider", "amount", "received_by", "received_at", "remarks", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
