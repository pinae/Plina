"""Production settings come from the environment (README: Deployment with
Docker; the names of the Ansible templates); unset, the settings are the
development ones (DEBUG, SQLite)."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import OperationalError
from django.test import SimpleTestCase
from tasks.tests.support import TestCase

from plina.env import bool_from_env, database_from_env, list_from_env, secret_from_env

SETTINGS_VARS = ["DEBUG", "SECRET_KEY", "SECRET_KEY_FILE", "ALLOWED_HOSTS", "CSRF_TRUSTED_ORIGINS",
                 "SECURE_COOKIES", "DB_ENGINE", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_PASSWORD_FILE",
                 "DB_HOST", "DB_PORT", "EMAIL_HOST", "EMAIL_PORT", "EMAIL_USE_TLS", "EMAIL_USER",
                 "EMAIL_PASSWORD", "EMAIL_FROM"]
PRODUCTION = {"DEBUG": "False", "SECRET_KEY": "a-long-random-secret", "ALLOWED_HOSTS": "plina.example.com"}
POSTGRES = {"DB_ENGINE": "django.db.backends.postgresql", "DB_NAME": "plina", "DB_USER": "plina_user",
            "DB_PASSWORD": "pw", "DB_HOST": "db", "DB_PORT": "5432"}


class EnvHelpersTest(SimpleTestCase):
    def env(self, **values):
        return mock.patch.dict(os.environ, values, clear=True)

    def test_booleans(self):
        for value, expected in [("1", True), ("true", True), (" Yes ", True), ("on", True),
                                ("0", False), ("false", False), ("no", False), ("OFF", False)]:
            with self.env(FLAG=value):
                self.assertIs(bool_from_env("FLAG", default=not expected), expected, value)
        with self.env():
            self.assertIs(bool_from_env("FLAG", default=True), True)
        with self.env(FLAG=""):
            self.assertIs(bool_from_env("FLAG", default=False), False)

    def test_a_typo_in_a_boolean_is_an_error_not_a_guess(self):
        with self.env(FLAG="ture"), self.assertRaisesMessage(ImproperlyConfigured, "FLAG"):
            bool_from_env("FLAG", default=False)

    def test_lists(self):
        with self.env(HOSTS=" plina.example.com, ,localhost "):
            self.assertEqual(list_from_env("HOSTS", default=[]), ["plina.example.com", "localhost"])
        with self.env():
            self.assertEqual(list_from_env("HOSTS", default=["x"]), ["x"])

    def test_secrets_from_a_file(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as file:
            file.write("from-the-file\n")
        try:
            with self.env(KEY_FILE=file.name):
                self.assertEqual(secret_from_env("KEY"), "from-the-file")
            with self.env(KEY="direct"):
                self.assertEqual(secret_from_env("KEY"), "direct")
            with self.env():
                self.assertIsNone(secret_from_env("KEY"))
        finally:
            os.unlink(file.name)

    def test_sqlite_unless_another_engine_is_configured(self):
        with self.env():
            self.assertEqual(database_from_env(Path("/app")),
                             {"ENGINE": "django.db.backends.sqlite3", "NAME": Path("/app/db.sqlite3")})
        with self.env(DB_ENGINE="django.db.backends.sqlite3", DB_NAME="/data/plina.sqlite3"):
            self.assertEqual(database_from_env(Path("/app"))["NAME"], Path("/data/plina.sqlite3"))
        with self.env(**POSTGRES):
            database = database_from_env(Path("/app"))
        self.assertEqual(database["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual((database["NAME"], database["USER"], database["PASSWORD"], database["HOST"], database["PORT"]),
                         ("plina", "plina_user", "pw", "db", "5432"))
        # Short names as in the Ansible host variables.
        with self.env(**{**POSTGRES, "DB_ENGINE": "postgresql"}):
            self.assertEqual(database_from_env(Path("/app"))["ENGINE"], "django.db.backends.postgresql")
        with self.env(DB_ENGINE="sqlite3"):
            self.assertEqual(database_from_env(Path("/app"))["ENGINE"], "django.db.backends.sqlite3")


class SettingsFromTheEnvironmentTest(SimpleTestCase):
    """A fresh interpreter each: settings are read once, at startup."""

    def load(self, **values):
        script = ("import json, django; django.setup(); from django.conf import settings as s; "
                  "print(json.dumps({'DEBUG': s.DEBUG, 'SECRET_KEY': s.SECRET_KEY, 'ALLOWED_HOSTS': s.ALLOWED_HOSTS, "
                  "'CSRF_TRUSTED_ORIGINS': s.CSRF_TRUSTED_ORIGINS, 'SESSION_COOKIE_SECURE': s.SESSION_COOKIE_SECURE, "
                  "'CSRF_COOKIE_SECURE': s.CSRF_COOKIE_SECURE, 'ENGINE': s.DATABASES['default']['ENGINE'], "
                  "'SECURE_PROXY_SSL_HEADER': s.SECURE_PROXY_SSL_HEADER, 'STATIC_ROOT': str(s.STATIC_ROOT), "
                  "'MEDIA_ROOT': str(s.MEDIA_ROOT), 'EMAIL': [s.EMAIL_HOST, s.EMAIL_PORT, s.EMAIL_USE_TLS, "
                  "s.EMAIL_HOST_USER, s.EMAIL_HOST_PASSWORD, s.DEFAULT_FROM_EMAIL, s.SERVER_EMAIL]}))")
        env = {key: value for key, value in os.environ.items() if key not in SETTINGS_VARS}
        env.update(DJANGO_SETTINGS_MODULE="plina.settings", **values)
        return subprocess.run([sys.executable, "-c", script], cwd=settings.BASE_DIR,
                              env=env, capture_output=True, text=True)

    def loaded(self, **values):
        result = self.load(**values)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_unset_means_development(self):
        loaded = self.loaded()
        self.assertTrue(loaded["DEBUG"])
        self.assertTrue(loaded["SECRET_KEY"].startswith("django-insecure-"))
        self.assertEqual(loaded["ENGINE"], "django.db.backends.sqlite3")
        self.assertFalse(loaded["SESSION_COOKIE_SECURE"])

    def test_production(self):
        loaded = self.loaded(**PRODUCTION, CSRF_TRUSTED_ORIGINS="https://plina.example.com/", **POSTGRES)
        self.assertFalse(loaded["DEBUG"])
        self.assertEqual(loaded["SECRET_KEY"], "a-long-random-secret")
        self.assertEqual(loaded["ALLOWED_HOSTS"], ["plina.example.com"])
        self.assertEqual(loaded["CSRF_TRUSTED_ORIGINS"], ["https://plina.example.com"])
        self.assertTrue(loaded["SESSION_COOKIE_SECURE"] and loaded["CSRF_COOKIE_SECURE"])
        self.assertEqual(loaded["ENGINE"], "django.db.backends.postgresql")
        # Behind the reverse proxy, which terminates TLS.
        self.assertEqual(loaded["SECURE_PROXY_SSL_HEADER"], ["HTTP_X_FORWARDED_PROTO", "https"])
        # The volumes nginx serves them from.
        self.assertEqual((loaded["STATIC_ROOT"], loaded["MEDIA_ROOT"]),
                         (str(settings.BASE_DIR / "static"), str(settings.BASE_DIR / "media")))

    def test_email(self):
        loaded = self.loaded(**PRODUCTION, EMAIL_HOST="smtp.example.com", EMAIL_PORT="587", EMAIL_USE_TLS="True",
                             EMAIL_USER="plina@example.com", EMAIL_PASSWORD="mail-pw", EMAIL_FROM="plina@example.com")
        self.assertEqual(loaded["EMAIL"], ["smtp.example.com", 587, True, "plina@example.com", "mail-pw",
                                           "plina@example.com", "plina@example.com"])
        # Port 587 means STARTTLS unless EMAIL_USE_TLS says otherwise.
        loaded = self.loaded(**PRODUCTION, EMAIL_HOST="smtp.example.com", EMAIL_PORT="587")
        self.assertTrue(loaded["EMAIL"][2])
        self.assertFalse(self.loaded(**PRODUCTION, EMAIL_HOST="smtp.example.com", EMAIL_PORT="25")["EMAIL"][2])

    def test_secure_cookies_can_be_turned_off_to_test_without_tls(self):
        self.assertFalse(self.loaded(**PRODUCTION, SECURE_COOKIES="0")["SESSION_COOKIE_SECURE"])

    def test_production_refuses_to_start_without_a_secret_key_or_hosts(self):
        result = self.load(DEBUG="False", ALLOWED_HOSTS="plina.example.com")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SECRET_KEY", result.stderr)
        result = self.load(DEBUG="False", SECRET_KEY="a-long-random-secret")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ALLOWED_HOSTS", result.stderr)


class HealthCheckTest(TestCase):
    def test_ok_when_the_database_answers_whatever_the_host(self):
        # Docker probes 127.0.0.1, which need not be an allowed host.
        with self.settings(ALLOWED_HOSTS=["plina.example.com"], DEBUG=False):
            response = self.client.get("/healthz", HTTP_HOST="127.0.0.1:8000")
        self.assertEqual((response.status_code, response.content), (200, b"ok"))

    def test_503_without_the_database(self):
        with mock.patch("plina.health.connection.ensure_connection", side_effect=OperationalError("down")), \
                self.assertLogs("django.request", "ERROR"):
            response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 503)
