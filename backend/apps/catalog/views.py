from rest_framework import status, viewsets
from rest_framework.permissions import SAFE_METHODS, AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin

from .models import WaterRefillService
from .serializers import WaterRefillServiceSerializer


class WaterRefillServiceViewSet(viewsets.ModelViewSet):
    """Public: list/retrieve active services. Admin: create, update, deactivate.

    Admins also see inactive services in the list (filter with ?is_active=).
    DELETE does not remove the row (order history references it) - it deactivates it.
    """

    serializer_class = WaterRefillServiceSerializer
    pagination_class = None  # the catalog is small; the frontend wants it all at once
    filterset_fields = ["is_active"]
    search_fields = ["service_name", "description"]
    ordering_fields = ["id", "service_name", "price"]

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [AllowAny()]
        return [IsAdmin()]

    def get_queryset(self):
        qs = WaterRefillService.objects.all()
        user = self.request.user
        if not (user.is_authenticated and user.role == "admin"):
            qs = qs.filter(is_active=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        service = self.get_object()
        service.is_active = False
        service.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
