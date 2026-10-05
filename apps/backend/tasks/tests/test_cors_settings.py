"""The origins allowed to call the API come from CORS_ALLOWED_ORIGINS.

Unset, the Vite dev server (port 5173) may call it, as before; set, the
comma-separated list replaces that default (README: Backend URL and ports).
"""
import json
import os
import subprocess
import sys
from unittest import mock

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from tasks.tests.support import TestCase

from plina.env import origins_from_env

DEFAULT = ["http://localhost:5173", "http://127.0.0.1:5173"]


class OriginsFromEnvTest(SimpleTestCase):
    def origins(self, value):
        environ = {} if value is None else {"CORS_ALLOWED_ORIGINS": value}
        with mock.patch.dict(os.environ, environ, clear=True):
            return origins_from_env("CORS_ALLOWED_ORIGINS", default=DEFAULT)

    def test_unset_means_the_default(self):
        self.assertEqual(self.origins(None), DEFAULT)

    def test_a_list_replaces_the_default(self):
        self.assertEqual(
            self.origins(" http://localhost:5174 ,https://plina.example.com"),
            ["http://localhost:5174", "https://plina.example.com"],
        )

    def test_trailing_slashes_are_dropped(self):
        # Copied from the address bar; corsheaders would reject the path "/".
        self.assertEqual(self.origins("http://localhost:5174/"), ["http://localhost:5174"])

    def test_empty_means_no_origin(self):
        self.assertEqual(self.origins(""), [])
        self.assertEqual(self.origins(" , /"), [])

    def test_the_default_is_not_shared(self):
        self.origins(None).append("http://evil.example")
        self.assertEqual(self.origins(None), DEFAULT)


@override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:5174"])
class CorsHeadersTest(TestCase):
    def allowed_origin(self, origin):
        response = self.client.get("/api/tags/", HTTP_ORIGIN=origin)
        return response.headers.get("Access-Control-Allow-Origin")

    def test_a_listed_origin_may_call_the_api(self):
        self.assertEqual(self.allowed_origin("http://localhost:5174"), "http://localhost:5174")

    def test_other_origins_may_not(self):
        self.assertIsNone(self.allowed_origin("http://localhost:5173"))


class SettingsReadTheEnvironmentTest(SimpleTestCase):
    """A fresh interpreter each: settings are read once, at startup, and the
    test run itself may have CORS_ALLOWED_ORIGINS set."""

    def settings_origins(self, value):
        script = ("import json, django; django.setup(); from django.conf import settings; "
                  "print(json.dumps(settings.CORS_ALLOWED_ORIGINS))")
        env = {**os.environ, "DJANGO_SETTINGS_MODULE": "plina.settings"}
        env.pop("CORS_ALLOWED_ORIGINS", None)
        if value is not None:
            env["CORS_ALLOWED_ORIGINS"] = value
        result = subprocess.run([sys.executable, "-c", script], cwd=settings.BASE_DIR,
                                env=env, capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_unset_allows_the_vite_dev_server(self):
        self.assertEqual(self.settings_origins(None), DEFAULT)

    def test_set_replaces_the_default(self):
        self.assertEqual(self.settings_origins("http://localhost:5174,http://127.0.0.1:5174"),
                         ["http://localhost:5174", "http://127.0.0.1:5174"])
