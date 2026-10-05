"""The login API (README: Accounts). The app asks for the session first: it
says who is logged in, how one can log in, and carries the CSRF token that
every change (the login included) must send as X-CSRFToken."""
from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.oidc import provider_logout_url


def session_payload(request):
    """For Django's request (DRF's still has the user before a login/out)."""
    user = request.user
    single_sign_on = None
    if settings.OIDC_ENABLED:
        single_sign_on = {"name": settings.OIDC_PROVIDER_NAME, "login_url": "/django/oidc/authenticate/"}
    return {
        "authenticated": user.is_authenticated,
        "user": {
            "username": user.username,
            "name": user.get_full_name() or user.username,
            "email": user.email,
            "single_sign_on": hasattr(user, "oidc_identity"),
            "can_change_password": user.has_usable_password(),
            "is_staff": user.is_staff,
        } if user.is_authenticated else None,
        "csrf_token": get_token(request),
        "single_sign_on": single_sign_on,
        # Django's reset by mail, when the server can send mail.
        "password_reset_url": "/django/accounts/password_reset/" if settings.PASSWORD_RESET_ENABLED else None,
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(session_payload(request._request))


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)


# The login is checked for its CSRF token although nobody is logged in yet
# (login CSRF: someone else's session foisted on the user).
@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        body = LoginSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        user = authenticate(request._request, **body.validated_data)
        if user is None:
            return Response({"detail": "Wrong user name or password."}, status=400)
        login(request._request, user)
        return Response(session_payload(request._request))


class LogoutView(APIView):
    def post(self, request):
        redirect = provider_logout_url(request)  # before the session is gone
        logout(request._request)
        return Response({"redirect": redirect})


class PasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)


class PasswordView(APIView):
    def post(self, request):
        user = request.user
        if not user.has_usable_password():
            return Response({"detail": "You log in with single sign-on; change the password there."}, status=400)
        body = PasswordSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        if not user.check_password(body.validated_data["old_password"]):
            return Response({"old_password": ["That is not your current password."]}, status=400)
        try:
            validate_password(body.validated_data["new_password"], user)
        except ValidationError as error:
            return Response({"new_password": list(error.messages)}, status=400)
        user.set_password(body.validated_data["new_password"])
        user.save(update_fields=["password"])
        update_session_auth_hash(request._request, user)  # stays logged in
        return Response(session_payload(request._request))
