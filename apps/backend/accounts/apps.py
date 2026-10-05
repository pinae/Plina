from django.apps import AppConfig


class AccountsConfig(AppConfig):
    """Logging in (README: Accounts): local accounts, and single sign-on
    (OpenID Connect) when it is configured."""
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'
