
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import override_settings

from apps.core.testing import APITestBase, image_file
from apps.notifications.models import Notification
from apps.orders.models import Order
from apps.payments.models import Payment


class PaymentBase(APITestBase):
    def online_order(self, user=None, method="gcash"):
        data = self.place_order(user, payment_method=method)
        return data, data["payment"]["id"]

    def upload(self, payment_id, user=None, **overrides):
        body = {"proof_image": image_file(), "reference_number": "GC123456", **overrides}
        return self.as_user(user or self.customer).post(
            f"/api/payments/{payment_id}/upload-proof/", body, format="multipart"
        )


class ProofUploadTests(PaymentBase):
    def test_online_order_starts_unpaid_then_pending_verification_after_upload(self):
        order, payment_id = self.online_order()
        self.assertEqual(order["payment"]["payment_status"], "unpaid")
        self.assertEqual(order["payment"]["payment_method"], "gcash")

        response = self.upload(payment_id)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["payment_status"], "pending_verification")
        self.assertEqual(response.data["reference_number"], "GC123456")
        self.assertTrue(response.data["proof_image"].startswith("http"))
        self.assertEqual(response.data["order_summary"]["id"], order["id"])
        self.assertTrue(
            Notification.objects.filter(recipient=self.staff, title="Payment proof uploaded").exists()
        )

    def test_proof_is_required(self):
        _, payment_id = self.online_order()
        response = self.as_user(self.customer).post(
            f"/api/payments/{payment_id}/upload-proof/", {"reference_number": "X1"}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("proof_image", response.data["errors"])
        no_reference = self.as_user(self.customer).post(
            f"/api/payments/{payment_id}/upload-proof/", {"proof_image": image_file()}, format="multipart"
        )
        self.assertIn("reference_number", no_reference.data["errors"])
        self.assertEqual(Payment.objects.get(pk=payment_id).payment_status, "unpaid")

    def test_non_image_is_rejected(self):
        _, payment_id = self.online_order()
        fake = SimpleUploadedFile("proof.png", b"not really an image", content_type="image/png")
        response = self.upload(payment_id, proof_image=fake)
        self.assertEqual(response.status_code, 400)
        self.assertIn("proof_image", response.data["errors"])

    @override_settings(MAX_PROOF_IMAGE_BYTES=100)
    def test_oversized_image_is_rejected(self):
        _, payment_id = self.online_order()
        response = self.upload(payment_id, proof_image=image_file(size=(300, 300)))
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.data["errors"]["proof_image"][0])

    def test_cod_payment_cannot_take_proof(self):
        order = self.place_order()  # cod
        response = self.upload(order["payment"]["id"])
        self.assertEqual(response.status_code, 400)

    def test_cannot_upload_for_someone_elses_payment(self):
        _, payment_id = self.online_order()
        self.assertEqual(self.upload(payment_id, user=self.customer2).status_code, 404)
        for user in (self.staff, self.rider_user):
            self.assertEqual(self.upload(payment_id, user=user).status_code, 403)

    def test_cannot_upload_twice_while_pending(self):
        _, payment_id = self.online_order()
        self.upload(payment_id)
        self.assertEqual(self.upload(payment_id).status_code, 400)

    def test_cannot_upload_for_cancelled_order(self):
        order, payment_id = self.online_order()
        self.as_user(self.customer).post(f"/api/orders/{order['id']}/cancel/")
        self.assertEqual(self.upload(payment_id).status_code, 400)


class VerificationTests(PaymentBase):
    def setUp(self):
        self.order, self.payment_id = self.online_order()
        self.upload(self.payment_id)
        self.staff_client = self.as_user(self.staff)

    def test_staff_verifies_payment(self):
        response = self.staff_client.post(f"/api/payments/{self.payment_id}/verify/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["payment_status"], "paid")
        self.assertEqual(response.data["verified_by"]["id"], self.staff.pk)
        self.assertIsNotNone(response.data["payment_date"])
        self.assertTrue(
            Notification.objects.filter(recipient=self.customer, title="Payment confirmed").exists()
        )

    def test_admin_can_verify_too(self):
        self.assertEqual(self.as_user(self.admin).post(f"/api/payments/{self.payment_id}/verify/").status_code, 200)

    def test_reject_needs_reason_then_customer_can_resubmit(self):
        url = f"/api/payments/{self.payment_id}/reject/"
        self.assertEqual(self.staff_client.post(url, {}, format="json").status_code, 400)
        response = self.staff_client.post(url, {"remarks": "Amount does not match"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["payment_status"], "rejected")
        self.assertEqual(response.data["remarks"], "Amount does not match")
        note = Notification.objects.get(recipient=self.customer, title="Payment rejected")
        self.assertIn("Amount does not match", note.message)

        again = self.upload(self.payment_id, reference_number="GC999")
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(again.data["payment_status"], "pending_verification")
        self.assertEqual(again.data["reference_number"], "GC999")
        self.assertEqual(again.data["remarks"], "")

    def test_only_pending_verification_can_be_reviewed(self):
        self.staff_client.post(f"/api/payments/{self.payment_id}/verify/")
        self.assertEqual(self.staff_client.post(f"/api/payments/{self.payment_id}/verify/").status_code, 400)
        self.assertEqual(
            self.staff_client.post(f"/api/payments/{self.payment_id}/reject/", {"remarks": "x"}, format="json").status_code,
            400,
        )
        _, unpaid_id = self.online_order()
        self.assertEqual(self.staff_client.post(f"/api/payments/{unpaid_id}/verify/").status_code, 400)

    def test_cannot_verify_payment_of_cancelled_order(self):
        Order.objects.filter(pk=self.order["id"]).update(order_status="cancelled")
        self.assertEqual(self.staff_client.post(f"/api/payments/{self.payment_id}/verify/").status_code, 400)

    def test_customer_and_rider_cannot_verify_or_reject(self):
        for user in (self.customer, self.rider_user):
            client = self.as_user(user)
            self.assertEqual(client.post(f"/api/payments/{self.payment_id}/verify/").status_code, 403)
            self.assertEqual(
                client.post(f"/api/payments/{self.payment_id}/reject/", {"remarks": "x"}, format="json").status_code,
                403,
            )
        self.assertEqual(Payment.objects.get(pk=self.payment_id).payment_status, "pending_verification")

    def test_visibility_and_queue_filter(self):
        _, other_id = self.online_order(self.customer2)
        queue = self.staff_client.get("/api/payments/?payment_status=pending_verification")
        self.assertEqual([p["id"] for p in queue.data["results"]], [self.payment_id])
        self.assertEqual(self.staff_client.get("/api/payments/").data["count"], 2)

        mine = self.as_user(self.customer).get("/api/payments/")
        self.assertEqual([p["id"] for p in mine.data["results"]], [self.payment_id])
        self.assertEqual(self.as_user(self.customer).get(f"/api/payments/{other_id}/").status_code, 404)
        self.assertEqual(self.as_user(self.rider_user).get("/api/payments/").status_code, 200)
        self.assertEqual(self.as_user(self.rider_user).get("/api/payments/").data["count"], 0)
        self.assertEqual(self.staff_client.get("/api/payments/?payment_method=gcash").data["count"], 2)
        self.assertEqual(self.staff_client.get("/api/payments/?payment_method=cod").data["count"], 0)
        self.assertEqual(self.staff_client.get("/api/payments/?search=GC123456").data["count"], 1)


class PaymentModelConstraintTests(PaymentBase):
    def test_online_payment_cannot_be_pending_or_paid_without_proof(self):
        order = Order.objects.get(pk=self.place_order(payment_method="gcash")["id"])
        for status in ("pending_verification", "paid"):
            with self.assertRaises(IntegrityError), transaction.atomic():
                Payment.objects.filter(order=order).update(payment_status=status)
        Payment.objects.filter(order=order).update(payment_method="cod", payment_status="paid")
