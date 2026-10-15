from django.core import mail
from rest_framework.test import APIClient

from apps.core.testing import APITestBase
from apps.notifications.models import Notification
from apps.notifications.services import notify, notify_staff


class NotificationApiTests(APITestBase):
    def setUp(self):
        self.a = notify(self.customer, "First", "one", email=False)
        self.b = notify(self.customer, "Second", "two", email=False)
        self.other = notify(self.customer2, "Not yours", "x", email=False)

    def test_lists_only_own_notifications_newest_first(self):
        response = self.as_user(self.customer).get("/api/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([n["title"] for n in response.data["results"]], ["Second", "First"])

    def test_requires_authentication(self):
        self.assertEqual(APIClient().get("/api/notifications/").status_code, 401)

    def test_unread_count_and_filter(self):
        client = self.as_user(self.customer)
        self.assertEqual(client.get("/api/notifications/unread-count/").data, {"count": 2})
        client.post(f"/api/notifications/{self.a.pk}/mark-read/")
        self.assertEqual(client.get("/api/notifications/unread-count/").data, {"count": 1})
        unread = client.get("/api/notifications/?is_read=false")
        self.assertEqual([n["title"] for n in unread.data["results"]], ["Second"])

    def test_mark_read(self):
        response = self.as_user(self.customer).post(f"/api/notifications/{self.a.pk}/mark-read/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_read"])

    def test_cannot_touch_someone_elses_notification(self):
        client = self.as_user(self.customer)
        self.assertEqual(client.post(f"/api/notifications/{self.other.pk}/mark-read/").status_code, 404)
        self.assertEqual(client.get(f"/api/notifications/{self.other.pk}/").status_code, 404)
        self.other.refresh_from_db()
        self.assertFalse(self.other.is_read)

    def test_mark_all_read_only_affects_own(self):
        response = self.as_user(self.customer).post("/api/notifications/mark-all-read/")
        self.assertEqual(response.data, {"marked": 2})
        self.assertFalse(Notification.objects.get(pk=self.other.pk).is_read)
        self.assertEqual(self.as_user(self.customer).get("/api/notifications/unread-count/").data["count"], 0)

    def test_every_role_has_a_bell(self):
        for user in (self.admin, self.staff, self.rider_user):
            self.assertEqual(self.as_user(user).get("/api/notifications/").status_code, 200)


class NotificationServiceTests(APITestBase):
    def test_email_is_sent_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            notify(self.customer, "Hello", "Body text")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.customer.email])
        self.assertIn("Hello", mail.outbox[0].subject)

    def test_no_email_when_disabled_or_no_address(self):
        self.customer2.email = ""
        self.customer2.save()
        with self.captureOnCommitCallbacks(execute=True):
            notify(self.customer, "Quiet", "x", email=False)
            notify(self.customer2, "No address", "x")
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(Notification.objects.count(), 2)

    def test_notify_staff_reaches_active_staff_and_admins_only(self):
        notify_staff("Heads up", "x")
        recipients = set(Notification.objects.values_list("recipient__username", flat=True))
        self.assertEqual(recipients, {"admin1", "staff1"})
        self.assertEqual(len(mail.outbox), 0)
