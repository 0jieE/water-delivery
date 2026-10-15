import io
import os
import re
import tempfile

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APIClient

from apps.core.testing import APITestBase, image_file
from apps.orders.models import Order
from apps.payments.models import Payment, PaymentSettings

URL = "/api/payments/settings/"
QR_URL = re.compile(r"^http://testserver/media/payment_settings/[0-9a-f]{32}\.png$")


def stored_files():
    folder = os.path.join(settings.MEDIA_ROOT, "payment_settings")
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


class FreshMediaTestBase(APITestBase):
    """Each test gets its own empty media folder so file counts are exact."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.enterContext(override_settings(MEDIA_ROOT=folder.name))


class PaymentSettingsReadTests(FreshMediaTestBase):
    def test_a_row_already_exists_and_is_empty(self):
        self.assertEqual(PaymentSettings.objects.count(), 1)  # created by the migration
        response = self.as_user(self.customer).get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(), {"gcash_qr_image": None, "gcash_account_name": "", "gcash_number": ""}
        )

    def test_any_signed_in_role_can_read_but_anonymous_cannot(self):
        for user in (self.customer, self.rider_user, self.staff, self.admin):
            self.assertEqual(self.as_user(user).get(URL).status_code, 200, user.role)
        anonymous = APIClient().get(URL)
        self.assertEqual(anonymous.status_code, 401)
        self.assertEqual(set(anonymous.data), {"detail", "code", "errors"})

    def test_it_is_never_not_found_even_if_the_row_was_deleted(self):
        PaymentSettings.objects.all().delete()
        response = self.as_user(self.customer).get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(PaymentSettings.objects.count(), 1)

    def test_other_methods_are_not_allowed(self):
        admin = self.as_user(self.admin)
        for method in (admin.post, admin.put, admin.delete):
            self.assertEqual(method(URL).status_code, 405)

    def test_settings_url_is_not_mistaken_for_a_payment_id(self):
        self.assertEqual(self.as_user(self.customer).get("/api/payments/").status_code, 200)
        self.assertEqual(self.as_user(self.customer).get("/api/payments/999/").status_code, 404)


class PaymentSettingsWriteTests(FreshMediaTestBase):
    def patch(self, user=None, **fields):
        return self.as_user(user or self.admin).patch(URL, fields, format="multipart")

    def test_admin_sets_qr_name_and_number(self):
        response = self.patch(
            gcash_qr_image=image_file("my qr.png"),
            gcash_account_name="Deep Water Refilling",
            gcash_number="0917 123 4567",
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertRegex(body["gcash_qr_image"], QR_URL)  # absolute URL, random file name
        self.assertEqual(body["gcash_account_name"], "Deep Water Refilling")
        self.assertEqual(body["gcash_number"], "0917 123 4567")
        self.assertEqual(len(stored_files()), 1)

        # a customer sees exactly what the admin saved
        seen = self.as_user(self.customer).get(URL).json()
        self.assertEqual(seen, body)
        self.assertEqual(PaymentSettings.objects.count(), 1)

    def test_original_file_name_is_not_kept(self):
        self.patch(gcash_qr_image=image_file("secret-name.png"))
        self.assertNotIn("secret-name", stored_files()[0])

    def test_new_qr_replaces_the_old_file(self):
        first = self.patch(gcash_qr_image=image_file("a.png")).json()["gcash_qr_image"]
        second = self.patch(gcash_qr_image=image_file("b.png")).json()["gcash_qr_image"]
        self.assertNotEqual(first, second)
        self.assertEqual(len(stored_files()), 1)  # the old one was deleted
        self.assertTrue(second.endswith(stored_files()[0]))

    def test_admin_can_clear_the_qr_with_an_empty_value(self):
        self.patch(gcash_qr_image=image_file(), gcash_account_name="Keep me")
        self.assertEqual(len(stored_files()), 1)
        cleared = self.patch(gcash_qr_image="")
        self.assertEqual(cleared.status_code, 200, cleared.data)
        self.assertIsNone(cleared.json()["gcash_qr_image"])
        self.assertEqual(cleared.json()["gcash_account_name"], "Keep me")  # other fields untouched
        self.assertEqual(stored_files(), [])
        self.assertIsNone(self.as_user(self.customer).get(URL).json()["gcash_qr_image"])

    def test_admin_can_clear_the_qr_with_json_null(self):
        self.patch(gcash_qr_image=image_file())
        response = self.as_user(self.admin).patch(URL, {"gcash_qr_image": None}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.json()["gcash_qr_image"])
        self.assertEqual(stored_files(), [])

    def test_text_only_patch_keeps_the_qr(self):
        self.patch(gcash_qr_image=image_file())
        response = self.as_user(self.admin).patch(URL, {"gcash_number": "09171234567"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertRegex(response.json()["gcash_qr_image"], QR_URL)
        self.assertEqual(len(stored_files()), 1)

    def test_text_fields_can_be_blanked_and_are_trimmed(self):
        self.patch(gcash_account_name="  Station  ", gcash_number="09170000000")
        saved = self.as_user(self.customer).get(URL).json()
        self.assertEqual(saved["gcash_account_name"], "Station")
        blanked = self.patch(gcash_account_name="", gcash_number="")
        self.assertEqual(blanked.status_code, 200)
        self.assertEqual((blanked.json()["gcash_account_name"], blanked.json()["gcash_number"]), ("", ""))

    def test_only_admin_can_change_settings(self):
        for user in (self.customer, self.rider_user, self.staff):
            response = self.patch(user, gcash_account_name="Hacker")
            self.assertEqual(response.status_code, 403, user.role)
            self.assertEqual(set(response.data), {"detail", "code", "errors"})
        self.assertEqual(APIClient().patch(URL, {"gcash_account_name": "x"}, format="json").status_code, 401)
        self.assertEqual(PaymentSettings.load().gcash_account_name, "")

    @override_settings(MAX_PROOF_IMAGE_BYTES=100)
    def test_oversized_image_is_rejected(self):
        response = self.patch(gcash_qr_image=image_file(size=(300, 300)))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("too large", response.data["errors"]["gcash_qr_image"][0])
        self.assertEqual(stored_files(), [])

    def test_non_image_files_are_rejected(self):
        for name, content, ctype in (
            ("qr.png", b"definitely not an image", "image/png"),
            ("notes.txt", b"hello", "text/plain"),
            ("qr.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml"),
        ):
            response = self.patch(gcash_qr_image=SimpleUploadedFile(name, content, content_type=ctype))
            self.assertEqual(response.status_code, 400, name)
            self.assertIn("gcash_qr_image", response.data["errors"], name)
        self.assertEqual(stored_files(), [])

    def test_a_failed_upload_keeps_the_existing_qr(self):
        good = self.patch(gcash_qr_image=image_file()).json()["gcash_qr_image"]
        bad = self.patch(gcash_qr_image=SimpleUploadedFile("x.png", b"nope", content_type="image/png"))
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.as_user(self.customer).get(URL).json()["gcash_qr_image"], good)
        self.assertEqual(len(stored_files()), 1)

    def test_other_jpeg_like_formats_are_accepted(self):
        buffer = io.BytesIO()
        Image.new("RGB", (10, 10), "white").save(buffer, format="JPEG")
        upload = SimpleUploadedFile("qr.jpg", buffer.getvalue(), content_type="image/jpeg")
        response = self.patch(gcash_qr_image=upload)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.json()["gcash_qr_image"].endswith(".jpg"))

    def test_text_field_validation(self):
        too_long_name = self.patch(gcash_account_name="x" * 101)
        self.assertIn("gcash_account_name", too_long_name.data["errors"])
        too_long_number = self.patch(gcash_number="1" * 21)
        self.assertIn("gcash_number", too_long_number.data["errors"])
        letters = self.patch(gcash_number="call me maybe")
        self.assertEqual(letters.status_code, 400)
        self.assertIn("gcash_number", letters.data["errors"])


class BankTransferRemovedTests(APITestBase):
    def post(self, method):
        return self.as_user(self.customer).post(
            "/api/orders/", self.order_payload(payment_method=method), format="json"
        )

    def test_new_orders_cannot_use_bank_transfer(self):
        response = self.post("bank_transfer")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "validation_error")
        self.assertIn("payment_method", response.data["errors"])
        self.assertEqual(Order.objects.count(), 0)

    def test_cod_and_gcash_still_work(self):
        for method in ("cod", "gcash"):
            response = self.post(method)
            self.assertEqual(response.status_code, 201, (method, response.data))
            self.assertEqual(response.data["payment"]["payment_method"], method)

    def test_old_bank_transfer_orders_still_read_and_filter(self):
        order = Order.objects.get(pk=self.place_order(payment_method="gcash")["id"])
        Payment.objects.filter(order=order).update(payment_method="bank_transfer")

        for user in (self.customer, self.staff, self.admin):
            detail = self.as_user(user).get(f"/api/orders/{order.pk}/").json()
            self.assertEqual(detail["payment"]["payment_method"], "bank_transfer")
            self.assertEqual(detail["payment"]["payment_method_display"], "Bank transfer")
        staff = self.as_user(self.staff)
        self.assertEqual(staff.get("/api/orders/?payment_method=bank_transfer").json()["count"], 1)
        self.assertEqual(staff.get("/api/payments/?payment_method=bank_transfer").json()["count"], 1)
        self.assertEqual(staff.get(f"/api/payments/{order.payment.pk}/").status_code, 200)
