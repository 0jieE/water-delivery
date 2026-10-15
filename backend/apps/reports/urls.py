from django.urls import path

from . import views

urlpatterns = [
    path("sales/daily/", views.DailySalesView.as_view(), name="report-sales-daily"),
    path("sales/monthly/", views.MonthlySalesView.as_view(), name="report-sales-monthly"),
    path("orders-by-status/", views.OrdersByStatusView.as_view(), name="report-orders-by-status"),
    path(
        "deliveries-per-rider/",
        views.DeliveriesPerRiderView.as_view(),
        name="report-deliveries-per-rider",
    ),
    path("top-services/", views.TopServicesView.as_view(), name="report-top-services"),
    path("cash/", views.CashReportView.as_view(), name="report-cash"),
]
