"""Helpers shared by the test suites."""
import atexit
import datetime
import io
import shutil
import tempfile
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from apps.catalog.models import WaterRefillService

User = get_user_model()
PASSWORD = "Test@12345"

_MEDIA_DIR = tempfile.mkdtemp(prefix="water-refilling-test-media-")
atexit.register(shutil.rmtree, _MEDIA_DIR, ignore_errors=True)


def make_user(username, role="customer", **extra):
    extra.setdefault("email", f"{username}@example.com")
    extra.setdefault("first_name", username.capitalize())
    extra.setdefault("last_name", "Tester")
    extra.setdefault("contact_number", "09170000000")
    extra.setdefault("address", f"{username} street, Kidapawan City")
    return User.objects.create_user(username=username, password=PASSWORD, role=role, **extra)


def image_file(name="proof.png", size=(20, 20)):
    buf = io.BytesIO()
    Image.new("RGB", size, "blue").save(buf, format="PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


def tomorrow():
    return timezone.localdate() + datetime.timedelta(days=1)


@override_settings(MEDIA_ROOT=_MEDIA_DIR)
class APITestBase(APITestCase):
    """Creates one user per role plus two services; offers login helpers."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = make_user("admin1", "admin")
        cls.staff = make_user("staff1", "staff")
        cls.rider_user = make_user("rider1", "rider")
        cls.rider = cls.rider_user.rider_profile
        cls.rider2_user = make_user("rider2", "rider")
        cls.rider2 = cls.rider2_user.rider_profile
        cls.customer = make_user("cust1", "customer")
        cls.customer2 = make_user("cust2", "customer")
        cls.round_refill = WaterRefillService.objects.create(
            service_name="Round 5-gal Refill", price=Decimal("25.00")
        )
        cls.slim_refill = WaterRefillService.objects.create(
            service_name="Slim 5-gal Refill", price=Decimal("30.00")
        )

    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def order_payload(self, **overrides):
        payload = {
            "items": [
                {"service": self.round_refill.pk, "quantity": 2},
                {"service": self.slim_refill.pk, "quantity": 1},
            ],
            "delivery_date": tomorrow().isoformat(),
            "delivery_address": "Purok 1, Kidapawan City",
            "payment_method": "cod",
        }
        payload.update(overrides)
        return payload

    def place_order(self, user=None, **overrides):
        """Create an order through the API and return the response data."""
        client = self.as_user(user or self.customer)
        response = client.post("/api/orders/", self.order_payload(**overrides), format="json")
        assert response.status_code == 201, response.data
        return response.data
