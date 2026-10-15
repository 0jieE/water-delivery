import django_filters
from django.db.models import Q

from apps.core.filters import IdFilter, search_id

from .models import Order


class CharInFilter(django_filters.BaseInFilter, django_filters.CharFilter):
    """?status=pending,confirmed"""


class OrderFilter(django_filters.FilterSet):
    status = CharInFilter(field_name="order_status")
    date_from = django_filters.DateFilter(field_name="order_date", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="order_date", lookup_expr="date__lte")
    delivery_date = django_filters.DateFilter(field_name="delivery_date")
    delivery_date_from = django_filters.DateFilter(field_name="delivery_date", lookup_expr="gte")
    delivery_date_to = django_filters.DateFilter(field_name="delivery_date", lookup_expr="lte")
    customer = IdFilter(field_name="customer_id")
    rider = IdFilter(field_name="rider_id")
    payment_status = django_filters.CharFilter(field_name="payment__payment_status")
    payment_method = django_filters.CharFilter(field_name="payment__payment_method")
    search = django_filters.CharFilter(method="filter_search")

    class Meta:
        model = Order
        fields: list[str] = []

    def filter_search(self, queryset, name, value):
        """Every word must match the customer, rider, address or the order number."""
        for term in value.split():
            q = (
                Q(customer__username__icontains=term)
                | Q(customer__first_name__icontains=term)
                | Q(customer__last_name__icontains=term)
                | Q(delivery_address__icontains=term)
                | Q(rider__user__first_name__icontains=term)
                | Q(rider__user__last_name__icontains=term)
            )
            order_id = search_id(term)
            if order_id is not None:
                q |= Q(pk=order_id)
            queryset = queryset.filter(q)
        return queryset
