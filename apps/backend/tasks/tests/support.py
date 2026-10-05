"""Tests run as a user, because all data belongs to one (plina.scoping):
``TestCase`` creates the user "tester" for every test, works with their data
and logs the test client in; ``APIClient`` is logged in as them too.

Before the test's own setUp (Django's ``_pre_setup`` hook), so subclasses
need not call anything.
"""
from contextvars import ContextVar

from django.contrib.auth import get_user_model
from django.test import TestCase as DjangoTestCase
from rest_framework.test import APIClient as DRFAPIClient

from plina.scoping import owner_scope

_test_user = ContextVar("plina_test_user", default=None)


class TestCase(DjangoTestCase):
    @classmethod
    def _pre_setup(cls):
        super()._pre_setup()  # the test's transaction is open now
        cls.user = get_user_model().objects.create_user("tester")  # no password: no slow hashing
        cls._owner_scope = owner_scope(cls.user)
        cls._owner_scope.__enter__()
        cls._user_token = _test_user.set(cls.user)
        cls.client.force_login(cls.user)

    def _post_teardown(self):
        cls = type(self)
        _test_user.reset(cls._user_token)
        cls._owner_scope.__exit__(None, None, None)
        super()._post_teardown()


class APIClient(DRFAPIClient):
    """Logged in as the test's user (tests about logging in make their own)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = _test_user.get()
        if user is not None:
            self.force_login(user)
