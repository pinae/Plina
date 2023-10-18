from django.core.exceptions import PermissionDenied
from django.http import Http404


def forbidden_error_view(request):
    raise PermissionDenied()


def not_found_error_view(request):
    raise Http404()


def internal_error_view(request):
    raise RuntimeError('Internal Error')
