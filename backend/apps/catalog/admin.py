from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import WaterRefillService


@admin.register(WaterRefillService)
class WaterRefillServiceAdmin(ModelAdmin):
    compressed_fields = True
    list_display = ("service_name", "price", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("service_name", "description")
