import datetime
from decimal import Decimal

from django.core import mail
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import WaterRefillService
from apps.core.testing import APITestBase, make_user, tomorrow
from apps.deliveries.models import RiderProfile
from apps.notifications.models import Notification
from apps.orders.models import Order, OrderStatusLog

S = Order.Status


def set_status(order_id, status, rider=None):
    Order.objects.filter(pk=order_id).update(order_status=status, rider=rider)


class OrderCreationTests(APITestBase):
    def test_total_is_computed_server_side(self):
        data = self.place_order()
        # 2 x 25.00 + 1 x 30.00
        self.assertEqual(data["total_amount"], "80.00")
        self.assertEqual(data["order_status"], "pending")
        self.assertEqual(data["payment"]["amount"], "80.00")
        self.assertEqual(data["payment"]["payment_status"], "unpaid")

    def test_client_supplied_prices_are_ignored(self):
        payload = self.order_payload()
        for item in payload["items"]:
            item["unit_price"] = "0.01"
            item["subtotal"] = "0.01"
        payload["total_amount"] = "1.00"
        response = self.as_user(self.customer).post("/api/orders/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["total_amount"], "80.00")
        self.assertEqual(response.data["items"][0]["unit_price"], "25.00")
        self.assertEqual(response.data["items"][0]["subtotal"], "50.00")

    def test_unit_price_is_a_snapshot(self):
        data = self.place_order()
        self.round_refill.price = Decimal("99.00")
        self.round_refill.save()
        order = self.as_user(self.customer).get(f"/api/orders/{data['id']}/").data
        self.assertEqual(order["total_amount"], "80.00")
        self.assertEqual(order["items"][0]["unit_price"], "25.00")

    def test_duplicate_services_are_merged(self):
        data = self.place_order(
            items=[
                {"service": self.round_refill.pk, "quantity": 1},
                {"service": self.round_refill.pk, "quantity": 2},
            ]
        )
        self.assertEqual(len(data["items"]), 1)
        self.assertEqual(data["items"][0]["quantity"], 3)
        self.assertEqual(data["total_amount"], "75.00")

    def test_rejects_bad_items(self):
        client = self.as_user(self.customer)
        inactive = WaterRefillService.objects.create(
            service_name="Retired", price=Decimal("5.00"), is_active=False
        )
        cases = {
            "empty": [],
            "zero quantity": [{"service": self.round_refill.pk, "quantity": 0}],
            "inactive": [{"service": inactive.pk, "quantity": 1}],
            "unknown": [{"service": 9999, "quantity": 1}],
        }
        for label, items in cases.items():
            response = client.post("/api/orders/", self.order_payload(items=items), format="json")
            self.assertEqual(response.status_code, 400, label)
            self.assertIn("items", response.data["errors"], label)

    def test_item_errors_are_aligned_with_the_submitted_items(self):
        items = [
            {"service": self.round_refill.pk, "quantity": 1},
            {"service": self.slim_refill.pk, "quantity": 0},
        ]
        response = self.as_user(self.customer).post(
            "/api/orders/", self.order_payload(items=items), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["errors"]["items"][0], {})
        self.assertIn("quantity", response.data["errors"]["items"][1])
        empty = self.as_user(self.customer).post(
            "/api/orders/", self.order_payload(items=[]), format="json"
        )
        self.assertEqual(empty.data["errors"]["items"], ["This list may not be empty."])

    def test_delivery_date_cannot_be_in_the_past(self):
        yesterday = timezone.localdate() - datetime.timedelta(days=1)
        response = self.as_user(self.customer).post(
            "/api/orders/", self.order_payload(delivery_date=yesterday.isoformat()), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("delivery_date", response.data["errors"])
        today = self.as_user(self.customer).post(
            "/api/orders/",
            self.order_payload(delivery_date=timezone.localdate().isoformat()),
            format="json",
        )
        self.assertEqual(today.status_code, 201)

    def test_address_falls_back_to_profile(self):
        payload = self.order_payload()
        del payload["delivery_address"]
        response = self.as_user(self.customer).post("/api/orders/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["delivery_address"], self.customer.address)

    def test_address_required_when_profile_has_none(self):
        nobody = make_user("noaddr", address="")
        payload = self.order_payload()
        del payload["delivery_address"]
        response = self.as_user(nobody).post("/api/orders/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("delivery_address", response.data["errors"])

    def test_only_customers_can_create(self):
        for user in (self.staff, self.admin, self.rider_user):
            response = self.as_user(user).post("/api/orders/", self.order_payload(), format="json")
            self.assertEqual(response.status_code, 403)

    def test_creation_writes_log_and_notifications(self):
        with self.captureOnCommitCallbacks(execute=True):
            data = self.place_order()
        log = OrderStatusLog.objects.get(order_id=data["id"])
        self.assertEqual((log.from_status, log.to_status), ("", "pending"))
        self.assertTrue(Notification.objects.filter(recipient=self.customer, order_id=data["id"]).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.staff, order_id=data["id"]).exists())
        self.assertEqual(len(mail.outbox), 1)  # customer email only; staff are in-app only
        self.assertEqual(mail.outbox[0].to, [self.customer.email])


class OrderVisibilityTests(APITestBase):
    def setUp(self):
        self.order1 = self.place_order(self.customer)
        self.order2 = self.place_order(self.customer2)

    def test_customer_sees_only_own_orders(self):
        client = self.as_user(self.customer)
        listing = client.get("/api/orders/")
        self.assertEqual([o["id"] for o in listing.data["results"]], [self.order1["id"]])
        self.assertEqual(client.get(f"/api/orders/{self.order1['id']}/").status_code, 200)

    def test_customer_cannot_see_another_customers_order(self):
        client = self.as_user(self.customer)
        self.assertEqual(client.get(f"/api/orders/{self.order2['id']}/").status_code, 404)
        self.assertEqual(client.get(f"/api/orders/{self.order2['id']}/timeline/").status_code, 404)
        self.assertEqual(client.post(f"/api/orders/{self.order2['id']}/cancel/").status_code, 404)

    def test_rider_cannot_see_unassigned_orders(self):
        set_status(self.order1["id"], S.SCHEDULED, rider=self.rider)
        client = self.as_user(self.rider_user)
        listing = client.get("/api/orders/")
        self.assertEqual([o["id"] for o in listing.data["results"]], [self.order1["id"]])
        self.assertEqual(client.get(f"/api/orders/{self.order2['id']}/").status_code, 404)

    def test_rider_cannot_see_orders_assigned_to_another_rider(self):
        set_status(self.order1["id"], S.SCHEDULED, rider=self.rider2)
        client = self.as_user(self.rider_user)
        self.assertEqual(client.get(f"/api/orders/{self.order1['id']}/").status_code, 404)
        self.assertEqual(client.get("/api/orders/").data["count"], 0)

    def test_staff_and_admin_see_everything(self):
        for user in (self.staff, self.admin):
            self.assertEqual(self.as_user(user).get("/api/orders/").data["count"], 2)

    def test_anonymous_gets_401(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get("/api/orders/").status_code, 401)

    def test_staff_filters(self):
        set_status(self.order1["id"], S.CONFIRMED)
        client = self.as_user(self.staff)
        ids = lambda url: [o["id"] for o in client.get(url).data["results"]]  # noqa: E731
        self.assertEqual(ids("/api/orders/?status=confirmed"), [self.order1["id"]])
        self.assertEqual(
            sorted(ids("/api/orders/?status=confirmed,pending")),
            sorted([self.order1["id"], self.order2["id"]]),
        )
        self.assertEqual(ids(f"/api/orders/?customer={self.customer2.pk}"), [self.order2["id"]])
        self.assertEqual(ids("/api/orders/?rider=%d" % self.rider.pk), [])
        today = timezone.localdate().isoformat()
        self.assertEqual(len(ids(f"/api/orders/?date_from={today}&date_to={today}")), 2)
        self.assertEqual(ids("/api/orders/?date_to=2000-01-01"), [])
        self.assertEqual(len(ids(f"/api/orders/?delivery_date={tomorrow().isoformat()}")), 2)
        self.assertEqual(ids("/api/orders/?payment_method=gcash"), [])

    def test_staff_search(self):
        client = self.as_user(self.staff)
        by_name = client.get("/api/orders/?search=Cust2 Tester")
        self.assertEqual([o["id"] for o in by_name.data["results"]], [self.order2["id"]])
        by_id = client.get(f"/api/orders/?search=%23{self.order1['id']}")
        self.assertEqual([o["id"] for o in by_id.data["results"]], [self.order1["id"]])
        self.assertEqual(client.get("/api/orders/?search=nobody").data["count"], 0)

    def test_invalid_filter_value_uses_error_shape(self):
        response = self.as_user(self.staff).get("/api/orders/?date_from=not-a-date")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")


class StatusTransitionTests(APITestBase):
    def setUp(self):
        self.order = self.place_order()
        self.id = self.order["id"]
        self.url = f"/api/orders/{self.id}"
        self.staff_client = self.as_user(self.staff)

    def status_of(self):
        return Order.objects.get(pk=self.id).order_status

    # -- the happy path ---------------------------------------------------------

    def test_confirm_then_schedule_with_rider(self):
        r = self.staff_client.post(f"{self.url}/confirm/")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["order_status"], "confirmed")
        new_date = (tomorrow() + datetime.timedelta(days=2)).isoformat()
        r = self.staff_client.post(
            f"{self.url}/schedule/",
            {"delivery_date": new_date, "rider": self.rider.pk},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["order_status"], "scheduled")
        self.assertEqual(r.data["delivery_date"], new_date)
        self.assertEqual(r.data["rider"]["id"], self.rider.pk)

    def test_every_change_writes_a_status_log_and_customer_notification(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.staff_client.post(f"{self.url}/confirm/")
            self.staff_client.post(
                f"{self.url}/schedule/", {"delivery_date": tomorrow().isoformat()}, format="json"
            )
        logs = list(OrderStatusLog.objects.filter(order_id=self.id).values_list("from_status", "to_status"))
        self.assertEqual(logs, [("", "pending"), ("pending", "confirmed"), ("confirmed", "scheduled")])
        titles = set(
            Notification.objects.filter(recipient=self.customer, order_id=self.id).values_list("title", flat=True)
        )
        self.assertTrue({"Order confirmed", "Delivery scheduled"} <= titles)
        subjects = [m.subject for m in mail.outbox]
        self.assertTrue(any("Order confirmed" in s for s in subjects))

    def test_timeline_endpoint(self):
        self.staff_client.post(f"{self.url}/confirm/")
        timeline = self.as_user(self.customer).get(f"{self.url}/timeline/")
        self.assertEqual(timeline.status_code, 200)
        self.assertEqual([t["to_status"] for t in timeline.data], ["pending", "confirmed"])
        self.assertEqual(timeline.data[1]["changed_by"]["role"], "staff")

    # -- invalid transitions -> 400 --------------------------------------------

    def test_invalid_transitions_are_400(self):
        self.staff_client.post(f"{self.url}/confirm/")
        again = self.staff_client.post(f"{self.url}/confirm/")
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.status_of(), "confirmed")
        reject_confirmed = self.staff_client.post(
            f"{self.url}/reject/", {"remarks": "no"}, format="json"
        )
        self.assertEqual(reject_confirmed.status_code, 400)

    def test_cannot_skip_states(self):
        for target in ("delivered", "out_for_delivery", "failed"):
            response = self.staff_client.post(
                f"{self.url}/update-status/", {"status": target}, format="json"
            )
            self.assertEqual(response.status_code, 400, target)
        self.assertEqual(self.status_of(), "pending")

    def test_terminal_states_cannot_change(self):
        for terminal in (S.DELIVERED, S.CANCELLED, S.REJECTED):
            set_status(self.id, terminal)
            for target in ("confirmed", "scheduled", "cancelled"):
                response = self.staff_client.post(
                    f"{self.url}/update-status/",
                    {"status": target, "remarks": "x", "delivery_date": tomorrow().isoformat()},
                    format="json",
                )
                self.assertEqual(response.status_code, 400, (terminal, target))

    # -- roles -------------------------------------------------------------------

    def test_staff_cannot_perform_rider_transitions(self):
        set_status(self.id, S.OUT_FOR_DELIVERY, rider=self.rider)
        for admin_or_staff in (self.staff, self.admin):
            response = self.as_user(admin_or_staff).post(
                f"{self.url}/update-status/", {"status": "delivered", "cod_collected": True}, format="json"
            )
            self.assertEqual(response.status_code, 403)
        self.assertEqual(self.status_of(), "out_for_delivery")

    def test_customer_and_rider_cannot_use_staff_actions(self):
        for user in (self.customer, self.rider_user):
            client = self.as_user(user)
            for action in ("confirm", "reject", "schedule", "assign-rider", "update-status"):
                response = client.post(f"{self.url}/{action}/", {}, format="json")
                self.assertEqual(response.status_code, 403, (user.role, action))
        self.assertEqual(self.as_user(self.customer).get("/api/orders/dashboard/").status_code, 403)

    def test_staff_cannot_use_customer_cancel_endpoint(self):
        self.assertEqual(self.staff_client.post(f"{self.url}/cancel/").status_code, 403)

    # -- cancel / reject ---------------------------------------------------------

    def test_customer_can_cancel_pending_order(self):
        response = self.as_user(self.customer).post(
            f"{self.url}/cancel/", {"remarks": "changed my mind"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["order_status"], "cancelled")
        self.assertTrue(
            Notification.objects.filter(recipient=self.staff, title="Order cancelled").exists()
        )

    def test_customer_cannot_cancel_after_confirmation(self):
        self.staff_client.post(f"{self.url}/confirm/")
        response = self.as_user(self.customer).post(f"{self.url}/cancel/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.status_of(), "confirmed")

    def test_reject_requires_reason(self):
        self.assertEqual(self.staff_client.post(f"{self.url}/reject/", {}, format="json").status_code, 400)
        response = self.staff_client.post(
            f"{self.url}/reject/", {"remarks": "Outside delivery area"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["order_status"], "rejected")
        note = Notification.objects.get(recipient=self.customer, title="Order rejected")
        self.assertIn("Outside delivery area", note.message)

    def test_staff_cancel_needs_reason(self):
        self.staff_client.post(f"{self.url}/confirm/")
        no_reason = self.staff_client.post(
            f"{self.url}/update-status/", {"status": "cancelled"}, format="json"
        )
        self.assertEqual(no_reason.status_code, 400)
        ok = self.staff_client.post(
            f"{self.url}/update-status/", {"status": "cancelled", "remarks": "Customer called"}, format="json"
        )
        self.assertEqual(ok.status_code, 200)

    # -- scheduling --------------------------------------------------------------

    def test_schedule_rejects_past_date_and_wrong_status(self):
        past = (timezone.localdate() - datetime.timedelta(days=1)).isoformat()
        not_confirmed = self.staff_client.post(
            f"{self.url}/schedule/", {"delivery_date": tomorrow().isoformat()}, format="json"
        )
        self.assertEqual(not_confirmed.status_code, 400)
        self.staff_client.post(f"{self.url}/confirm/")
        in_past = self.staff_client.post(
            f"{self.url}/schedule/", {"delivery_date": past}, format="json"
        )
        self.assertEqual(in_past.status_code, 400)
        self.assertIn("delivery_date", in_past.data["errors"])
        self.assertEqual(self.status_of(), "confirmed")

    def test_scheduled_order_can_be_rescheduled(self):
        self.staff_client.post(f"{self.url}/confirm/")
        self.staff_client.post(f"{self.url}/schedule/", {"delivery_date": tomorrow().isoformat()}, format="json")
        later = (tomorrow() + datetime.timedelta(days=3)).isoformat()
        response = self.staff_client.post(f"{self.url}/schedule/", {"delivery_date": later}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["delivery_date"], later)
        self.assertEqual(OrderStatusLog.objects.filter(order_id=self.id, to_status="scheduled").count(), 2)

    def test_failed_delivery_can_be_rescheduled(self):
        set_status(self.id, S.FAILED, rider=self.rider)
        response = self.staff_client.post(
            f"{self.url}/schedule/", {"delivery_date": tomorrow().isoformat()}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["order_status"], "scheduled")

    def test_allowed_transitions_are_exposed_per_role(self):
        self.assertEqual(
            sorted(self.staff_client.get(f"{self.url}/").data["allowed_transitions"]),
            ["confirmed", "rejected"],
        )
        self.assertEqual(
            self.as_user(self.customer).get(f"{self.url}/").data["allowed_transitions"], ["cancelled"]
        )
        self.assertFalse(self.staff_client.get(f"{self.url}/").data["can_assign_rider"])

    def test_dashboard_counts(self):
        # self.order delivers tomorrow, so nothing is due today
        data = self.staff_client.get("/api/orders/dashboard/").data
        self.assertEqual(data["today_total"], 0)
        self.assertEqual(data["pending_orders"], 1)
        self.assertEqual(data["available_riders"], 2)
        self.assertEqual(set(data["today_by_status"]), {s.value for s in S})


class RiderAssignmentTests(APITestBase):
    def setUp(self):
        self.order = self.place_order()
        self.url = f"/api/orders/{self.order['id']}"
        self.staff_client = self.as_user(self.staff)
        self.staff_client.post(f"{self.url}/confirm/")

    def assign(self, rider):
        return self.staff_client.post(f"{self.url}/assign-rider/", {"rider": rider.pk}, format="json")

    def test_assign_available_rider_notifies_rider(self):
        response = self.assign(self.rider)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rider"]["id"], self.rider.pk)
        note = Notification.objects.get(recipient=self.rider_user, title="New delivery assigned")
        self.assertEqual(note.order_id, self.order["id"])

    def test_off_duty_rider_cannot_be_assigned(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status=RiderProfile.Status.OFF_DUTY)
        response = self.assign(self.rider)
        self.assertEqual(response.status_code, 400)
        self.assertIn("off duty", response.data["errors"]["rider"][0])
        self.assertIsNone(Order.objects.get(pk=self.order["id"]).rider)

    def test_rider_already_on_a_trip_can_be_assigned_more_orders(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status=RiderProfile.Status.ON_DELIVERY)
        response = self.assign(self.rider)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rider"]["id"], self.rider.pk)
        self.assertEqual(response.data["rider"]["status"], "on_delivery")  # assigning does not change it

    def test_cannot_assign_to_deactivated_rider(self):
        User.objects.filter(pk=self.rider_user.pk).update(is_active=False)
        self.assertEqual(self.assign(self.rider).status_code, 400)

    def test_cannot_assign_rider_to_pending_order(self):
        other = self.place_order()
        response = self.staff_client.post(
            f"/api/orders/{other['id']}/assign-rider/", {"rider": self.rider.pk}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_rider_is_400(self):
        response = self.staff_client.post(f"{self.url}/assign-rider/", {"rider": 9999}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_reassignment_notifies_previous_rider(self):
        self.assign(self.rider)
        self.assertEqual(self.assign(self.rider2).status_code, 200)
        self.assertTrue(
            Notification.objects.filter(recipient=self.rider_user, title="Delivery reassigned").exists()
        )
        self.assertEqual(Order.objects.get(pk=self.order["id"]).rider_id, self.rider2.pk)

    def test_assigning_same_rider_twice_is_a_noop(self):
        self.assign(self.rider)
        self.assertEqual(self.assign(self.rider).status_code, 200)
        self.assertEqual(
            Notification.objects.filter(recipient=self.rider_user, title="New delivery assigned").count(), 1
        )

    def test_schedule_with_unavailable_rider_rolls_back(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status=RiderProfile.Status.OFF_DUTY)
        response = self.staff_client.post(
            f"{self.url}/schedule/",
            {"delivery_date": tomorrow().isoformat(), "rider": self.rider.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.get(pk=self.order["id"]).order_status, "confirmed")


class UserDeletionRulesTests(APITestBase):
    def test_cannot_delete_user_with_orders(self):
        self.place_order()
        response = self.as_user(self.admin).delete(f"/api/auth/users/{self.customer.pk}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.customer.pk).exists())
