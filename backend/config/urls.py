from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve

from apps.core.views import HealthView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", HealthView.as_view(), name="health"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/catalog/", include("apps.catalog.urls")),
    path("api/orders/", include("apps.orders.urls")),
    path("api/deliveries/", include("apps.deliveries.urls")),
    path("api/payments/", include("apps.payments.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/reports/", include("apps.reports.urls")),
    path("api/backups/", include("apps.core.urls")),
]



def serve_media(request, path):
    return serve(request, path, document_root=settings.MEDIA_ROOT)


# Uploaded files (payment proofs, GCash QR). With a cloud bucket the storage serves them itself.
if settings.DEBUG or settings.SERVE_MEDIA_FILES:
    urlpatterns += [re_path(rf"^{settings.MEDIA_URL.lstrip('/')}(?P<path>.*)$", serve_media)]
