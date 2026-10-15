import datetime
import io
import tempfile
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from apps.catalog.models import WaterRefillService
from apps.core import backup
from apps.core.testing import _MEDIA_DIR, APITestBase, make_user
from apps.deliveries.models import RiderProfile
from apps.orders.models import Order, OrderDetail, OrderStatusLog
from apps.payments.models import Payment


class ErrorShapeTests(APITestBase):
    def test_every_error_has_detail_code_and_errors(self):
        client = self.as_user(self.customer)
        cases = {
            401: APIClient().get("/api/orders/"),
            403: client.get("/api/auth/users/"),
            404: client.get("/api/orders/99999/"),
            400: client.post("/api/orders/", {}, format="json"),
        }
        for status, response in cases.items():
            self.assertEqual(response.status_code, status)
            self.assertEqual(set(response.data), {"detail", "code", "errors"}, status)
            self.assertIsInstance(response.data["detail"], str)
        self.assertIn("items", cases[400].data["errors"])

    def test_absurd_numbers_never_cause_a_server_error(self):
        huge = "9" * 30
        staff = self.as_user(self.staff)
        for url in (
            f"/api/orders/?customer={huge}",
            f"/api/orders/?rider={huge}",
            f"/api/payments/?order={huge}",
            f"/api/notifications/?order={huge}",
            "/api/orders/?customer=-3",
            "/api/orders/?customer=1.5",
            "/api/orders/?customer=abc",
        ):
            response = staff.get(url)
            self.assertEqual(response.status_code, 400, url)
            self.assertEqual(response.data["code"], "validation_error", url)
        for url in (
            f"/api/orders/?search={huge}",
            f"/api/payments/?search={huge}",
            f"/api/orders/{huge}/",
            f"/api/payments/{huge}/",
            f"/api/notifications/{huge}/",
            f"/api/orders/?page={huge}",
        ):
            self.assertIn(staff.get(url).status_code, (200, 404), url)

    def test_pagination_shape(self):
        response = self.as_user(self.admin).get("/api/auth/users/?page_size=2")
        self.assertEqual(set(response.data), {"count", "next", "previous", "results"})
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])


class BackupApiTests(TransactionTestCase):
    """TransactionTestCase: a backup only sees committed data, exactly like production."""

    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.staff = make_user("staff1", "staff")
        self.customer = make_user("cust1", "customer")
        self.rider_user = make_user("rider1", "rider")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        override = override_settings(BACKUP_DIR=Path(self.tmp.name))
        override.enable()
        self.addCleanup(override.disable)

    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def test_admin_only(self):
        for user in (self.staff, self.customer, self.rider_user):
            client = self.as_user(user)
            self.assertEqual(client.get("/api/backups/").status_code, 403)
            self.assertEqual(client.post("/api/backups/").status_code, 403)
        self.assertEqual(APIClient().get("/api/backups/").status_code, 401)

    def test_create_list_and_download(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.get("/api/backups/").data, [])
        created = client.post("/api/backups/")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["engine"], "sqlite")
        self.assertGreater(created.data["size"], 0)

        listing = client.get("/api/backups/").data
        self.assertEqual([b["filename"] for b in listing], [created.data["filename"]])

        download = client.get(f"/api/backups/{created.data['filename']}/download/")
        self.assertEqual(download.status_code, 200)
        self.assertIn("attachment", download["Content-Disposition"])
        self.assertTrue(b"".join(download.streaming_content).startswith(backup.SQLITE_MAGIC))

    def test_download_rejects_bad_names(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.get("/api/backups/..%2F..%2Fdb.sqlite3/download/").status_code, 404)
        self.assertEqual(client.get("/api/backups/passwd/download/").status_code, 400)
        self.assertEqual(client.get("/api/backups/evil.py/download/").status_code, 400)
        self.assertEqual(client.get("/api/backups/backup_20200101_000000.sqlite3/download/").status_code, 404)

    def test_other_files_in_the_folder_are_not_listed(self):
        (Path(self.tmp.name) / "notes.txt").write_text("hi")
        self.assertEqual(self.as_user(self.admin).get("/api/backups/").data, [])

    def test_backup_fails_cleanly_when_pg_dump_is_missing(self):
        fake = {"ENGINE": "django.db.backends.postgresql", "NAME": "water", "USER": "u", "PASSWORD": "p"}
        with mock.patch.object(backup, "db_config", return_value=fake), mock.patch.object(
            backup.shutil, "which", return_value=None
        ):
            response = self.as_user(self.admin).post("/api/backups/")
        self.assertEqual(response.status_code, 503)
        self.assertIn("pg_dump", response.data["detail"])
        self.assertEqual(set(response.data), {"detail", "code", "errors"})


class PostgresCommandTests(APITestBase):
    """No PostgreSQL server here, so these check the commands we would run."""

    fake = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "water_refilling",
        "USER": "postgres",
        "PASSWORD": "secret",
        "HOST": "db.local",
        "PORT": "5433",
    }

    def test_pg_dump_command(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(BACKUP_DIR=Path(tmp)), mock.patch.object(
            backup, "db_config", return_value=self.fake
        ), mock.patch.object(backup.shutil, "which", return_value="/usr/bin/pg_dump"), mock.patch.object(
            backup.subprocess, "run"
        ) as run:
            path = backup.create_backup()
        command = run.call_args.args[0]
        self.assertEqual(command[0], "/usr/bin/pg_dump")
        self.assertEqual(path.suffix, ".dump")
        for expected in ("-h", "db.local", "-p", "5433", "-U", "postgres", "-Fc", "water_refilling"):
            self.assertIn(expected, command)
        self.assertEqual(run.call_args.kwargs["env"]["PGPASSWORD"], "secret")

    def test_pg_restore_command(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(BACKUP_DIR=Path(tmp)):
            dump = Path(tmp) / "backup_20260101_000000.dump"
            dump.write_bytes(b"PGDMP")
            with mock.patch.object(backup, "db_config", return_value=self.fake), mock.patch.object(
                backup.shutil, "which", return_value="/usr/bin/tool"
            ), mock.patch.object(backup.subprocess, "run") as run:
                backup.restore_backup(dump)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(len(commands), 2)  # safety pg_dump, then pg_restore
        restore = commands[1]
        for expected in ("--clean", "--if-exists", "--no-owner", "water_refilling", str(dump)):
            self.assertIn(expected, restore)


class BackupRestoreCommandTests(TransactionTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        override = override_settings(BACKUP_DIR=Path(self.tmp.name))
        override.enable()
        self.addCleanup(override.disable)

    def run_command(self, name, *args):
        out = io.StringIO()
        call_command(name, *args, stdout=out)
        return out.getvalue()

    def test_backup_then_restore_round_trip(self):
        WaterRefillService.objects.create(service_name="Before backup", price="10.00")
        make_user("keeper")
        output = self.run_command("backup_db")
        self.assertIn("Backup written", output)
        files = list(Path(self.tmp.name).glob("backup_*.sqlite3"))
        self.assertEqual(len(files), 1)

        WaterRefillService.objects.create(service_name="After backup", price="20.00")
        WaterRefillService.objects.filter(service_name="Before backup").delete()
        make_user("latecomer")

        output = self.run_command("restore_db", files[0].name, "--yes")
        self.assertIn("Database restored", output)
        self.assertEqual(
            list(WaterRefillService.objects.values_list("service_name", flat=True)), ["Before backup"]
        )
        usernames = set(get_user_model().objects.values_list("username", flat=True))
        self.assertEqual(usernames, {"keeper"})
        # the state before the restore was kept as a safety copy
        self.assertEqual(len(list(Path(self.tmp.name).glob("pre_restore_*.sqlite3"))), 1)

    def test_restore_rejects_non_database_files(self):
        fake = Path(self.tmp.name) / "backup_20260101_000000.sqlite3"
        fake.write_text("this is not a database")
        with self.assertRaisesMessage(CommandError, "not a SQLite database"):
            self.run_command("restore_db", str(fake), "--yes")

    def test_restore_missing_file(self):
        with self.assertRaisesMessage(CommandError, "not found"):
            self.run_command("restore_db", "nope.sqlite3", "--yes")


@override_settings(MEDIA_ROOT=_MEDIA_DIR)
class SeedDemoTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo", stdout=io.StringIO())

    def test_creates_the_requested_accounts_and_services(self):
        User = get_user_model()
        counts = {role: User.objects.filter(role=role).count() for role in ("admin", "staff", "rider", "customer")}
        self.assertEqual(counts, {"admin": 1, "staff": 2, "rider": 3, "customer": 5})
        self.assertEqual(RiderProfile.objects.count(), 3)
        self.assertEqual(
            set(WaterRefillService.objects.values_list("service_name", flat=True)),
            {"Round 5-gal Refill", "Slim 5-gal Refill", "New Container + Refill", "1-gal Refill"},
        )

    def test_about_thirty_orders_covering_every_status_in_the_last_30_days(self):
        self.assertEqual(Order.objects.count(), 30)
        self.assertEqual(
            set(Order.objects.values_list("order_status", flat=True)), {s.value for s in Order.Status}
        )
        today = timezone.localdate()
        oldest = Order.objects.order_by("delivery_date").first().delivery_date
        self.assertGreaterEqual((today - oldest).days, 25)
        self.assertLessEqual((today - oldest).days, 30)
        self.assertFalse(Order.objects.filter(order_status="delivered", delivery_date__gt=today).exists())

    def test_totals_status_logs_and_payments_are_consistent(self):
        for order in Order.objects.prefetch_related("items"):
            items_total = OrderDetail.objects.filter(order=order).aggregate(t=Sum("subtotal"))["t"]
            self.assertEqual(order.total_amount, items_total, order.pk)
            self.assertEqual(order.payment.amount, order.total_amount, order.pk)
            logs = list(OrderStatusLog.objects.filter(order=order))
            self.assertEqual(logs[0].to_status, "pending")
            self.assertEqual(logs[-1].to_status, order.order_status, order.pk)
            for earlier, later in zip(logs, logs[1:]):
                self.assertEqual(later.from_status, earlier.to_status, order.pk)
        for payment in Payment.objects.exclude(payment_method="cod").filter(
            payment_status__in=["pending_verification", "paid", "rejected"]
        ):
            self.assertTrue(payment.proof_image, payment.order_id)

    def test_timelines_make_sense_whatever_time_of_day_it_is_seeded(self):
        today = timezone.localdate()
        for hour in (0, 6, 9, 12, 15, 23):
            fake_now = timezone.make_aware(datetime.datetime.combine(today, datetime.time(hour, 30)))
            with mock.patch("django.utils.timezone.now", return_value=fake_now):
                call_command("seed_demo", "--reset", stdout=io.StringIO())
            for order in Order.objects.all():
                logs = list(OrderStatusLog.objects.filter(order=order))
                self.assertEqual(logs[0].to_status, "pending", (hour, order.pk))
                stamps = [log.created_at for log in logs]
                self.assertEqual(stamps, sorted(stamps), (hour, order.pk))
                self.assertLessEqual(stamps[-1], fake_now, (hour, order.pk))
                self.assertLessEqual(order.order_date, stamps[0], (hour, order.pk))
            from apps.deliveries.models import CashRemittance

            for remittance in CashRemittance.objects.all():
                self.assertLessEqual(remittance.received_at, fake_now, hour)

    def test_demo_gcash_settings_are_filled_but_never_overwrite_the_admins_own(self):
        from apps.payments.models import PaymentSettings

        row = PaymentSettings.load()
        self.assertEqual(row.gcash_account_name, "Deep Water Refilling")
        self.assertTrue(row.gcash_number)
        self.assertTrue(row.gcash_qr_image)
        self.assertFalse(Payment.objects.filter(payment_method="bank_transfer").exists())

        row.gcash_account_name = "My Real Station"
        row.save()
        call_command("seed_demo", "--reset", stdout=io.StringIO())
        self.assertEqual(PaymentSettings.load().gcash_account_name, "My Real Station")

    def test_cash_held_by_two_riders_and_some_already_handed_in(self):
        from decimal import Decimal

        from apps.deliveries import cash
        from apps.deliveries.models import CashRemittance

        groups = {g["name"]: g for g in cash.held_by_rider()}
        self.assertEqual(len(groups), 2)  # exactly two riders still hold cash...
        for group in groups.values():
            self.assertGreaterEqual(len(group["payments"]), 2)  # ...each from several paid COD orders
            self.assertTrue(all(p.remittance_id is None for p in group["payments"]))
        self.assertGreater(CashRemittance.objects.count(), 0)  # and older cash was handed in

        # every paid COD payment is either held or part of a remittance, and the sums agree
        cod = Payment.objects.filter(payment_method="cod", payment_status="paid")
        remitted = sum((r.amount for r in CashRemittance.objects.all()), Decimal("0.00"))
        held = sum((g_p.amount for g in groups.values() for g_p in g["payments"]), Decimal("0.00"))
        self.assertEqual(remitted + held, sum((p.amount for p in cod), Decimal("0.00")))
        for remittance in CashRemittance.objects.all():
            linked = sum((p.amount for p in remittance.payments.all()), Decimal("0.00"))
            self.assertEqual(remittance.amount, linked)

    def test_orders_carry_pins_near_kidapawan_and_some_have_none(self):
        pinned = Order.objects.filter(delivery_latitude__isnull=False)
        self.assertGreaterEqual(pinned.count(), 20)
        self.assertGreater(Order.objects.filter(delivery_latitude__isnull=True).count(), 0)
        for order in Order.objects.all():
            self.assertEqual(order.delivery_latitude is None, order.delivery_longitude is None, order.pk)
        for order in pinned:
            self.assertTrue(6.9 < order.delivery_latitude < 7.1, order.pk)
            self.assertTrue(125.0 < order.delivery_longitude < 125.2, order.pk)
        for customer in get_user_model().objects.filter(role="customer"):
            self.assertIsNotNone(customer.latitude, customer.username)

    def test_seeding_over_older_data_backfills_pins_without_touching_other_orders(self):
        User = get_user_model()
        Order.objects.update(delivery_latitude=None, delivery_longitude=None)
        User.objects.filter(role="customer").update(latitude=None, longitude=None)
        stranger = make_user("stranger")
        real = Order.objects.create(
            customer=stranger, delivery_date=timezone.localdate(), delivery_address="x"
        )
        call_command("seed_demo", stdout=io.StringIO())
        self.assertGreaterEqual(Order.objects.filter(delivery_latitude__isnull=False).count(), 20)
        real.refresh_from_db()
        self.assertIsNone(real.delivery_latitude)

    def test_riders_state_matches_their_deliveries(self):
        on_road = set(
            Order.objects.filter(order_status="out_for_delivery").values_list("rider_id", flat=True)
        )
        self.assertEqual(len(on_road), 2)
        for rider in RiderProfile.objects.all():
            expected = "on_delivery" if rider.pk in on_road else "available"
            self.assertEqual(rider.status, expected, rider.user.username)
        self.assertFalse(
            Order.objects.filter(order_status__in=["out_for_delivery", "delivered", "failed"], rider=None).exists()
        )

    def test_demo_logins_work_through_the_api(self):
        for username, role in (("admin", "admin"), ("staff1", "staff"), ("rider1", "rider"), ("customer1", "customer")):
            response = APIClient().post(
                "/api/auth/token/", {"username": username, "password": "Demo@12345"}, format="json"
            )
            self.assertEqual(response.status_code, 200, username)
            self.assertEqual(response.data["user"]["role"], role)

    def test_demo_data_feeds_the_reports_and_dashboard(self):
        admin = APIClient()
        admin.force_authenticate(get_user_model().objects.get(username="admin"))
        sales = admin.get("/api/reports/sales/daily/").data
        self.assertGreater(sum(r["orders"] for r in sales["rows"]), 0)
        self.assertGreater(float(sales["totals"]["total_sales"]), 0)
        self.assertGreater(len(admin.get("/api/reports/top-services/").data["rows"]), 0)
        dashboard = admin.get("/api/orders/dashboard/").data
        self.assertGreater(dashboard["pending_payments"], 0)
        self.assertGreater(dashboard["today_total"], 0)
        rider = APIClient()
        rider.force_authenticate(get_user_model().objects.get(username="rider1"))
        self.assertGreater(rider.get("/api/deliveries/my/").data["count"], 0)

    def test_rerun_is_idempotent_and_reset_rebuilds(self):
        User = get_user_model()
        User.objects.filter(username="customer1").update(first_name="Edited")
        call_command("seed_demo", stdout=io.StringIO())
        self.assertEqual(Order.objects.count(), 30)
        self.assertEqual(User.objects.filter(role="customer").count(), 5)
        self.assertEqual(User.objects.get(username="customer1").first_name, "Edited")

        # without --reset an existing account keeps its password; with it the demo password returns
        customer = User.objects.get(username="customer1")
        customer.set_password("Changed!Pass1")
        customer.is_active = False
        customer.save()
        Order.objects.filter(order_status="pending").delete()
        call_command("seed_demo", stdout=io.StringIO())
        self.assertEqual(Order.objects.count(), 26)  # orders already exist, so none are added
        self.assertTrue(User.objects.get(username="customer1").check_password("Changed!Pass1"))

        call_command("seed_demo", "--reset", stdout=io.StringIO())
        self.assertEqual(Order.objects.count(), 30)
        customer.refresh_from_db()
        self.assertTrue(customer.check_password("Demo@12345"))
        self.assertTrue(customer.is_active)
