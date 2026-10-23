from django.contrib import admin
from unfold.admin import ModelAdmin

from .models import Notification


@admin.register(Notification)
class NotificationAdmin(ModelAdmin):
    list_display = ("title", "recipient", "order", "is_read", "created_at")
    list_filter = ("is_read",)
    search_fields = ("title", "message", "recipient__username")
    list_select_related = ("recipient", "order")
    list_per_page = 50
