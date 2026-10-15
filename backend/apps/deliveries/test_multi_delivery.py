from django.test import override_settings

from apps.core.testing import APITestBase, tomorrow
from apps.deliveries.models import RiderProfile
from apps.notifications.models import Notification
from apps.orders.models import Order, OrderStatusLog
from apps.payments.models import Payment


class MultiDeliveryBase(APITestBase):
    def make_scheduled(self, rider=None, **overrides):
        """An order confirmed, scheduled and assigned through the API."""
        order = self.place_order(**overrides)
        staff = self.as_user(self.staff)
        url = f"/api/orders/{order['id']}"
        staff.post(f"{url}/confirm/")
        response = staff.post(
            f"{url}/schedule/",
            {"delivery_date": tomorrow().isoformat(), "rider": (rider or self.rider).pk},
            format="json",
        )
        assert response.status_code == 200, response.data
        return order["id"]

    def rider_status(self, rider=None):
        return RiderProfile.objects.get(pk=(rider or self.rider).pk).status

    def set_status(self, order_id, status, remarks="", **extra):
        return self.as_user(self.rider_user).post(
            f"/api/deliveries/my/{order_id}/status/", {"status": status, "remarks": remarks, **extra}, format="json"
        )


class SeveralDeliveriesAtOnceTests(MultiDeliveryBase):
    def setUp(self):
        self.first, self.second, self.third = (self.make_scheduled() for _ in range(3))

    def test_second_delivery_can_start_while_the_first_is_out(self):
        self.assertEqual(self.set_status(self.first, "out_for_delivery").status_code, 200)
        response = self.set_status(self.second, "out_for_delivery")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["order_status"], "out_for_delivery")
        self.assertEqual(response.data["rider_status"], "on_delivery")
        self.assertEqual(self.rider_status(), "on_delivery")
        self.assertEqual(Order.objects.filter(order_status="out_for_delivery").count(), 2)

    def test_off_duty_rider_still_cannot_start(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="off_duty")
        response = self.set_status(self.first, "out_for_delivery")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.get(pk=self.first).order_status, "scheduled")

    def test_rider_stays_on_delivery_until_the_last_order_is_finished(self):
        for order_id in (self.first, self.second, self.third):
            self.set_status(order_id, "out_for_delivery")

        delivered = self.set_status(self.first, "delivered", cod_collected=True)
        self.assertEqual(delivered.status_code, 200, delivered.data)
        self.assertEqual(self.rider_status(), "on_delivery")  # two are still out
        self.assertEqual(delivered.data["rider_status"], "on_delivery")

        failed = self.set_status(self.second, "failed", remarks="Nobody home")
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(self.rider_status(), "on_delivery")  # one is still out

        last = self.set_status(self.third, "delivered", cod_collected=True)
        self.assertEqual(last.status_code, 200)
        self.assertEqual(self.rider_status(), "available")
        self.assertEqual(last.data["rider_status"], "available")

    def test_finishing_a_delivery_that_was_alone_frees_the_rider(self):
        self.set_status(self.first, "out_for_delivery")
        self.set_status(self.first, "failed", remarks="Wrong address")
        self.assertEqual(self.rider_status(), "available")

    def test_cod_and_failure_rules_still_apply_to_each_order(self):
        self.set_status(self.first, "out_for_delivery")
        self.set_status(self.second, "out_for_delivery")
        no_cash = self.set_status(self.first, "delivered")
        self.assertEqual(no_cash.status_code, 400)
        self.assertIn("cod_collected", no_cash.data["errors"])
        no_reason = self.set_status(self.second, "failed")
        self.assertEqual(no_reason.status_code, 400)
        self.assertIn("remarks", no_reason.data["errors"])
        self.assertEqual(self.rider_status(), "on_delivery")
        self.assertEqual(Payment.objects.get(order_id=self.first).payment_status, "unpaid")

    def test_each_status_change_logs_and_notifies_the_customer(self):
        self.set_status(self.first, "out_for_delivery")
        self.set_status(self.second, "out_for_delivery")
        self.set_status(self.first, "delivered", cod_collected=True)
        for order_id, titles in ((self.first, {"Out for delivery", "Order delivered"}), (self.second, {"Out for delivery"})):
            logged = list(OrderStatusLog.objects.filter(order_id=order_id).values_list("to_status", flat=True))
            self.assertEqual(logged[-1], "delivered" if order_id == self.first else "out_for_delivery")
            sent = set(Notification.objects.filter(recipient=self.customer, order_id=order_id).values_list("title", flat=True))
            self.assertTrue(titles <= sent, (order_id, sent))

    def test_availability_is_blocked_while_any_order_is_out(self):
        client = self.as_user(self.rider_user)
        self.set_status(self.first, "out_for_delivery")
        self.set_status(self.second, "out_for_delivery")
        self.set_status(self.first, "delivered", cod_collected=True)  # one still out
        for status in ("off_duty", "available"):
            blocked = client.post("/api/deliveries/my/availability/", {"status": status}, format="json")
            self.assertEqual(blocked.status_code, 400, status)
        self.set_status(self.second, "delivered", cod_collected=True)
        ok = client.post("/api/deliveries/my/availability/", {"status": "off_duty"}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_admin_cannot_set_off_duty_while_orders_are_out(self):
        self.set_status(self.first, "out_for_delivery")
        url = f"/api/deliveries/riders/{self.rider.pk}/"
        response = self.as_user(self.admin).patch(url, {"status": "off_duty"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("status", response.data["errors"])
        self.set_status(self.first, "failed", remarks="x")
        self.assertEqual(self.as_user(self.admin).patch(url, {"status": "off_duty"}, format="json").status_code, 200)

    def test_my_deliveries_still_lists_in_progress_first(self):
        self.set_status(self.second, "out_for_delivery")
        results = self.as_user(self.rider_user).get("/api/deliveries/my/").json()["results"]
        self.assertEqual(results[0]["id"], self.second)
        self.assertEqual(results[0]["order_status"], "out_for_delivery")
        self.assertEqual({r["id"] for r in results}, {self.first, self.second, self.third})


class AssigningToBusyRidersTests(MultiDeliveryBase):
    def test_staff_can_give_more_orders_to_a_rider_on_a_trip(self):
        first = self.make_scheduled()
        self.set_status(first, "out_for_delivery")
        self.assertEqual(self.rider_status(), "on_delivery")

        order = self.place_order()
        staff = self.as_user(self.staff)
        staff.post(f"/api/orders/{order['id']}/confirm/")
        assign = staff.post(f"/api/orders/{order['id']}/assign-rider/", {"rider": self.rider.pk}, format="json")
        self.assertEqual(assign.status_code, 200, assign.data)
        schedule = staff.post(
            f"/api/orders/{order['id']}/schedule/",
            {"delivery_date": tomorrow().isoformat(), "rider": self.rider.pk},
            format="json",
        )
        self.assertEqual(schedule.status_code, 200, schedule.data)
        self.assertEqual(self.rider_status(), "on_delivery")

    def test_schedule_with_an_off_duty_rider_is_still_rejected(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="off_duty")
        order = self.place_order()
        staff = self.as_user(self.staff)
        staff.post(f"/api/orders/{order['id']}/confirm/")
        response = staff.post(
            f"/api/orders/{order['id']}/schedule/",
            {"delivery_date": tomorrow().isoformat(), "rider": self.rider.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("rider", response.data["errors"])
        self.assertEqual(Order.objects.get(pk=order["id"]).order_status, "confirmed")

    @override_settings(MAX_ACTIVE_ORDERS_PER_RIDER=2)
    def test_active_order_cap(self):
        self.make_scheduled()
        self.make_scheduled()
        order = self.place_order()
        staff = self.as_user(self.staff)
        staff.post(f"/api/orders/{order['id']}/confirm/")
        response = staff.post(f"/api/orders/{order['id']}/assign-rider/", {"rider": self.rider.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("maximum 2", response.data["errors"]["rider"][0])
        # another rider is fine, and so is the rider once a slot frees up
        self.assertEqual(
            staff.post(f"/api/orders/{order['id']}/assign-rider/", {"rider": self.rider2.pk}, format="json").status_code,
            200,
        )

    @override_settings(MAX_ACTIVE_ORDERS_PER_RIDER=1)
    def test_finished_orders_do_not_count_towards_the_cap(self):
        done = self.make_scheduled()
        self.set_status(done, "out_for_delivery")
        self.set_status(done, "delivered", cod_collected=True)
        self.make_scheduled()  # fits: the delivered one is no longer active

    @override_settings(MAX_ACTIVE_ORDERS_PER_RIDER=0)
    def test_cap_of_zero_means_unlimited(self):
        for _ in range(4):
            self.make_scheduled()

    def test_default_cap_is_about_ten(self):
        from django.conf import settings

        self.assertEqual(settings.MAX_ACTIVE_ORDERS_PER_RIDER, 10)


class AssignableFilterTests(MultiDeliveryBase):
    def ids(self, query):
        response = self.as_user(self.staff).get(f"/api/deliveries/riders/?{query}")
        self.assertEqual(response.status_code, 200)
        return {r["id"] for r in response.json()}

    def test_assignable_includes_available_and_on_delivery_but_not_off_duty_or_inactive(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="on_delivery")
        self.assertEqual(self.ids("assignable=true"), {self.rider.pk, self.rider2.pk})

        RiderProfile.objects.filter(pk=self.rider2.pk).update(status="off_duty")
        self.assertEqual(self.ids("assignable=true"), {self.rider.pk})
        self.assertEqual(self.ids("assignable=false"), {self.rider2.pk})

        self.rider_user.is_active = False
        self.rider_user.save()
        self.assertEqual(self.ids("assignable=true"), set())

    def test_old_status_filter_is_unchanged(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="on_delivery")
        self.assertEqual(self.ids("status=available&is_active=true"), {self.rider2.pk})

    def test_filter_is_available_to_staff_and_admin_only(self):
        for user, code in ((self.admin, 200), (self.staff, 200), (self.customer, 403), (self.rider_user, 403)):
            self.assertEqual(self.as_user(user).get("/api/deliveries/riders/?assignable=true").status_code, code)


class BulkStartTests(MultiDeliveryBase):
    URL = "/api/deliveries/my/start/"

    def setUp(self):
        self.a, self.b, self.c = (self.make_scheduled() for _ in range(3))
        self.client_r = self.as_user(self.rider_user)

    def start(self, ids):
        return self.client_r.post(self.URL, {"orders": ids}, format="json")

    def test_starts_all_in_one_call_in_the_requested_order(self):
        response = self.start([self.c, self.a, self.b])
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual([d["id"] for d in body], [self.c, self.a, self.b])
        for delivery in body:
            self.assertEqual(delivery["order_status"], "out_for_delivery")
            self.assertEqual(delivery["rider_status"], "on_delivery")
            self.assertIn("amount_to_collect", delivery)  # same shape as deliveries/my/
            self.assertNotIn("email", delivery["customer"])
        self.assertEqual(self.rider_status(), "on_delivery")

    def test_one_log_row_and_one_notification_per_order(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.start([self.a, self.b])
        for order_id in (self.a, self.b):
            logs = OrderStatusLog.objects.filter(order_id=order_id, to_status="out_for_delivery")
            self.assertEqual(logs.count(), 1)
            self.assertEqual(logs[0].changed_by, self.rider_user)
            notes = Notification.objects.filter(recipient=self.customer, order_id=order_id, title="Out for delivery")
            self.assertEqual(notes.count(), 1)
        self.assertEqual(OrderStatusLog.objects.filter(order_id=self.c, to_status="out_for_delivery").count(), 0)

    def test_matches_the_single_order_call(self):
        bulk = self.start([self.a]).json()[0]
        single = self.set_status(self.b, "out_for_delivery").json()
        self.assertEqual(set(bulk), set(single))

    def test_rolls_back_everything_if_one_order_is_not_scheduled(self):
        self.set_status(self.b, "out_for_delivery")
        self.set_status(self.b, "failed", remarks="x")  # now 'failed'
        response = self.start([self.a, self.b, self.c])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn(f"#{self.b}", response.data["errors"]["orders"][0])
        for order_id in (self.a, self.c):
            self.assertEqual(Order.objects.get(pk=order_id).order_status, "scheduled")
            self.assertEqual(OrderStatusLog.objects.filter(order_id=order_id, to_status="out_for_delivery").count(), 0)
        self.assertEqual(self.rider_status(), "available")

    def test_rolls_back_if_one_order_belongs_to_another_rider_or_does_not_exist(self):
        theirs = self.make_scheduled(rider=self.rider2)
        for bad in (theirs, 999999):
            response = self.start([self.a, bad, self.b])
            self.assertEqual(response.status_code, 400, bad)
            self.assertIn(f"#{bad}", response.data["errors"]["orders"][0])
        self.assertEqual(Order.objects.get(pk=self.a).order_status, "scheduled")
        self.assertEqual(Order.objects.get(pk=theirs).order_status, "scheduled")
        self.assertEqual(Notification.objects.filter(title="Out for delivery").count(), 0)

    def test_off_duty_rider_cannot_bulk_start_and_nothing_changes(self):
        RiderProfile.objects.filter(pk=self.rider.pk).update(status="off_duty")
        self.assertEqual(self.start([self.a, self.b]).status_code, 400)
        self.assertEqual(Order.objects.filter(order_status="out_for_delivery").count(), 0)

    def test_orders_already_out_cannot_be_started_again(self):
        self.start([self.a])
        response = self.start([self.a, self.b])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Order.objects.get(pk=self.b).order_status, "scheduled")

    def test_input_validation(self):
        for body in ({}, {"orders": []}, {"orders": "49"}, {"orders": ["x"]}, {"orders": [0]}, {"orders": [10**30]}, {"orders": list(range(1, 52))}):
            response = self.client_r.post(self.URL, body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertEqual(response.data["code"], "validation_error", body)
            self.assertIn("orders", response.data["errors"], body)

    def test_duplicate_ids_are_ignored(self):
        response = self.start([self.a, self.a, self.b])
        self.assertEqual(response.status_code, 200)
        self.assertEqual([d["id"] for d in response.json()], [self.a, self.b])

    def test_only_riders_can_use_it(self):
        for user in (self.customer, self.staff, self.admin):
            self.assertEqual(self.as_user(user).post(self.URL, {"orders": [self.a]}, format="json").status_code, 403)
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().post(self.URL, {"orders": [self.a]}, format="json").status_code, 401)

    def test_start_then_finish_each_with_the_usual_rules(self):
        self.start([self.a, self.b])
        self.assertEqual(self.set_status(self.a, "delivered", cod_collected=True).status_code, 200)
        self.assertEqual(self.rider_status(), "on_delivery")
        self.assertEqual(self.set_status(self.b, "delivered", cod_collected=True).status_code, 200)
        self.assertEqual(self.rider_status(), "available")
