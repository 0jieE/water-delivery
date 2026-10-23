from django.contrib import admin
from unfold.admin import ModelAdmin, StackedInline, TabularInline
from unfold.decorators import display

from apps.core.admin_labels import ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS
from apps.payments.models import Payment

from .models import Order, OrderDetail, OrderStatusLog


class OrderDetailInline(TabularInline):
    model = OrderDetail
    extra = 0


class OrderStatusLogInline(TabularInline):
    model = OrderStatusLog
    extra = 0
    can_delete = False
    readonly_fields = ("from_status", "to_status", "changed_by", "remarks", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


class PaymentInline(StackedInline):
    model = Payment
    extra = 0
    can_delete = False


@admin.register(Order)
class OrderAdmin(ModelAdmin):
    compressed_fields = True
    warn_unsaved_form = True
    list_display = (
        "order_number",
        "customer_name",
        "status_badge",
        "payment_badge",
        "delivery_date",
        "rider_name",
        "total_amount",
        "order_date",
    )
    list_display_links = ("order_number", "customer_name")
    list_filter = ("order_status", "delivery_date")
    search_fields = ("id", "customer__username", "customer__first_name", "customer__last_name")
    list_select_related = ("customer", "rider__user", "payment")
    list_per_page = 25
    inlines = [OrderDetailInline, PaymentInline, OrderStatusLogInline]

    @display(description="Customer", ordering="customer__first_name")
    def customer_name(self, obj):
        return obj.customer.full_name

    @display(description="Rider", ordering="rider__user__first_name")
    def rider_name(self, obj):
        return obj.rider.user.full_name if obj.rider_id else "-"

    @display(description="Order", ordering="id")
    def order_number(self, obj):
        return f"#{obj.pk}"

    @display(description="Status", ordering="order_status", label=ORDER_STATUS_COLORS)
    def status_badge(self, obj):
        return obj.order_status, obj.get_order_status_display()

    @display(description="Payment", label=PAYMENT_STATUS_COLORS)
    def payment_badge(self, obj):
        payment = getattr(obj, "payment", None)
        if payment is None:
            return None
        return payment.payment_status, f"{payment.get_payment_method_display()}: {payment.get_payment_status_display()}"


@admin.register(OrderStatusLog)
class OrderStatusLogAdmin(ModelAdmin):
    list_display = ("order", "from_status", "status_badge", "changed_by", "created_at")
    list_filter = ("to_status",)
    list_select_related = ("order", "changed_by")
    list_per_page = 50

    @display(description="To", ordering="to_status", label=ORDER_STATUS_COLORS)
    def status_badge(self, obj):
        return obj.to_status, obj.get_to_status_display()
