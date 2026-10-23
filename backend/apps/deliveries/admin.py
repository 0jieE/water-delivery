from django.contrib import admin
from unfold.admin import ModelAdmin
from unfold.decorators import display

from apps.core.admin_labels import RIDER_STATUS_COLORS

from .models import CashRemittance, RiderProfile


@admin.register(RiderProfile)
class RiderProfileAdmin(ModelAdmin):
    list_display = ("user", "vehicle_type", "status_badge", "created_at")
    list_filter = ("status",)
    search_fields = ("user__username", "user__first_name", "user__last_name")
    list_select_related = ("user",)

    @display(description="Status", ordering="status", label=RIDER_STATUS_COLORS)
    def status_badge(self, obj):
        return obj.status, obj.get_status_display()


@admin.register(CashRemittance)
class CashRemittanceAdmin(ModelAdmin):
    """Read-only: a remittance is a financial record, never edited or deleted."""

    list_display = ("id", "rider", "amount", "received_by", "received_at")
    list_filter = ("rider",)
    list_select_related = ("rider__user", "received_by")
    readonly_fields = ("rider", "amount", "received_by", "received_at", "remarks", "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
