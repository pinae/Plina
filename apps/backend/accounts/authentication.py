"""The API's authentication: Django's session (set by the login API or the
single sign-on callback), CSRF-checked like DRF's SessionAuthentication."""
from rest_framework.authentication import SessionAuthentication as DRFSessionAuthentication


class SessionAuthentication(DRFSessionAuthentication):
    def authenticate_header(self, request):
        # Not logged in is 401 (the app shows its login page); 403 stays for
        # a missing CSRF token or a forbidden action.
        return 'Session'
