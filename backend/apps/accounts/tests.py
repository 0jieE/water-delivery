import jwt
from django.conf import settings
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.testing import PASSWORD, APITestBase


class AuthTests(APITestBase):
    def test_login_returns_role_and_name_claims(self):
        response = APIClient().post(
            "/api/auth/token/", {"username": "rider1", "password": PASSWORD}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        claims = jwt.decode(response.data["access"], settings.SECRET_KEY, algorithms=["HS256"])
        self.assertEqual(claims["role"], "rider")
        self.assertEqual(claims["name"], "Rider1 Tester")
        self.assertEqual(response.data["user"]["role"], "rider")
        self.assertIsNotNone(response.data["user"]["rider_profile"])

    def test_login_wrong_password_uses_error_shape(self):
        response = APIClient().post(
            "/api/auth/token/", {"username": "cust1", "password": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(set(response.data), {"detail", "code", "errors"})

    def test_inactive_user_cannot_login(self):
        self.customer.is_active = False
        self.customer.save()
        response = APIClient().post(
            "/api/auth/token/", {"username": "cust1", "password": PASSWORD}, format="json"
        )
        self.assertEqual(response.status_code, 401)

    def test_refresh_token(self):
        login = APIClient().post(
            "/api/auth/token/", {"username": "cust1", "password": PASSWORD}, format="json"
        )
        response = APIClient().post(
            "/api/auth/token/refresh/", {"refresh": login.data["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)

    def test_unauthenticated_request_is_401(self):
        self.assertEqual(APIClient().get("/api/auth/me/").status_code, 401)


class RegisterTests(APITestBase):
    payload = {
        "username": "newcust",
        "password": "Str0ng!Pass#1",
        "email": "newcust@example.com",
        "first_name": "New",
        "last_name": "Customer",
        "contact_number": "09171234567",
        "address": "Poblacion, Kidapawan City",
    }

    def test_register_creates_customer_only(self):
        response = APIClient().post(
            "/api/auth/register/", {**self.payload, "role": "admin"}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["role"], "customer")
        self.assertNotIn("password", response.data)
        user = User.objects.get(username="newcust")
        self.assertTrue(user.check_password(self.payload["password"]))
        self.assertEqual(user.role, "customer")

    def test_register_validates_fields(self):
        response = APIClient().post(
            "/api/auth/register/", {"username": "x", "password": "123"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        for field in ("password", "email", "first_name", "contact_number"):
            self.assertIn(field, response.data["errors"])

    def test_register_rejects_duplicate_email_case_insensitively(self):
        response = APIClient().post(
            "/api/auth/register/", {**self.payload, "email": "CUST1@example.com"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data["errors"])


class MeTests(APITestBase):
    def test_get_and_patch_profile(self):
        client = self.as_user(self.customer)
        me = client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["role"], "customer")
        patched = client.patch(
            "/api/auth/me/", {"address": "New address", "role": "admin"}, format="json"
        )
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data["address"], "New address")
        self.assertEqual(patched.data["role"], "customer")  # role is not editable

    def test_change_password(self):
        client = self.as_user(self.customer)
        bad = client.post(
            "/api/auth/change-password/",
            {"old_password": "wrong", "new_password": "An0ther!Pass#9"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)
        ok = client.post(
            "/api/auth/change-password/",
            {"old_password": PASSWORD, "new_password": "An0ther!Pass#9"},
            format="json",
        )
        self.assertEqual(ok.status_code, 200)
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.check_password("An0ther!Pass#9"))


class UserAdminTests(APITestBase):
    def test_only_admin_can_manage_users(self):
        for user in (self.staff, self.rider_user, self.customer):
            self.assertEqual(self.as_user(user).get("/api/auth/users/").status_code, 403)
        self.assertEqual(self.as_user(self.admin).get("/api/auth/users/").status_code, 200)

    def test_admin_creates_rider_with_profile(self):
        response = self.as_user(self.admin).post(
            "/api/auth/users/",
            {
                "username": "rider9",
                "password": "Str0ng!Pass#1",
                "role": "rider",
                "first_name": "Ria",
                "last_name": "Dela Cruz",
                "contact_number": "09179998888",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["role"], "rider")
        self.assertEqual(response.data["rider_profile"]["status"], "available")

    def test_create_requires_password(self):
        response = self.as_user(self.admin).post(
            "/api/auth/users/", {"username": "nopass", "role": "staff"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["errors"])

    def test_filter_by_role_and_deactivate(self):
        client = self.as_user(self.admin)
        riders = client.get("/api/auth/users/?role=rider")
        self.assertEqual({u["username"] for u in riders.data["results"]}, {"rider1", "rider2"})
        patch = client.patch(
            f"/api/auth/users/{self.customer2.pk}/", {"is_active": False}, format="json"
        )
        self.assertEqual(patch.status_code, 200)
        self.assertFalse(patch.data["is_active"])

    def test_admin_cannot_deactivate_or_demote_self(self):
        client = self.as_user(self.admin)
        url = f"/api/auth/users/{self.admin.pk}/"
        self.assertEqual(client.patch(url, {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(client.patch(url, {"role": "staff"}, format="json").status_code, 400)
        self.assertEqual(client.delete(url).status_code, 400)

    def test_createsuperuser_gets_admin_role(self):
        user = User.objects.create_superuser("root", "root@example.com", PASSWORD)
        self.assertEqual(user.role, "admin")
