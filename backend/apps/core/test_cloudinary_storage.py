import re
from io import BytesIO
from unittest import mock

import cloudinary
from django.core.files.base import ContentFile
from django.test import SimpleTestCase, override_settings

from apps.core.testing import APITestBase, image_file
from config.cloudinary_storage import CloudinaryStorage

CLOUDINARY = {
    "default": {"BACKEND": "config.cloudinary_storage.CloudinaryStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}


class FakeCloudinaryConfig:
    """Fake credentials for building signed URLs; the real configuration is restored afterwards."""

    def setUp(self):
        super().setUp()
        previous = dict(cloudinary.config().__dict__)
        self.addCleanup(lambda: cloudinary.config(**previous))
        cloudinary.config(cloud_name="democloud", api_key="123456", api_secret="not-a-real-secret", secure=True)


class CloudinaryStorageTests(FakeCloudinaryConfig, SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.storage = CloudinaryStorage()

    def test_save_uploads_privately_under_the_same_name(self):
        with mock.patch("cloudinary.uploader.upload", return_value={"public_id": "x"}) as upload, mock.patch(
            "cloudinary.api.resource", side_effect=AssertionError("no existence check is needed")
        ):
            name = self.storage.save("payment_proofs/abc123.png", ContentFile(b"PNGDATA", name="proof.png"))
        self.assertEqual(name, "payment_proofs/abc123.png")  # what the database stores
        args, kwargs = upload.call_args
        self.assertEqual(args[0].read(), b"PNGDATA")
        self.assertEqual(kwargs["public_id"], "payment_proofs/abc123")  # extension is kept apart by Cloudinary
        self.assertEqual(kwargs["type"], "authenticated")  # only signed links work
        self.assertEqual(kwargs["resource_type"], "image")
        self.assertFalse(kwargs["overwrite"])

    def test_url_is_a_signed_https_link(self):
        url = self.storage.url("payment_proofs/abc123.png")
        self.assertRegex(
            url,
            r"^https://res\.cloudinary\.com/democloud/image/authenticated/s--[\w-]{8}--/(v\d+/)?payment_proofs/abc123\.png$",
        )
        self.assertEqual(url, self.storage.url("payment_proofs/abc123.png"))  # no network, deterministic

    def test_signature_depends_on_the_file_and_the_secret(self):
        signature = lambda u: re.search(r"/s--([\w-]+)--/", u).group(1)  # noqa: E731
        first = signature(self.storage.url("payment_proofs/aaa.png"))
        other_file = signature(self.storage.url("payment_proofs/bbb.png"))
        cloudinary.config(api_secret="a-different-secret")
        other_secret = signature(self.storage.url("payment_proofs/aaa.png"))
        self.assertNotEqual(first, other_file)
        self.assertNotEqual(first, other_secret)

    def test_jpeg_and_other_extensions_are_kept_in_the_link(self):
        self.assertTrue(self.storage.url("payment_settings/qr.jpg").endswith("payment_settings/qr.jpg"))

    def test_delete_removes_the_asset_and_clears_the_cdn_cache(self):
        with mock.patch("cloudinary.uploader.destroy") as destroy:
            self.storage.delete("payment_proofs/abc123.png")
        destroy.assert_called_once_with(
            "payment_proofs/abc123", type="authenticated", resource_type="image", invalidate=True
        )

    def test_exists(self):
        with mock.patch("cloudinary.api.resource", return_value={"bytes": 10}):
            self.assertTrue(self.storage.exists("a/b.png"))
            self.assertEqual(self.storage.size("a/b.png"), 10)
        with mock.patch("cloudinary.api.resource", side_effect=cloudinary.exceptions.NotFound("nope")):
            self.assertFalse(self.storage.exists("a/b.png"))

    def test_windows_style_paths_are_normalised(self):
        self.assertEqual(CloudinaryStorage._split("payment_proofs\\abc.PNG"), ("payment_proofs/abc", "png"))


@override_settings(STORAGES=CLOUDINARY)
class GcashQrOnCloudinaryTests(FakeCloudinaryConfig, APITestBase):
    """The real QR upload endpoint, with Cloudinary as the storage (network calls mocked)."""

    URL = "/api/payments/settings/"

    def setUp(self):
        super().setUp()
        upload = mock.patch("cloudinary.uploader.upload", return_value={"public_id": "x"})
        destroy = mock.patch("cloudinary.uploader.destroy")
        self.upload, self.destroy = upload.start(), destroy.start()
        self.addCleanup(upload.stop)
        self.addCleanup(destroy.stop)

    def patch(self, **fields):
        return self.as_user(self.admin).patch(self.URL, fields, format="multipart")

    def test_upload_goes_to_cloudinary_and_the_api_returns_a_signed_https_link(self):
        response = self.patch(gcash_qr_image=image_file("my qr.png"))
        self.assertEqual(response.status_code, 200, response.data)
        link = response.json()["gcash_qr_image"]
        self.assertRegex(link, r"^https://res\.cloudinary\.com/democloud/image/authenticated/s--[\w-]{8}--/")
        self.assertRegex(link, r"payment_settings/[0-9a-f]{32}\.png$")  # random name, not the uploaded one
        self.assertNotIn("my qr", link)
        self.assertEqual(self.upload.call_count, 1)
        self.assertRegex(self.upload.call_args.kwargs["public_id"], r"^payment_settings/[0-9a-f]{32}$")
        # customers get the same link
        self.assertEqual(self.as_user(self.customer).get(self.URL).json()["gcash_qr_image"], link)

    def test_replacing_and_clearing_delete_the_old_asset(self):
        first = self.patch(gcash_qr_image=image_file()).json()["gcash_qr_image"]
        first_id = re.search(r"(payment_settings/[0-9a-f]{32})", first).group(1)
        self.patch(gcash_qr_image=image_file())
        self.destroy.assert_called_once()
        self.assertEqual(self.destroy.call_args.args[0], first_id)

        self.destroy.reset_mock()
        cleared = self.patch(gcash_qr_image="")
        self.assertIsNone(cleared.json()["gcash_qr_image"])
        self.destroy.assert_called_once()

    def test_a_rejected_file_never_reaches_cloudinary(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        self.assertEqual(self.patch(gcash_qr_image=bad).status_code, 400)
        self.upload.assert_not_called()

    def test_payment_proofs_use_the_same_private_storage(self):
        order = self.place_order(payment_method="gcash")
        response = self.as_user(self.customer).post(
            f"/api/payments/{order['payment']['id']}/upload-proof/",
            {"proof_image": image_file("receipt.png"), "reference_number": "GC1"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertRegex(response.json()["proof_image"], r"^https://res\.cloudinary\.com/democloud/image/authenticated/s--")
        self.assertRegex(self.upload.call_args.kwargs["public_id"], r"^payment_proofs/[0-9a-f]{32}$")
        self.assertEqual(self.upload.call_args.kwargs["type"], "authenticated")
