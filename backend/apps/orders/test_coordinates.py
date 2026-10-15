from decimal import Decimal

from apps.core.testing import APITestBase
from apps.orders.models import Order

S = Order.Status


def set_status(order_id, status, rider=None):
    Order.objects.filter(pk=order_id).update(order_status=status, rider=rider)


class DeliveryCoordinateTests(APITestBase):
    PIN = {"delivery_latitude": 7.0083, "delivery_longitude": 125.0894}

    def post(self, **overrides):
        return self.as_user(self.customer).post(
            "/api/orders/", self.order_payload(**overrides), format="json"
        )

    def test_order_with_valid_coordinates(self):
        response = self.post(**self.PIN)
        self.assertEqual(response.status_code, 201, response.data)
        body = response.json()
        # JSON numbers, not strings
        self.assertEqual(body["delivery_latitude"], 7.0083)
        self.assertEqual(body["delivery_longitude"], 125.0894)
        order = Order.objects.get(pk=body["id"])
        self.assertEqual(order.delivery_latitude, Decimal("7.008300"))
        self.assertEqual(order.delivery_longitude, Decimal("125.089400"))

    def test_coordinates_are_optional(self):
        for extra in ({}, {"delivery_latitude": None, "delivery_longitude": None}):
            response = self.post(**extra)
            self.assertEqual(response.status_code, 201, response.data)
            body = response.json()
            self.assertIsNone(body["delivery_latitude"])
            self.assertIsNone(body["delivery_longitude"])
        self.assertIsNone(Order.objects.latest("id").delivery_latitude)

    def test_boundary_values_are_accepted(self):
        for lat, lon in ((90, 180), (-90, -180), (0, 0)):
            response = self.post(delivery_latitude=lat, delivery_longitude=lon)
            self.assertEqual(response.status_code, 201, (lat, lon, response.data))

    def test_only_one_coordinate_is_rejected_on_the_missing_field(self):
        only_lat = self.post(delivery_latitude=7.0)
        self.assertEqual(only_lat.status_code, 400)
        self.assertEqual(only_lat.data["code"], "validation_error")
        self.assertEqual(list(only_lat.data["errors"]), ["delivery_longitude"])
        only_lon = self.post(delivery_longitude=125.0)
        self.assertEqual(list(only_lon.data["errors"]), ["delivery_latitude"])
        lat_null = self.post(delivery_latitude=7.0, delivery_longitude=None)
        self.assertEqual(list(lat_null.data["errors"]), ["delivery_longitude"])
        self.assertEqual(Order.objects.count(), 0)

    def test_out_of_range_and_invalid_values_are_rejected(self):
        cases = [
            ({"delivery_latitude": 90.5, "delivery_longitude": 125.0}, "delivery_latitude"),
            ({"delivery_latitude": -91, "delivery_longitude": 125.0}, "delivery_latitude"),
            ({"delivery_latitude": 7.0, "delivery_longitude": 180.01}, "delivery_longitude"),
            ({"delivery_latitude": 7.0, "delivery_longitude": -181}, "delivery_longitude"),
            ({"delivery_latitude": "abc", "delivery_longitude": 125.0}, "delivery_latitude"),
            ({"delivery_latitude": "nan", "delivery_longitude": 125.0}, "delivery_latitude"),
            ({"delivery_latitude": 7.0, "delivery_longitude": "inf"}, "delivery_longitude"),
        ]
        for payload, field in cases:
            response = self.post(**payload)
            self.assertEqual(response.status_code, 400, payload)
            self.assertIn(field, response.data["errors"], payload)
        self.assertEqual(Order.objects.count(), 0)

    def test_long_decimals_from_a_map_are_rounded_not_rejected(self):
        response = self.post(delivery_latitude=7.00833333333333, delivery_longitude=125.08940000000001)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.json()["delivery_latitude"], 7.008333)
        self.assertEqual(response.json()["delivery_longitude"], 125.0894)

    def test_every_role_sees_coordinates_on_orders_it_may_see(self):
        order = self.post(**self.PIN).json()
        set_status(order["id"], S.SCHEDULED, rider=self.rider)
        for user in (self.customer, self.staff, self.admin, self.rider_user):
            client = self.as_user(user)
            detail = client.get(f"/api/orders/{order['id']}/").json()
            self.assertEqual(detail["delivery_latitude"], 7.0083, user.role)
            self.assertEqual(detail["delivery_longitude"], 125.0894, user.role)
            listing = client.get("/api/orders/").json()["results"]
            self.assertEqual(listing[0]["delivery_latitude"], 7.0083, user.role)

    def test_rider_gets_coordinates_in_my_deliveries(self):
        order = self.post(**self.PIN).json()
        set_status(order["id"], S.SCHEDULED, rider=self.rider)
        client = self.as_user(self.rider_user)
        delivery = client.get(f"/api/deliveries/my/{order['id']}/").json()
        self.assertEqual((delivery["delivery_latitude"], delivery["delivery_longitude"]), (7.0083, 125.0894))
        listed = client.get("/api/deliveries/my/").json()["results"][0]
        self.assertEqual(listed["delivery_latitude"], 7.0083)

    def test_orders_without_a_pin_serialize_as_null_for_the_rider(self):
        order = self.post().json()
        set_status(order["id"], S.SCHEDULED, rider=self.rider)
        delivery = self.as_user(self.rider_user).get(f"/api/deliveries/my/{order['id']}/").json()
        self.assertIsNone(delivery["delivery_latitude"])
        self.assertIsNone(delivery["delivery_longitude"])

    def test_customer_cannot_see_another_customers_pin(self):
        order = self.post(**self.PIN).json()
        other = self.as_user(self.customer2)
        self.assertEqual(other.get(f"/api/orders/{order['id']}/").status_code, 404)
        self.assertEqual(other.get("/api/orders/").json()["count"], 0)

    def test_coordinates_cannot_be_changed_after_ordering(self):
        order = self.post(**self.PIN).json()
        response = self.as_user(self.staff).post(
            f"/api/orders/{order['id']}/update-status/",
            {"status": "confirmed", "delivery_latitude": 1, "delivery_longitude": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["delivery_latitude"], 7.0083)
