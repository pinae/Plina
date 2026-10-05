"""Logging in with a local account (README: Accounts): the app asks for the
session, posts the login with the CSRF token from it, and works with the
session cookie; logged out, every API endpoint answers 401."""
from django.contrib.auth.models import User
from django.test import Client, TestCase, override_settings

from plina.scoping import owner_scope
from tasks.models import Task

# Fast hashing: these tests log in with real passwords many times.
FAST = override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])


@FAST
class LocalLoginTest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("pina", email="pina@example.com", password="correct horse battery",
                                             first_name="Pina")
        self.client = Client(enforce_csrf_checks=True)

    def session(self):
        return self.client.get("/api/auth/session/").json()

    def post(self, path, body, token=None):
        headers = {"HTTP_X_CSRFTOKEN": token} if token else {}
        return self.client.post(path, body, content_type="application/json", **headers)

    def login(self, password="correct horse battery"):
        return self.post("/api/auth/login/", {"username": "pina", "password": password}, self.session()["csrf_token"])

    def test_logged_out_the_session_says_so_and_offers_a_token(self):
        session = self.session()
        self.assertFalse(session["authenticated"])
        self.assertIsNone(session["user"])
        self.assertTrue(session["csrf_token"])
        self.assertIsNone(session["single_sign_on"])  # no OIDC_ variables: local accounts only
        self.assertEqual(self.client.get("/api/tasks/").status_code, 401)

    def test_logging_in_opens_the_users_data(self):
        with owner_scope(self.user):
            Task.objects.create(header="Mine")
        response = self.login()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["authenticated"])
        self.assertEqual(response.json()["user"], {
            "username": "pina", "name": "Pina", "email": "pina@example.com",
            "single_sign_on": False, "can_change_password": True, "is_staff": False,
        })
        self.assertEqual([t["header"] for t in self.client.get("/api/tasks/").json()], ["Mine"])

    def test_a_wrong_password_is_refused(self):
        response = self.login(password="wrong")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Wrong user name or password.")
        self.assertFalse(self.session()["authenticated"])

    def test_inactive_users_cannot_log_in(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 400)

    def test_the_login_needs_the_csrf_token(self):
        self.session()  # sets the cookie
        response = self.post("/api/auth/login/", {"username": "pina", "password": "correct horse battery"})
        self.assertEqual(response.status_code, 403)

    def test_changes_need_the_csrf_token_and_get_it_from_the_session(self):
        token = self.login().json()["csrf_token"]  # a new one after the login
        self.assertEqual(self.post("/api/tasks/", {"header": "No token"}).status_code, 403)
        self.assertEqual(self.post("/api/tasks/", {"header": "With token"}, token).status_code, 201)
        response = self.post("/api/tasks/", {"header": "Token from the session"}, self.session()["csrf_token"])
        self.assertEqual(response.status_code, 201)

    def test_logging_out(self):
        token = self.login().json()["csrf_token"]
        response = self.post("/api/auth/logout/", {}, token)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["redirect"])  # no single sign-on to leave
        self.assertEqual(self.client.get("/api/tasks/").status_code, 401)
        self.assertFalse(self.session()["authenticated"])

    def test_changing_the_password(self):
        token = self.login().json()["csrf_token"]
        response = self.post("/api/auth/password/", {"old_password": "wrong", "new_password": "x"}, token)
        self.assertEqual(response.status_code, 400)
        self.assertIn("old_password", response.json())
        response = self.post("/api/auth/password/", {"old_password": "correct horse battery",
                                                     "new_password": "123"}, token)
        self.assertEqual(response.status_code, 400)
        self.assertIn("too short", " ".join(response.json()["new_password"]))
        response = self.post("/api/auth/password/", {"old_password": "correct horse battery",
                                                     "new_password": "a much longer passphrase"}, token)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(self.session()["authenticated"])  # still logged in
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("a much longer passphrase"))

    def test_the_password_api_needs_a_login(self):
        token = self.session()["csrf_token"]
        response = self.post("/api/auth/password/", {"old_password": "a", "new_password": "b"}, token)
        self.assertEqual(response.status_code, 401)


@FAST
class ForgottenPasswordTest(TestCase):
    """With mail configured, the login page links Django's password reset."""

    def test_no_mail_no_reset(self):
        self.assertIsNone(Client().get("/api/auth/session/").json()["password_reset_url"])

    @override_settings(PASSWORD_RESET_ENABLED=True)
    def test_a_reset_link_by_mail(self):
        from django.core import mail
        User.objects.create_user("pina", email="pina@example.com", password="old password 1")
        client = Client()
        self.assertEqual(client.get("/api/auth/session/").json()["password_reset_url"],
                         "/django/accounts/password_reset/")
        response = client.post("/django/accounts/password_reset/", {"email": "pina@example.com"})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(len(mail.outbox), 1)
        link = next(line for line in mail.outbox[0].body.splitlines() if "/django/accounts/reset/" in line)
        response = client.get(link.strip().replace("http://testserver", ""), follow=True)
        response = client.post(response.redirect_chain[-1][0], {"new_password1": "a new passphrase 2",
                                                                 "new_password2": "a new passphrase 2"})
        self.assertEqual(response.status_code, 302)
        self.assertTrue(User.objects.get().check_password("a new passphrase 2"))
        # "Log in" on the last page leads to the app.
        self.assertContains(client.get("/django/accounts/reset/done/"), 'href="/"')
