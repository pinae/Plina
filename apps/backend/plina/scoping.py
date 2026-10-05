"""Every user has their own data. Models of user data derive from ``Owned``:
their default manager only ever sees the rows of the user a query runs for —
the logged-in user of the current request (``OwnerScopeMiddleware``), or,
outside requests, the user of an explicit ``owner_scope`` (management
commands, tests) — and new rows get that owner.

It fails closed: a query outside of both, or in a request without a login,
raises ``ScopeError`` instead of seeing everybody's rows. The owner is read
when a query runs (``CurrentOwner``), so querysets built in advance (class
attributes of views and serializers) are safe too. ``all_objects`` is the
unscoped manager, for the admin's user deletion and data migrations only.
"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar

from django.conf import settings
from django.db import models

_owner: ContextVar[int | None] = ContextVar("plina_owner", default=None)
_request: ContextVar[object | None] = ContextVar("plina_request", default=None)


class ScopeError(RuntimeError):
    """User data was touched without knowing whose."""


def current_owner_id() -> int:
    """The id of the user whose data may be read and written now."""
    request = _request.get()
    if request is not None:
        # In a request only its user counts (also inside an owner_scope).
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            return user.pk
        raise ScopeError("Plina data is only available to a logged-in user.")
    owner = _owner.get()
    if owner is None:
        raise ScopeError("Plina data outside a request needs owner_scope(user).")
    return owner


def has_owner() -> bool:
    try:
        current_owner_id()
    except ScopeError:
        return False
    return True


@contextmanager
def owner_scope(user):
    """Work with the data of ``user`` (a user or its id) outside requests."""
    token = _owner.set(getattr(user, "pk", user))
    try:
        yield
    finally:
        _owner.reset(token)


@contextmanager
def request_scope(request):
    """The data of the request's logged-in user, while it is handled."""
    token = _request.set(request)
    try:
        yield
    finally:
        _request.reset(token)


class OwnerScopeMiddleware:
    """After AuthenticationMiddleware: queries of a request see its user's
    rows (DRF writes the user it authenticates back to the request)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        with request_scope(request):
            return self.get_response(request)


class CurrentOwner(models.Expression):
    """The current owner's id as a query parameter, read when the query is
    compiled, i.e. when it runs."""

    def __init__(self):
        super().__init__(output_field=models.IntegerField())

    def as_sql(self, compiler, connection):
        return "%s", [current_owner_id()]


def _claim(obj) -> None:
    owner = current_owner_id()
    if obj.owner_id is None:
        obj.owner_id = owner
    elif obj.owner_id != owner:
        raise ScopeError(f"{type(obj).__name__} of another user.")


class OwnedQuerySet(models.QuerySet):
    def bulk_create(self, objs, *args, **kwargs):
        objs = list(objs)
        for obj in objs:
            _claim(obj)
        return super().bulk_create(objs, *args, **kwargs)


class OwnedManager(models.Manager.from_queryset(OwnedQuerySet)):
    def get_queryset(self):
        return super().get_queryset().filter(owner_id=CurrentOwner())


class Owned(models.Model):
    """Abstract base of every model holding a user's data."""
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, related_name="+", on_delete=models.CASCADE,
                              editable=False)

    objects = OwnedManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        _claim(self)
        super().save(*args, **kwargs)
