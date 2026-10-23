from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from unfold.admin import ModelAdmin
from unfold.decorators import display
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from apps.core.admin_labels import ROLE_COLORS

from .models import User


@admin.register(User)
class CustomUserAdmin(UserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    compressed_fields = True
    warn_unsaved_form = True

    fieldsets = UserAdmin.fieldsets + (
        ("Profile", {"fields": ("role", "contact_number", "address", "latitude", "longitude")}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Profile", {"fields": ("role", "first_name", "last_name", "email", "contact_number", "address")}),
    )
    list_display = ("username", "full_name_display", "email", "role_badge", "contact_number", "is_active")
    list_filter = ("role", "is_active")
    search_fields = ("username", "first_name", "last_name", "email", "contact_number")
    ordering = ("-created_at",)
    list_per_page = 25
    # staff/superuser flags follow the role (see User.save), so they are not edited by hand
    readonly_fields = UserAdmin.readonly_fields + ("is_staff", "is_superuser")

    @display(description="Name", ordering="first_name")
    def full_name_display(self, obj):
        return obj.full_name

    @display(description="Role", ordering="role", label=ROLE_COLORS)
    def role_badge(self, obj):
        return obj.role, obj.get_role_display()
