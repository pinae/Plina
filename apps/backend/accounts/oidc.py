"""Single sign-on with OpenID Connect (mozilla-django-oidc), when the
OIDC_ variables are set (plina.env.oidc_from_env, README: Accounts)."""
import logging
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import SuspiciousOperation
from django.http import Http404
from mozilla_django_oidc.auth import OIDCAuthenticationBackend
from mozilla_django_oidc.views import OIDCAuthenticationCallbackView, OIDCAuthenticationRequestView

from accounts.models import OidcIdentity

logger = logging.getLogger(__name__)


class PlinaOIDCBackend(OIDCAuthenticationBackend):
    """Finds users by the provider's subject and creates them on their first
    login (without a password: they log in through the provider only)."""

    def verify_token(self, token, **kwargs):
        """mozilla-django-oidc checks the signature, expiry and nonce; the
        audience too: a token the provider issued for another application
        is no login to Plina."""
        payload = super().verify_token(token, **kwargs)
        audience = payload.get("aud")
        if self.OIDC_RP_CLIENT_ID not in (audience if isinstance(audience, list) else [audience]):
            raise SuspiciousOperation(f"The ID token is for {audience!r}, not for this client.")
        return payload

    def verify_claims(self, claims):
        return bool(claims.get("sub"))

    def filter_users_by_claims(self, claims):
        return get_user_model().objects.filter(oidc_identity__subject=claims["sub"])

    def create_user(self, claims):
        User = get_user_model()
        base = (claims.get("preferred_username") or claims.get("email", "").split("@")[0] or "user")[:140]
        username, number = base, 1
        while User.objects.filter(username__iexact=username).exists():
            number += 1
            username = f"{base}-{number}"
        user = User.objects.create_user(username, email=claims.get("email", ""))
        OidcIdentity.objects.create(user=user, subject=claims["sub"])
        return self.update_user(user, claims)

    def update_user(self, user, claims):
        """The provider's name and email win (its profile is the source)."""
        values = {"email": claims.get("email", user.email),
                  "first_name": claims.get("given_name", user.first_name)[:150],
                  "last_name": claims.get("family_name", user.last_name)[:150]}
        changed = [field for field, value in values.items() if getattr(user, field) != value]
        for field in changed:
            setattr(user, field, values[field])
        if changed:
            user.save(update_fields=changed)
        return user


class _OnlyWithSingleSignOn:
    def dispatch(self, request, *args, **kwargs):
        if not settings.OIDC_ENABLED:
            raise Http404("No single sign-on is configured.")
        return super().dispatch(request, *args, **kwargs)

    @classmethod
    def as_view(cls, **initkwargs):
        view = super().as_view(**initkwargs)

        def guarded(request, *args, **kwargs):
            # mozilla-django-oidc reads its settings when the view is made.
            if not settings.OIDC_ENABLED:
                raise Http404("No single sign-on is configured.")
            return view(request, *args, **kwargs)
        return guarded


class LoginView(_OnlyWithSingleSignOn, OIDCAuthenticationRequestView):
    pass


class CallbackView(_OnlyWithSingleSignOn, OIDCAuthenticationCallbackView):
    """A refused token or an unreachable provider leads back to the app's
    login page (which says the single sign-on failed), not to an error."""

    def get(self, request):
        try:
            return super().get(request)
        except (SuspiciousOperation, requests.RequestException) as error:
            logger.warning("Single sign-on failed: %s", error)
            return self.login_failure()


def provider_logout_url(request):
    """Where the browser goes after logging out to end the provider's
    session too (None without a logout endpoint or single sign-on login)."""
    endpoint = getattr(settings, "OIDC_OP_LOGOUT_ENDPOINT", None)
    id_token = request.session.get("oidc_id_token")
    if not settings.OIDC_ENABLED or not endpoint or not id_token:
        return None
    return f"{endpoint}?{urlencode({'id_token_hint': id_token})}"
