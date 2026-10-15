from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("Profile", {"fields": ("role", "contact_number", "address", "latitude", "longitude")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Profile", {"fields": ("role", "first_name", "last_name", "email", "contact_number", "address")}),
    )
    list_display = ("username", "email", "first_name", "last_name", "role", "is_active")
    list_filter = ("role", "is_active")
    search_fields = ("username", "first_name", "last_name", "email", "contact_number")
    ordering = ("-created_at",)
    # staff/superuser flags follow the role (see User.save), so they are not edited by hand
    readonly_fields = UserAdmin.readonly_fields + ("is_staff", "is_superuser")
