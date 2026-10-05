from django.contrib import admin

from accounts.models import OidcIdentity


@admin.register(OidcIdentity)
class OidcIdentityAdmin(admin.ModelAdmin):
    list_display = ("user", "subject")
    search_fields = ("user__username", "subject")
