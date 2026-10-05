from django.conf import settings
from django.db import models


class OidcIdentity(models.Model):
    """The single sign-on account a user logs in with: the provider's stable
    subject (``sub``). Users are found by it, never by name or email, so a
    single sign-on can't take over a local account."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, related_name="oidc_identity", on_delete=models.CASCADE)
    subject = models.CharField(max_length=255, unique=True)

    class Meta:
        verbose_name = "single sign-on identity"
        verbose_name_plural = "single sign-on identities"

    def __str__(self) -> str:
        return f"{self.user.username} ({self.subject})"
