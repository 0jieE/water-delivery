from rest_framework.routers import SimpleRouter

from .views import WaterRefillServiceViewSet

router = SimpleRouter()
router.register("services", WaterRefillServiceViewSet, basename="service")

urlpatterns = router.urls
