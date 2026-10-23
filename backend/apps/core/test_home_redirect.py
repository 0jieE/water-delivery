from django.test import TestCase


class HomeRedirectTests(TestCase):
    def test_the_home_page_sends_visitors_to_the_admin(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/admin/")

    def test_signed_out_visitors_end_up_on_the_admin_login(self):
        response = self.client.get("/", follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.redirect_chain[-1][0], "/admin/login/?next=/admin/")
        self.assertContains(response, "Log in")

    def test_the_api_and_health_check_are_not_affected(self):
        self.assertEqual(self.client.get("/api/health/").status_code, 200)
        self.assertEqual(self.client.get("/api/catalog/services/").status_code, 200)
        self.assertEqual(self.client.get("/nope/").status_code, 404)
