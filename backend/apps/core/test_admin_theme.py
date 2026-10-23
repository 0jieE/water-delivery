import json

from django.conf import settings
from django.test import Client, override_settings
from django.utils import timezone

from apps.core import dashboard
from apps.core.testing import APITestBase, image_file
from apps.orders.models import Order
from apps.payments.models import Payment


class AdminThemeTests(APITestBase):
    def setUp(self):
        self.client_admin = Client()
        self.client_admin.force_login(self.admin)

    def kpis(self):
        response = self.client_admin.get("/admin/")
        self.assertEqual(response.status_code, 200)
        return {k["title"]: k["value"] for k in response.context["kpis"]}, response

    def test_dashboard_shows_live_figures(self):
        figures, response = self.kpis()
        self.assertEqual(figures["Orders due today"], 0)
        self.assertEqual(figures["Waiting for confirmation"], 0)
        self.assertEqual(figures["Payments to verify"], 0)
        self.assertEqual(figures["Cash held by riders"], "PHP 0.00")
        self.assertEqual(figures["Riders available"], 2)
        for title in figures:
            self.assertContains(response, title)

        self.place_order()  # pending, delivery tomorrow, COD
        order = self.place_order(payment_method="gcash", delivery_date=timezone.localdate().isoformat())
        self.as_user(self.customer).post(  # a real proof upload moves it to "pending verification"
            f"/api/payments/{order['payment']['id']}/upload-proof/",
            {"proof_image": image_file(), "reference_number": "GC1"},
            format="multipart",
        )
        figures, _ = self.kpis()
        self.assertEqual(figures["Waiting for confirmation"], 2)
        self.assertEqual(figures["Orders due today"], 1)
        self.assertEqual(figures["Payments to verify"], 1)

    def test_cash_figures_match_the_cash_service(self):
        cod = self.place_order()
        Order.objects.filter(pk=cod["id"]).update(order_status="delivered", rider=self.rider)
        Payment.objects.filter(order_id=cod["id"]).update(
            payment_status="paid", payment_date=timezone.now(), verified_by=self.rider_user
        )
        figures, response = self.kpis()
        self.assertEqual(figures["Cash held by riders"], "PHP 80.00")
        self.assertEqual(response.context["cash_table"]["rows"], [["Rider1 Tester", 1, "PHP 80.00"]])
        self.assertContains(response, "Rider1 Tester")

    def test_chart_and_recent_orders(self):
        for _ in range(10):
            self.place_order()
        _, response = self.kpis()
        chart = json.loads(response.context["sales_chart"])
        self.assertEqual(len(chart["labels"]), 14)
        self.assertEqual(len(chart["datasets"][0]["data"]), 14)
        rows = response.context["recent_orders_table"]["rows"]
        self.assertEqual(len(rows), 8)  # the latest eight only
        self.assertIn("PENDING", str(rows[0][2]).upper())

    def test_environment_badge_tells_live_from_development(self):
        self.assertEqual(dashboard.environment_callback(None), ["Live", "danger"])
        with override_settings(DEBUG=True):
            self.assertEqual(dashboard.environment_callback(None), ["Development", "info"])

    def test_every_sidebar_link_opens(self):
        navigation = settings.UNFOLD["SIDEBAR"]["navigation"]
        links = [str(item["link"]) for group in navigation for item in group["items"]]
        self.assertGreaterEqual(len(links), 10)
        for link in links:
            self.assertEqual(self.client_admin.get(link).status_code, 200, link)

    def test_tables_show_readable_names_and_status_badges(self):
        self.place_order()
        page = self.client_admin.get("/admin/orders/order/")
        self.assertContains(page, "Cust1 Tester")
        self.assertNotContains(page, "Cust1 Tester (customer)")  # no internal role text
        self.assertContains(page, "Pending")
        self.assertContains(page, "Cash on delivery: Unpaid")
        users = self.client_admin.get("/admin/accounts/user/")
        self.assertContains(users, "Rider")
        self.assertContains(users, "Admin")

    def test_login_page_is_branded(self):
        page = Client().get("/admin/login/")
        self.assertContains(page, "Deep Water")
        self.assertContains(page, "/static/favicon.svg")

    def test_view_site_link_points_to_the_web_app_when_known(self):
        from config.admin_theme import build_unfold

        self.assertEqual(build_unfold("https://app.example.com")["SITE_URL"], "https://app.example.com")
        self.assertTrue(build_unfold("https://app.example.com")["SHOW_VIEW_ON_SITE"])
        self.assertFalse(build_unfold(None)["SHOW_VIEW_ON_SITE"])
