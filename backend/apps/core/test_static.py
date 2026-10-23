from django.conf import settings
from django.test import TestCase, override_settings


@override_settings(WHITENOISE_USE_FINDERS=True)  # as in production
class StaticFilesTests(TestCase):
    """The Django admin and the browsable API need their CSS even when DEBUG is off (Render)."""

    def test_admin_and_api_styles_are_served_without_debug(self):
        self.assertFalse(settings.DEBUG)  # the test runner always runs with DEBUG off
        for path in (
            "/static/admin/css/base.css",
            "/static/admin/css/login.css",
            "/static/admin/js/theme.js",
            "/static/rest_framework/css/bootstrap.min.css",
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertGreater(len(b"".join(response.streaming_content)), 100, path)
        css = self.client.get("/static/admin/css/base.css")
        self.assertIn("text/css", css["Content-Type"])

    def test_every_stylesheet_and_script_on_the_admin_login_page_is_served(self):
        import re

        page = self.client.get("/admin/login/")
        self.assertEqual(page.status_code, 200)
        html = page.content.decode()
        assets = set(re.findall(r'(?:href|src)="(/static/[^"?#]+\.(?:css|js))', html))
        self.assertGreaterEqual(len(assets), 2, assets)  # the theme's stylesheet and its scripts
        for path in sorted(assets):
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_the_theme_and_favicon_are_served(self):
        self.assertEqual(self.client.get("/static/favicon.svg").status_code, 200)
        page = self.client.get("/admin/login/")
        self.assertContains(page, "Deep Water")

    def test_unknown_static_file_is_a_404(self):
        self.assertEqual(self.client.get("/static/admin/css/does-not-exist.css").status_code, 404)
