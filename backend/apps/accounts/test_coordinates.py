from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.testing import APITestBase

PAYLOAD = {
    "username": "newcust",
    "password": "Str0ng!Pass#1",
    "email": "newcust@example.com",
    "first_name": "New",
    "last_name": "Customer",
    "contact_number": "09171234567",
    "address": "Poblacion, Kidapawan City",
}


class UserCoordinateTests(APITestBase):
    def test_register_with_and_without_saved_location(self):
        pinned = APIClient().post(
            "/api/auth/register/", {**PAYLOAD, "latitude": 7.0083, "longitude": 125.0894}, format="json"
        )
        self.assertEqual(pinned.status_code, 201, pinned.data)
        self.assertEqual((pinned.json()["latitude"], pinned.json()["longitude"]), (7.0083, 125.0894))

        plain = APIClient().post(
            "/api/auth/register/",
            {**PAYLOAD, "username": "plain", "email": "plain@example.com"},
            format="json",
        )
        self.assertEqual(plain.status_code, 201, plain.data)
        self.assertIsNone(plain.json()["latitude"])
        self.assertIsNone(plain.json()["longitude"])

    def test_register_rejects_half_or_out_of_range_location(self):
        for extra, field in (
            ({"latitude": 7.0}, "longitude"),
            ({"longitude": 125.0}, "latitude"),
            ({"latitude": 95, "longitude": 125.0}, "latitude"),
            ({"latitude": 7.0, "longitude": 200}, "longitude"),
        ):
            response = APIClient().post("/api/auth/register/", {**PAYLOAD, **extra}, format="json")
            self.assertEqual(response.status_code, 400, extra)
            self.assertIn(field, response.data["errors"], extra)
        self.assertFalse(User.objects.filter(username="newcust").exists())

    def test_me_returns_and_updates_location(self):
        client = self.as_user(self.customer)
        self.assertIsNone(client.get("/api/auth/me/").json()["latitude"])
        saved = client.patch("/api/auth/me/", {"latitude": 7.0172, "longitude": 125.0961}, format="json")
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual((saved.json()["latitude"], saved.json()["longitude"]), (7.0172, 125.0961))
        self.assertEqual(client.get("/api/auth/me/").json()["latitude"], 7.0172)

    def test_me_patch_rules(self):
        client = self.as_user(self.customer)
        client.patch("/api/auth/me/", {"latitude": 7.0, "longitude": 125.0}, format="json")
        half = client.patch("/api/auth/me/", {"latitude": 7.5}, format="json")
        self.assertEqual(half.status_code, 400)
        self.assertIn("longitude", half.data["errors"])
        bad = client.patch("/api/auth/me/", {"latitude": -90.1, "longitude": 1}, format="json")
        self.assertEqual(bad.status_code, 400)
        # unrelated edits leave the saved location alone
        client.patch("/api/auth/me/", {"address": "New street"}, format="json")
        self.assertEqual(client.get("/api/auth/me/").json()["latitude"], 7.0)
        # both null clears it
        cleared = client.patch("/api/auth/me/", {"latitude": None, "longitude": None}, format="json")
        self.assertEqual(cleared.status_code, 200)
        self.assertIsNone(cleared.json()["latitude"])
