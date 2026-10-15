"""Django file storage on Cloudinary, for hosts whose disk is wiped on every deploy (Render).

Configured by the standard CLOUDINARY_URL environment variable
(cloudinary://<api_key>:<api_secret>@<cloud_name>), which the Cloudinary SDK reads itself.

Files are uploaded with delivery type "authenticated": a link only works if it carries a valid
signature, which only this server can create. Payment proofs are therefore not public, even though
the signed https link returned by the API can be put straight into an <img src>.
"""
import os
import urllib.request
from io import BytesIO

import cloudinary
import cloudinary.api
import cloudinary.exceptions
import cloudinary.uploader
import cloudinary.utils
from django.core.files.base import ContentFile
from django.core.files.storage import Storage
from django.utils.deconstruct import deconstructible

DELIVERY_TYPE = "authenticated"


@deconstructible
class CloudinaryStorage(Storage):
    @staticmethod
    def _split(name):
        """'payment_proofs/abc.png' -> ('payment_proofs/abc', 'png'). Cloudinary keeps the format apart."""
        public_id, extension = os.path.splitext(str(name).replace("\\", "/"))
        return public_id, extension.lstrip(".").lower()

    def _save(self, name, content):
        public_id, _ = self._split(name)
        content.seek(0)
        cloudinary.uploader.upload(
            BytesIO(content.read()),
            public_id=public_id,
            type=DELIVERY_TYPE,
            resource_type="image",
            overwrite=False,
            unique_filename=False,
            use_filename=False,
        )
        return name

    def get_available_name(self, name, max_length=None):
        # File names are random (uuid) so they never collide; skip a network round trip per upload.
        return name

    def url(self, name):
        public_id, extension = self._split(name)
        url, _ = cloudinary.utils.cloudinary_url(
            public_id,
            type=DELIVERY_TYPE,
            resource_type="image",
            format=extension or None,
            sign_url=True,
            secure=True,
        )
        return url

    def delete(self, name):
        public_id, _ = self._split(name)
        cloudinary.uploader.destroy(public_id, type=DELIVERY_TYPE, resource_type="image", invalidate=True)

    def exists(self, name):
        public_id, _ = self._split(name)
        try:
            cloudinary.api.resource(public_id, type=DELIVERY_TYPE, resource_type="image")
        except cloudinary.exceptions.NotFound:
            return False
        return True

    def size(self, name):
        public_id, _ = self._split(name)
        return cloudinary.api.resource(public_id, type=DELIVERY_TYPE, resource_type="image")["bytes"]

    def _open(self, name, mode="rb"):
        with urllib.request.urlopen(self.url(name), timeout=30) as response:
            return ContentFile(response.read(), name=name)

    def listdir(self, path):
        raise NotImplementedError("CloudinaryStorage cannot list folders.")
