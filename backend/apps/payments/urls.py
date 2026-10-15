from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import PaymentSettingsView, PaymentViewSet

router = SimpleRouter()
router.register("", PaymentViewSet, basename="payment")

# "settings/" must come before the router, whose detail route would otherwise try it as an id
urlpatterns = [path("settings/", PaymentSettingsView.as_view(), name="payment-settings"), *router.urls]
