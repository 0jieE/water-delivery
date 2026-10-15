from django.contrib import admin
from django.test import Client
from django.urls import reverse

from apps.accounts.models import User
from apps.core.testing import PASSWORD, APITestBase
from apps.deliveries.models import CashRemittance


class DjangoAdminAccessTests(APITestBase):
    def login(self, username, password=PASSWORD):
        client = Client()
        self.assertTrue(client.login(username=username, password=password))
        return client

    def create_admin_through_the_api(self, username="newadmin"):
        response = self.as_user(self.admin).post(
            "/api/auth/users/",
            {
                "username": username,
                "password": "Str0ng!Pass#1",
                "role": "admin",
                "first_name": "New",
                "last_name": "Admin",
                "email": f"{username}@example.com",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return User.objects.get(username=username)

    def test_role_admin_gets_django_admin_access_automatically(self):
        user = self.create_admin_through_the_api()
        self.assertTrue(user.is_staff and user.is_superuser)
        self.assertEqual(self.login("newadmin", "Str0ng!Pass#1").get("/admin/").status_code, 200)

    def test_every_other_role_is_kept_out_of_the_admin_site(self):
        for username in ("staff1", "rider1", "cust1"):
            user = User.objects.get(username=username)
            self.assertFalse(user.is_staff or user.is_superuser, username)
            response = self.login(username).get("/admin/")
            self.assertEqual(response.status_code, 302, username)
            self.assertIn("/admin/login/", response["Location"], username)
        self.assertEqual(Client().get("/admin/").status_code, 302)

    def test_flags_follow_the_role_when_it_changes(self):
        api = self.as_user(self.admin)
        promoted = api.patch(f"/api/auth/users/{self.staff.pk}/", {"role": "admin"}, format="json")
        self.assertEqual(promoted.status_code, 200)
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.is_staff and self.staff.is_superuser)
        self.assertEqual(self.login("staff1").get("/admin/").status_code, 200)

        api.patch(f"/api/auth/users/{self.staff.pk}/", {"role": "staff"}, format="json")
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.is_staff or self.staff.is_superuser)
        self.assertEqual(self.login("staff1").get("/admin/").status_code, 302)

    def test_flags_stay_in_sync_even_on_a_partial_save(self):
        self.customer.role = "admin"
        self.customer.save(update_fields=["role"])
        self.customer.refresh_from_db()
        self.assertTrue(self.customer.is_staff and self.customer.is_superuser)

    def test_createsuperuser_and_the_seeded_admin_are_admins(self):
        root = User.objects.create_superuser("root", "root@example.com", PASSWORD)
        self.assertEqual((root.role, root.is_staff, root.is_superuser), ("admin", True, True))
        self.assertEqual(self.login("root").get("/admin/").status_code, 200)

    def test_every_registered_model_has_a_working_admin_list_page(self):
        client = self.login("admin1")
        for model in admin.site._registry:
            url = reverse(f"admin:{model._meta.app_label}_{model._meta.model_name}_changelist")
            self.assertEqual(client.get(url).status_code, 200, model.__name__)

    def test_change_and_add_pages_render(self):
        order = self.place_order()
        client = self.login("admin1")
        self.assertEqual(client.get(reverse("admin:orders_order_change", args=[order["id"]])).status_code, 200)
        self.assertEqual(client.get(reverse("admin:accounts_user_add")).status_code, 200)
        self.assertEqual(client.get(reverse("admin:accounts_user_change", args=[self.rider_user.pk])).status_code, 200)
        self.assertEqual(client.get(reverse("admin:catalog_waterrefillservice_add")).status_code, 200)
        self.assertEqual(client.get(reverse("admin:deliveries_riderprofile_change", args=[self.rider.pk])).status_code, 200)
        self.assertEqual(client.get(reverse("admin:payments_payment_change", args=[order["payment"]["id"]])).status_code, 200)

    def test_admin_can_create_a_rider_in_the_admin_site(self):
        client = self.login("admin1")
        response = client.post(
            reverse("admin:accounts_user_add"),
            {
                "username": "adminmade",
                "password1": "Str0ng!Pass#1",
                "password2": "Str0ng!Pass#1",
                "role": "rider",
                "first_name": "Made",
                "last_name": "InAdmin",
                "email": "adminmade@example.com",
                "contact_number": "09171112222",
                "address": "Somewhere",
            },
        )
        self.assertEqual(response.status_code, 302, getattr(response, "context_data", None))
        made = User.objects.get(username="adminmade")
        self.assertEqual(made.role, "rider")
        self.assertTrue(hasattr(made, "rider_profile"))  # the profile is created automatically

    def test_financial_records_are_read_only_in_the_admin_site(self):
        remittance = CashRemittance.objects.create(rider=self.rider, amount="10.00", received_by=self.staff)
        client = self.login("admin1")
        self.assertEqual(client.get(reverse("admin:deliveries_cashremittance_add")).status_code, 403)
        self.assertEqual(client.post(reverse("admin:deliveries_cashremittance_delete", args=[remittance.pk]), {"post": "yes"}).status_code, 403)
        self.assertEqual(client.get(reverse("admin:deliveries_cashremittance_change", args=[remittance.pk])).status_code, 200)  # view only
        self.assertTrue(CashRemittance.objects.filter(pk=remittance.pk).exists())

    def test_payment_settings_is_a_single_record_in_the_admin_site(self):
        client = self.login("admin1")
        self.assertEqual(client.get(reverse("admin:payments_paymentsettings_add")).status_code, 403)  # the row exists
        change = reverse("admin:payments_paymentsettings_change", args=[1])
        self.assertEqual(client.get(change).status_code, 200)
        self.assertEqual(client.post(reverse("admin:payments_paymentsettings_delete", args=[1]), {"post": "yes"}).status_code, 403)
