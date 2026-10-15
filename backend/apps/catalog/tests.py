from decimal import Decimal

from rest_framework.test import APIClient

from apps.catalog.models import WaterRefillService
from apps.core.testing import APITestBase


class CatalogTests(APITestBase):
    def setUp(self):
        self.inactive = WaterRefillService.objects.create(
            service_name="Retired Refill", price=Decimal("10.00"), is_active=False
        )

    def test_public_list_shows_only_active_services(self):
        response = APIClient().get("/api/catalog/services/")
        self.assertEqual(response.status_code, 200)
        names = {s["service_name"] for s in response.data}
        self.assertEqual(names, {"Round 5-gal Refill", "Slim 5-gal Refill"})

    def test_admin_sees_inactive_services_too(self):
        response = self.as_user(self.admin).get("/api/catalog/services/")
        self.assertIn("Retired Refill", {s["service_name"] for s in response.data})
        only_inactive = self.as_user(self.admin).get("/api/catalog/services/?is_active=false")
        self.assertEqual(len(only_inactive.data), 1)

    def test_inactive_service_is_hidden_from_customers(self):
        response = self.as_user(self.customer).get(f"/api/catalog/services/{self.inactive.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_only_admin_can_write(self):
        body = {"service_name": "Mineral 1-gal", "price": "15.00"}
        self.assertEqual(APIClient().post("/api/catalog/services/", body, format="json").status_code, 401)
        for user in (self.customer, self.staff, self.rider_user):
            response = self.as_user(user).post("/api/catalog/services/", body, format="json")
            self.assertEqual(response.status_code, 403)
        created = self.as_user(self.admin).post("/api/catalog/services/", body, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["price"], "15.00")

    def test_price_must_be_positive(self):
        response = self.as_user(self.admin).post(
            "/api/catalog/services/", {"service_name": "Free", "price": "0"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("price", response.data["errors"])

    def test_update_price_and_delete_deactivates(self):
        client = self.as_user(self.admin)
        url = f"/api/catalog/services/{self.round_refill.pk}/"
        self.assertEqual(client.patch(url, {"price": "27.50"}, format="json").status_code, 200)
        self.round_refill.refresh_from_db()
        self.assertEqual(self.round_refill.price, Decimal("27.50"))
        self.assertEqual(client.delete(url).status_code, 204)
        self.round_refill.refresh_from_db()
        self.assertFalse(self.round_refill.is_active)
