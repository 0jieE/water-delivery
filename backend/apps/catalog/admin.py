from django.contrib import admin

from .models import WaterRefillService


@admin.register(WaterRefillService)
class WaterRefillServiceAdmin(admin.ModelAdmin):
    list_display = ("service_name", "price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("service_name", "description")
