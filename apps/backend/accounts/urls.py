from django.urls import path

from accounts import api, oidc

api_urls = [
    path("session/", api.SessionView.as_view(), name="auth-session"),
    path("login/", api.LoginView.as_view(), name="auth-login"),
    path("logout/", api.LogoutView.as_view(), name="auth-logout"),
    path("password/", api.PasswordView.as_view(), name="auth-password"),
]

# The names mozilla-django-oidc reverses.
oidc_urls = [
    path("authenticate/", oidc.LoginView.as_view(), name="oidc_authentication_init"),
    path("callback/", oidc.CallbackView.as_view(), name="oidc_authentication_callback"),
]
