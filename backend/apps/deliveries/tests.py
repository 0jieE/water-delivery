import datetime

from django.utils import timezone

from apps.core.testing import APITestBase, tomorrow
from apps.deliveries.models import RiderProfile
from apps.notifications.models import Notification
from apps.orders.models import Order, OrderStatusLog
from apps.payments.models import Payment


class DeliveryBase(APITestBase):
    def make_scheduled(self, rider=None, delivery_date=None, **overrides):
        """An order that staff has confirmed, scheduled and assigned (through the API)."""
        order = self.place_order(**overrides)
        staff = self.as_user(self.staff)
        url = f"/api/orders/{order['id']}"
        staff.post(f"{url}/confirm/")
        response = staff.post(
            f"{url}/schedule/",
            {
                "delivery_date": (delivery_date or tomorrow()).isoformat(),
                "rider": (rider or self.rider).pk,
            },
            format="json",
        )
        assert response.status_code == 200, response.data
        return order["id"]

    def rider_status(self, rider=None):
        return RiderProfile.objects.get(pk=(rider or self.rider).pk).status


class MyDeliveriesTests(DeliveryBase):
    def setUp(self):
        self.client_r = self.as_user(self.rider_user)

    def test_lists_only_own_active_deliveries_with_scopes(self):
        today = timezone.localdate()
        mine_today = self.make_scheduled(delivery_date=today)
        mine_later = self.make_scheduled(delivery_date=today + datetime.timedelta(days=3))
        theirs = self.make_scheduled(rider=self.rider2)
        unassigned = self.place_order()["id"]

        ids = lambda url: [d["id"] for d in self.client_r.get(url).data["results"]]  # noqa: E731
        self.assertEqual(ids("/api/deliveries/my/"), [mine_today, mine_later])
        self.assertEqual(ids("/api/deliveries/my/?scope=today"), [mine_today])
        self.assertEqual(ids("/api/deliveries/my/?scope=upcoming"), [mine_later])
        self.assertEqual(ids("/api/deliveries/my/?scope=history"), [])
        self.assertNotIn(theirs, ids("/api/deliveries/my/"))
        self.assertNotIn(unassigned, ids("/api/deliveries/my/"))
        self.assertEqual(self.client_r.get(f"/api/deliveries/my/{theirs}/").status_code, 404)
        self.assertEqual(self.client_r.get(f"/api/deliveries/my/{unassigned}/").status_code, 404)
        self.assertEqual(self.client_r.get("/api/deliveries/my/?scope=bogus").status_code, 400)

    def test_delivery_shows_what_the_rider_needs_and_hides_the_rest(self):
        order_id = self.make_scheduled()
        data = self.client_r.get(f"/api/deliveries/my/{order_id}/").data
        self.assertEqual(data["customer"]["full_name"], "Cust1 Tester")
        self.assertEqual(data["customer"]["contact_number"], "09170000000")
        self.assertEqual(data["delivery_address"], "Purok 1, Kidapawan City")
        self.assertEqual(len(data["items"]), 2)
        self.assertEqual(data["amount_to_collect"], "80.00")
        self.assertNotIn("email", data["customer"])
        self.assertEqual(data["allowed_transitions"], ["out_for_delivery"])

    def test_only_riders_can_use_my_deliveries(self):
        for user in (self.customer, self.staff, self.admin):
            self.assertEqual(self.as_user(user).get("/api/deliveries/my/").status_code, 403)

    def test_online_payment_has_nothing_to_collect(self):
        order_id = self.make_scheduled(payment_method="gcash")
        data = self.client_r.get(f"/api/deliveries/my/{order_id}/").data
        self.assertEqual(data["amount_to_collect"], "0.00")
        self.assertNotIn("proof_image", data["payment"])


class DeliveryStatusFlowTests(DeliveryBase):
    def setUp(self):
        self.client_r = self.as_user(self.rider_user)
        self.order_id = self.make_scheduled()
        self.url = f"/api/deliveries/my/{self.order_id}/status/"

    def post(self, status, **extra):
        return self.client_r.post(self.url, {"status": status, **extra}, format="json")

    def test_full_cod_delivery(self):
        started = self.post("out_for_delivery")
        self.assertEqual(started.status_code, 200, started.data)
        self.assertEqual(started.data["order_status"], "out_for_delivery")
        self.assertEqual(self.rider_status(), "on_delivery")

        done = self.post("delivered", cod_collected=True)
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(done.data["order_status"], "delivered")
        self.assertEqual(self.rider_status(), "available")

        payment = Payment.objects.get(order_id=self.order_id)
        self.assertEqual(payment.payment_status, "paid")
        self.assertEqual(payment.verified_by, self.rider_user)
        self.assertIsNotNone(payment.payment_date)
        self.assertEqual(done.data["amount_to_collect"], "0.00")

        statuses = list(
            OrderStatusLog.objects.filter(order_id=self.order_id).values_list("to_status", flat=True)
        )
        self.assertEqual(
            statuses, ["pending", "confirmed", "scheduled", "out_for_delivery", "delivered"]
        )
        self.assertTrue(
            Notification.objects.filter(recipient=self.customer, title="Order delivered").exists()
        )
        self.assertTrue(
            Notification.objects.filter(recipient=self.customer, title="Out for delivery").exists()
        )

    def test_cod_delivery_requires_cash_collected(self):
        self.post("out_for_delivery")
        response = self.post("delivered")
        self.assertEqual(response.status_code, 400)
        self.assertIn("cod_collected", response.data["errors"])
        self.assertEqual(Order.objects.get(pk=self.order_id).order_status, "out_for_delivery")
        self.assertEqual(self.rider_status(), "on_delivery")
        self.assertEqual(Payment.objects.get(order_id=self.order_id).payment_status, "unpaid")

    def test_failed_delivery_needs_reason_and_frees_rider(self):
        self.post("out_for_delivery")
        self.assertEqual(self.post("failed").status_code, 400)
        response = self.post("failed", remarks="Nobody home")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["order_status"], "failed")
        self.assertEqual(self.rider_status(), "available")
        self.assertEqual(Payment.objects.get(order_id=self.order_id).payment_status, "unpaid")
        log = OrderStatusLog.objects.filter(order_id=self.order_id).last()
        self.assertEqual(log.remarks, "Nobody home")
        self.assertTrue(Notification.objects.filter(recipient=self.staff, title="Delivery failed").exists())

    def test_cannot_deliver_before_starting(self):
        response = self.post("delivered", cod_collected=True)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.get(pk=self.order_id).order_status, "scheduled")

    def test_rider_cannot_set_staff_statuses(self):
        for status in ("confirmed", "scheduled", "cancelled", "pending"):
            self.assertEqual(self.post(status).status_code, 400, status)

    def test_other_rider_cannot_update_this_delivery(self):
        response = self.as_user(self.rider2_user).post(self.url, {"status": "out_for_delivery"}, format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Order.objects.get(pk=self.order_id).order_status, "scheduled")

    def test_off_duty_rider_cannot_start_delivery(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="off_duty")
        self.assertEqual(self.post("out_for_delivery").status_code, 400)

    def test_online_paid_delivery_does_not_touch_payment(self):
        order_id = self.make_scheduled(payment_method="gcash")
        url = f"/api/deliveries/my/{order_id}/status/"
        self.client_r.post(url, {"status": "out_for_delivery"}, format="json")
        response = self.client_r.post(url, {"status": "delivered"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Payment.objects.get(order_id=order_id).payment_status, "unpaid")

    def test_availability_toggle(self):
        off = self.client_r.post("/api/deliveries/my/availability/", {"status": "off_duty"}, format="json")
        self.assertEqual(off.status_code, 200)
        self.assertEqual(self.rider_status(), "off_duty")
        self.assertEqual(
            self.client_r.post("/api/deliveries/my/availability/", {"status": "on_delivery"}, format="json").status_code,
            400,
        )
        self.client_r.post("/api/deliveries/my/availability/", {"status": "available"}, format="json")
        self.post("out_for_delivery")
        busy = self.client_r.post("/api/deliveries/my/availability/", {"status": "off_duty"}, format="json")
        self.assertEqual(busy.status_code, 400)


class RiderManagementTests(DeliveryBase):
    new_rider = {
        "username": "rider9",
        "password": "Str0ng!Pass#1",
        "first_name": "Ria",
        "last_name": "Cruz",
        "contact_number": "09175550000",
        "vehicle_type": "Motorcycle",
    }

    def test_admin_creates_rider_account_and_profile(self):
        response = self.as_user(self.admin).post("/api/deliveries/riders/", self.new_rider, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["vehicle_type"], "Motorcycle")
        self.assertEqual(response.data["status"], "available")
        login = self.client.post(
            "/api/auth/token/", {"username": "rider9", "password": "Str0ng!Pass#1"}, format="json"
        )
        self.assertEqual(login.data["user"]["role"], "rider")

    def test_staff_can_list_available_riders_but_not_write(self):
        RiderProfile.objects.filter(pk=self.rider2.pk).update(status="off_duty")
        staff = self.as_user(self.staff)
        available = staff.get("/api/deliveries/riders/?status=available")
        self.assertEqual([r["id"] for r in available.data], [self.rider.pk])
        self.assertEqual(staff.post("/api/deliveries/riders/", self.new_rider, format="json").status_code, 403)
        self.assertEqual(
            staff.patch(f"/api/deliveries/riders/{self.rider.pk}/", {"status": "off_duty"}, format="json").status_code,
            403,
        )

    def test_customers_and_riders_cannot_list_riders(self):
        for user in (self.customer, self.rider_user):
            self.assertEqual(self.as_user(user).get("/api/deliveries/riders/").status_code, 403)

    def test_admin_updates_rider(self):
        client = self.as_user(self.admin)
        url = f"/api/deliveries/riders/{self.rider.pk}/"
        response = client.patch(url, {"vehicle_type": "Tricycle", "status": "off_duty"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data["vehicle_type"], response.data["status"]), ("Tricycle", "off_duty"))
        self.assertEqual(client.patch(url, {"status": "on_delivery"}, format="json").status_code, 400)
        deactivated = client.patch(url, {"is_active": False}, format="json")
        self.assertFalse(deactivated.data["is_active"])
        self.rider_user.refresh_from_db()
        self.assertFalse(self.rider_user.is_active)

    def test_delete_rider(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.delete(f"/api/deliveries/riders/{self.rider2.pk}/").status_code, 204)
        self.make_scheduled()
        blocked = client.delete(f"/api/deliveries/riders/{self.rider.pk}/")
        self.assertEqual(blocked.status_code, 400)
        self.assertTrue(RiderProfile.objects.filter(pk=self.rider.pk).exists())
