from django.urls import path
from rest_framework.routers import SimpleRouter

from .cash_views import CashHeldView, RemitCashView, RemittanceViewSet
from .views import MyDeliveryViewSet, RiderViewSet

router = SimpleRouter()
router.register("riders", RiderViewSet, basename="rider")
router.register("my", MyDeliveryViewSet, basename="my-delivery")
router.register("cash/remittances", RemittanceViewSet, basename="cash-remittance")

urlpatterns = [
    path("cash/", CashHeldView.as_view(), name="cash-held"),
    path("cash/remit/", RemitCashView.as_view(), name="cash-remit"),
    *router.urls,
]
