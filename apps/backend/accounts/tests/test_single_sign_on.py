"""Single sign-on with OpenID Connect (README: Accounts), against a test
provider: tokens signed with a key of our own, its endpoints mocked."""
import os
import time
from unittest import mock
from urllib.parse import parse_qs, urlparse

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth.models import User
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings

from accounts.models import OidcIdentity
from plina.env import oidc_from_env

ISSUER = "https://sso.example.com/application/o/plina/"
ENV = {"OIDC_CLIENT_ID": "plina-client", "OIDC_CLIENT_SECRET": "client-secret",
       "OIDC_AUTHORIZATION_ENDPOINT": "https://sso.example.com/application/o/authorize/",
       "OIDC_TOKEN_ENDPOINT": "https://sso.example.com/application/o/token/",
       "OIDC_USER_ENDPOINT": "https://sso.example.com/application/o/userinfo/",
       "OIDC_JWKS_ENDPOINT": "https://sso.example.com/application/o/plina/jwks/"}
# The settings these variables make (plina/settings.py), plus a provider name.
with mock.patch.dict(os.environ, {**ENV, "OIDC_PROVIDER_NAME": "Example SSO",
                                  "OIDC_LOGOUT_ENDPOINT": "https://sso.example.com/application/o/plina/end-session/"},
                     clear=True):
    SSO = {**oidc_from_env(), "OIDC_ENABLED": True,
           "AUTHENTICATION_BACKENDS": ["django.contrib.auth.backends.ModelBackend", "accounts.oidc.PlinaOIDCBackend"]}
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
JWK = {**jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key(), as_dict=True), "kid": "k1", "alg": "RS256"}


class Provider:
    """The provider's side of one login: what its endpoints answer."""

    def __init__(self, claims, audience=None):
        self.claims = claims
        self.audience = audience or SSO["OIDC_RP_CLIENT_ID"]
        self.nonce = None

    def response(self, payload, content_type="application/json"):
        response = mock.Mock(status_code=200, headers={"content-type": content_type})
        response.json.return_value = payload
        return response

    def post(self, url, data=None, **kwargs):  # the token endpoint
        assert url == SSO["OIDC_OP_TOKEN_ENDPOINT"] and data["code"] == "the-code" and data["code_verifier"]
        id_token = jwt.encode({"iss": ISSUER, "aud": self.audience, "sub": self.claims["sub"],
                               "iat": int(time.time()), "exp": int(time.time()) + 300, "nonce": self.nonce},
                              KEY, algorithm="RS256", headers={"kid": "k1"})
        return self.response({"id_token": id_token, "access_token": "access", "token_type": "Bearer"})

    def get(self, url, **kwargs):
        if url == SSO["OIDC_OP_JWKS_ENDPOINT"]:
            return self.response({"keys": [JWK]})
        assert url == SSO["OIDC_OP_USER_ENDPOINT"]
        return self.response(self.claims)


@override_settings(**SSO)
class SingleSignOnTest(TestCase):
    def setUp(self):
        self.client = Client()

    def log_in(self, claims, next_url="/week", audience=None):
        response = self.client.get("/django/oidc/authenticate/", {"next": next_url})
        self.assertEqual(response.status_code, 302)
        to_provider = urlparse(response["Location"])
        params = {key: values[0] for key, values in parse_qs(to_provider.query).items()}
        provider = Provider(claims, audience)
        provider.nonce = params["nonce"]
        with mock.patch("mozilla_django_oidc.auth.requests.post", provider.post), \
                mock.patch("mozilla_django_oidc.auth.requests.get", provider.get):
            return self.client.get("/django/oidc/callback/", {"code": "the-code", "state": params["state"]}), params

    def test_the_session_offers_the_single_sign_on(self):
        self.assertEqual(self.client.get("/api/auth/session/").json()["single_sign_on"],
                         {"name": "Example SSO", "login_url": "/django/oidc/authenticate/"})

    def test_the_login_goes_to_the_provider_with_pkce(self):
        _, params = self.log_in({"sub": "u-1"})
        self.assertEqual(params["client_id"], "plina-client")
        self.assertEqual(params["redirect_uri"], "http://testserver/django/oidc/callback/")
        self.assertEqual(params["scope"], "openid email profile")
        self.assertEqual(params["code_challenge_method"], "S256")

    def test_a_first_login_creates_the_user_and_comes_back(self):
        response, _ = self.log_in({"sub": "u-1", "preferred_username": "pina", "email": "pina@example.com",
                                   "given_name": "Pina", "family_name": "Merkert"})
        self.assertEqual((response.status_code, response["Location"]), (302, "/week"))
        user = OidcIdentity.objects.get(subject="u-1").user
        self.assertEqual((user.username, user.email, user.first_name), ("pina", "pina@example.com", "Pina"))
        self.assertFalse(user.has_usable_password())
        session = self.client.get("/api/auth/session/").json()
        self.assertTrue(session["authenticated"])
        self.assertTrue(session["user"]["single_sign_on"])
        self.assertFalse(session["user"]["can_change_password"])
        self.assertEqual(self.client.get("/api/tasks/").status_code, 200)

    def test_the_next_login_finds_the_same_user_by_subject(self):
        self.log_in({"sub": "u-1", "preferred_username": "pina", "email": "old@example.com"})
        self.client.logout()
        self.log_in({"sub": "u-1", "preferred_username": "renamed", "email": "new@example.com"})
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(User.objects.get().email, "new@example.com")

    def test_a_local_account_with_the_same_name_or_email_is_never_taken_over(self):
        local = User.objects.create_user("pina", email="pina@example.com")
        self.log_in({"sub": "u-2", "preferred_username": "pina", "email": "pina@example.com"})
        sso_user = OidcIdentity.objects.get(subject="u-2").user
        self.assertNotEqual(sso_user, local)
        self.assertEqual(sso_user.username, "pina-2")

    def assert_refused(self, response):
        # Back to the app's login page, which says the single sign-on failed.
        self.assertEqual((response.status_code, response["Location"]), (302, "/?login=failed"))
        self.assertFalse(OidcIdentity.objects.exists())
        self.assertFalse(self.client.get("/api/auth/session/").json()["authenticated"])

    def test_a_token_from_another_key_is_refused(self):
        global KEY
        real_key, KEY = KEY, rsa.generate_private_key(public_exponent=65537, key_size=2048)
        try:
            with self.assertLogs("accounts.oidc", "WARNING"):
                response, _ = self.log_in({"sub": "u-3"})
        finally:
            KEY = real_key
        self.assert_refused(response)

    def test_a_token_for_another_application_is_refused(self):
        with self.assertLogs("accounts.oidc", "WARNING"):
            response, _ = self.log_in({"sub": "u-3"}, audience="another-app")
        self.assert_refused(response)

    def test_an_unreachable_provider_means_back_to_the_login(self):
        import requests
        self.client.get("/django/oidc/authenticate/")
        state = next(iter(self.client.session["oidc_states"]))
        with mock.patch("mozilla_django_oidc.auth.requests.post", side_effect=requests.ConnectionError("down")), \
                self.assertLogs("accounts.oidc", "WARNING"):
            response = self.client.get("/django/oidc/callback/", {"code": "the-code", "state": state})
        self.assert_refused(response)

    @override_settings(OIDC_REDIRECT_ALLOWED_HOSTS=["localhost:5173"])
    def test_the_app_on_another_origin_gets_back_to_its_page(self):
        # Development: the app on the Vite dev server, the backend on :8000.
        response, _ = self.log_in({"sub": "u-1"}, next_url="http://localhost:5173/week")
        self.assertEqual(response["Location"], "http://localhost:5173/week")
        response, _ = self.log_in({"sub": "u-1"}, next_url="https://evil.example.com/")
        self.assertEqual(response["Location"], "/")

    def test_logging_out_also_ends_the_providers_session(self):
        self.log_in({"sub": "u-1"})
        token = self.client.get("/api/auth/session/").json()["csrf_token"]
        response = self.client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token)
        redirect = urlparse(response.json()["redirect"])
        self.assertEqual(f"{redirect.scheme}://{redirect.netloc}{redirect.path}", SSO["OIDC_OP_LOGOUT_ENDPOINT"])
        self.assertIn("id_token_hint", parse_qs(redirect.query))
        self.assertFalse(self.client.get("/api/auth/session/").json()["authenticated"])


class WithoutSingleSignOnTest(TestCase):
    def test_its_urls_do_not_exist(self):
        self.assertEqual(Client().get("/django/oidc/authenticate/").status_code, 404)
        self.assertEqual(Client().get("/django/oidc/callback/").status_code, 404)



class SettingsFromTheEnvironmentTest(SimpleTestCase):
    def oidc(self, **values):
        with mock.patch.dict(os.environ, values, clear=True):
            return oidc_from_env()

    def test_none_set_means_local_accounts_only(self):
        self.assertEqual(self.oidc(), {})

    def test_all_set(self):
        oidc = self.oidc(**ENV, OIDC_LOGOUT_ENDPOINT="https://sso.example.com/application/o/plina/end-session/",
                         OIDC_REDIRECT_URL="https://plina.example.com/")
        self.assertEqual(oidc["OIDC_RP_CLIENT_ID"], "plina-client")
        self.assertEqual(oidc["OIDC_OP_TOKEN_ENDPOINT"], ENV["OIDC_TOKEN_ENDPOINT"])
        self.assertEqual(oidc["LOGIN_REDIRECT_URL"], "https://plina.example.com/")
        self.assertEqual(oidc["LOGIN_REDIRECT_URL_FAILURE"], "https://plina.example.com/?login=failed")
        self.assertEqual(oidc["OIDC_PROVIDER_NAME"], "sso.example.com")  # unless OIDC_PROVIDER_NAME
        self.assertEqual(self.oidc(**ENV, OIDC_PROVIDER_NAME="Digisoul")["OIDC_PROVIDER_NAME"], "Digisoul")
        self.assertEqual(self.oidc(**ENV)["LOGIN_REDIRECT_URL"], "/")
        self.assertEqual(self.oidc(**ENV)["LOGIN_REDIRECT_URL_FAILURE"], "/?login=failed")

    def test_some_missing_is_an_error_naming_them(self):
        partial = {**ENV}
        del partial["OIDC_JWKS_ENDPOINT"], partial["OIDC_CLIENT_SECRET"]
        with self.assertRaisesMessage(ImproperlyConfigured, "OIDC_CLIENT_SECRET, OIDC_JWKS_ENDPOINT"):
            self.oidc(**partial)

    def test_a_malformed_url_is_an_error(self):
        with self.assertRaisesMessage(ImproperlyConfigured, "OIDC_LOGOUT_ENDPOINT"):
            self.oidc(**ENV, OIDC_LOGOUT_ENDPOINT="ttps://sso.example.com/application/o/plina/end-session/")
