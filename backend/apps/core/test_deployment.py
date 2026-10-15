from unittest import mock

from django.db import OperationalError
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core.testing import APITestBase, image_file
from config import env


class EnvironmentSettingsTests(SimpleTestCase):
    def test_csv(self):
        self.assertEqual(env.csv(" a, b,,c "), ["a", "b", "c"])
        self.assertEqual(env.csv(None), [])

    def test_render_host_is_allowed_automatically(self):
        hosts = env.allowed_hosts({"DJANGO_ALLOWED_HOSTS": "localhost", "RENDER_EXTERNAL_HOSTNAME": "deep-water.onrender.com"})
        self.assertEqual(hosts, ["localhost", "deep-water.onrender.com"])
        again = env.allowed_hosts({"DJANGO_ALLOWED_HOSTS": "deep-water.onrender.com", "RENDER_EXTERNAL_HOSTNAME": "deep-water.onrender.com"})
        self.assertEqual(again, ["deep-water.onrender.com"])
        self.assertEqual(env.allowed_hosts({}), ["localhost"])

    def test_csrf_trusted_origins(self):
        origins = env.csrf_trusted_origins(
            {"CSRF_TRUSTED_ORIGINS": "https://app.example.com", "RENDER_EXTERNAL_HOSTNAME": "deep-water.onrender.com"}
        )
        self.assertEqual(origins, ["https://app.example.com", "https://deep-water.onrender.com"])
        self.assertEqual(env.csrf_trusted_origins({}), [])

    def test_database_defaults_to_sqlite(self):
        config = env.database_from_env({}, "/app")
        self.assertTrue(config["ENGINE"].endswith("sqlite3"))
        self.assertEqual(str(config["NAME"]).replace("\\", "/"), "/app/db.sqlite3")

    def test_database_from_individual_values(self):
        config = env.database_from_env(
            {"DB_ENGINE": "postgres", "DB_NAME": "n", "DB_USER": "u", "DB_PASSWORD": "p", "DB_HOST": "h", "DB_PORT": "5433"}, "/app"
        )
        self.assertEqual(
            (config["ENGINE"], config["NAME"], config["USER"], config["PASSWORD"], config["HOST"], config["PORT"]),
            ("django.db.backends.postgresql", "n", "u", "p", "h", "5433"),
        )
        self.assertEqual(config["CONN_MAX_AGE"], 60)
        self.assertTrue(config["CONN_HEALTH_CHECKS"])
        self.assertNotIn("OPTIONS", config)
        self.assertEqual(env.database_from_env({"DB_ENGINE": "postgres", "DB_SSLMODE": "require"}, "/app")["OPTIONS"], {"sslmode": "require"})

    def test_database_from_url(self):
        config = env.database_from_env(
            {"DATABASE_URL": "postgresql://my_user:p%40ss%2Fw0rd@dpg-abc.oregon-postgres.render.com:5432/my_db?sslmode=require"}, "/app"
        )
        self.assertEqual(config["USER"], "my_user")
        self.assertEqual(config["PASSWORD"], "p@ss/w0rd")  # special characters are decoded
        self.assertEqual((config["HOST"], config["PORT"], config["NAME"]), ("dpg-abc.oregon-postgres.render.com", "5432", "my_db"))
        self.assertEqual(config["OPTIONS"], {"sslmode": "require"})
        # the Render "Internal Database URL" has no port: default 5432
        internal = env.database_from_env({"DATABASE_URL": "postgres://u:p@dpg-abc-a/db"}, "/app")
        self.assertEqual((internal["HOST"], internal["PORT"]), ("dpg-abc-a", "5432"))

    def test_database_url_wins_over_individual_values_and_bad_urls_fail_loudly(self):
        config = env.database_from_env({"DATABASE_URL": "postgres://u:p@h/db", "DB_ENGINE": "sqlite", "DB_NAME": "other"}, "/app")
        self.assertEqual(config["NAME"], "db")
        with self.assertRaises(ValueError):
            env.database_from_env({"DATABASE_URL": "mysql://u:p@h/db"}, "/app")

    def test_storage_is_local_unless_a_bucket_is_configured(self):
        storages = env.storages_from_env({})
        self.assertEqual(storages["default"]["BACKEND"], "django.core.files.storage.FileSystemStorage")
        self.assertIn("whitenoise", storages["staticfiles"]["BACKEND"])

    def test_s3_compatible_storage(self):
        storages = env.storages_from_env(
            {
                "AWS_STORAGE_BUCKET_NAME": "proofs",
                "AWS_ACCESS_KEY_ID": "key",
                "AWS_SECRET_ACCESS_KEY": "secret",
                "AWS_S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
                "AWS_S3_REGION_NAME": "auto",
            }
        )
        default = storages["default"]
        self.assertEqual(default["BACKEND"], "storages.backends.s3.S3Storage")
        options = default["OPTIONS"]
        self.assertEqual(options["bucket_name"], "proofs")
        self.assertEqual(options["endpoint_url"], "https://account.r2.cloudflarestorage.com")
        self.assertTrue(options["querystring_auth"])  # private bucket, time-limited https links
        self.assertEqual(options["querystring_expire"], 86400)
        self.assertFalse(options["file_overwrite"])
        self.assertNotIn(None, options.values())
        plain = env.storages_from_env({"AWS_STORAGE_BUCKET_NAME": "b"})["default"]["OPTIONS"]
        self.assertNotIn("endpoint_url", plain)


class HealthEndpointTests(APITestBase):
    URL = "/api/health/"

    def test_public_and_healthy(self):
        response = APIClient().get(self.URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "sqlite"})

    def test_reports_an_unreachable_database_without_leaking_details(self):
        with mock.patch("apps.core.views.connection.ensure_connection", side_effect=OperationalError("password authentication failed for user secret_user at secret.host")):
            response = APIClient().get(self.URL)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "error")
        self.assertEqual(response.json()["error"], "OperationalError")
        self.assertNotIn("secret", response.content.decode())

    def test_reports_pending_migrations(self):
        with mock.patch("apps.core.views.MigrationExecutor") as executor:
            executor.return_value.migration_plan.return_value = [("app.0001", False), ("app.0002", False)]
            response = APIClient().get(self.URL)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "migrations_pending")
        self.assertEqual(response.json()["pending_migrations"], 2)


class ProductionBehaviourTests(APITestBase):
    def test_links_are_https_behind_the_render_proxy(self):
        admin = self.as_user(self.admin)
        admin.patch("/api/payments/settings/", {"gcash_qr_image": image_file()}, format="multipart")
        plain = self.as_user(self.customer).get("/api/payments/settings/").json()["gcash_qr_image"]
        secure = self.as_user(self.customer).get("/api/payments/settings/", HTTP_X_FORWARDED_PROTO="https").json()["gcash_qr_image"]
        self.assertTrue(plain.startswith("http://"))
        self.assertTrue(secure.startswith("https://"), secure)

        for _ in range(2):
            self.place_order()
        page = self.as_user(self.customer).get("/api/orders/?page_size=1", HTTP_X_FORWARDED_PROTO="https").json()
        self.assertTrue(page["next"].startswith("https://"), page["next"])

    def test_download_file_names_are_readable_by_the_browser_across_origins(self):
        response = self.as_user(self.admin).get("/api/catalog/services/", HTTP_ORIGIN="http://localhost:5173")
        self.assertEqual(response["Access-Control-Allow-Origin"], "http://localhost:5173")
        self.assertIn("Content-Disposition", response["Access-Control-Expose-Headers"])

    def test_uploaded_files_are_served_by_django_when_there_is_no_bucket(self):
        self.as_user(self.admin).patch("/api/payments/settings/", {"gcash_qr_image": image_file()}, format="multipart")
        url = self.as_user(self.customer).get("/api/payments/settings/").json()["gcash_qr_image"]
        path = url.replace("http://testserver", "")
        response = APIClient().get(path)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(b"".join(response.streaming_content).startswith(b"\x89PNG"))
        self.assertEqual(APIClient().get("/media/payment_settings/nope.png").status_code, 404)
        self.assertIn(APIClient().get("/media/../manage.py").status_code, (400, 404))  # no path traversal

    def test_request_errors_are_logged_with_a_traceback(self):
        client = APIClient(raise_request_exception=False)
        with mock.patch("apps.catalog.views.WaterRefillServiceViewSet.get_queryset", side_effect=RuntimeError("boom")):
            with self.assertLogs("django.request", level="ERROR") as logs:
                response = client.get("/api/catalog/services/")
        self.assertEqual(response.status_code, 500)
        self.assertTrue(any("boom" in line for line in logs.output) or logs.records[0].exc_info)
