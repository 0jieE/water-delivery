from django.contrib import admin

from apps.payments.models import Payment

from .models import Order, OrderDetail, OrderStatusLog


class OrderDetailInline(admin.TabularInline):
    model = OrderDetail
    extra = 0


class OrderStatusLogInline(admin.TabularInline):
    model = OrderStatusLog
    extra = 0
    can_delete = False
    readonly_fields = ("from_status", "to_status", "changed_by", "remarks", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


class PaymentInline(admin.StackedInline):
    model = Payment
    extra = 0
    can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "customer",
        "order_status",
        "delivery_date",
        "rider",
        "total_amount",
        "order_date",
    )
    list_filter = ("order_status", "delivery_date")
    search_fields = ("id", "customer__username", "customer__first_name", "customer__last_name")
    list_select_related = ("customer", "rider__user")
    inlines = [OrderDetailInline, PaymentInline, OrderStatusLogInline]


@admin.register(OrderStatusLog)
class OrderStatusLogAdmin(admin.ModelAdmin):
    list_display = ("order", "from_status", "to_status", "changed_by", "created_at")
    list_filter = ("to_status",)
