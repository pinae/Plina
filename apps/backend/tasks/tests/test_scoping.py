"""Every user has their own data (plina.scoping): queries see only the rows
of the user they run for — the logged-in user of the request, or the one of
an explicit ``owner_scope`` — and fail outside of both instead of seeing
everybody's."""
from django.contrib.auth.models import User
from django.db.models import Exists, OuterRef
from django.test import RequestFactory
from django.test import TestCase as DjangoTestCase

from plina.scoping import ScopeError, owner_scope, request_scope
from tasks.models import Tag, Task, TaskDependency, UserSettings


class OwnerScopeTest(DjangoTestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice")
        self.bob = User.objects.create_user("bob")
        with owner_scope(self.alice):
            self.alice_task = Task.objects.create(header="Alice's")
            Tag.objects.create(name="hers")
        with owner_scope(self.bob):
            self.bob_task = Task.objects.create(header="Bob's")

    def test_queries_outside_a_scope_fail_instead_of_seeing_everything(self):
        with self.assertRaises(ScopeError):
            list(Task.objects.all())
        with self.assertRaises(ScopeError):
            Task.objects.count()
        with self.assertRaises(ScopeError):
            Task.objects.create(header="Whose?")

    def test_a_scope_sees_and_creates_only_its_owners_rows(self):
        with owner_scope(self.alice):
            self.assertEqual([t.header for t in Task.objects.all()], ["Alice's"])
            self.assertFalse(Task.objects.filter(id=self.bob_task.id).exists())
            created = Task.objects.create(header="New")
            self.assertEqual(Task.objects.count(), 2)
        self.assertEqual(created.owner, self.alice)

    def test_updates_deletes_subqueries_and_related_managers_are_scoped(self):
        with owner_scope(self.bob):
            self.assertEqual(Task.objects.update(priority=9), 1)
            Tag.objects.all().delete()  # nothing of Bob's
            has_tag = Tag.objects.filter(id=OuterRef("pk"))
            self.assertEqual(Task.objects.filter(Exists(has_tag)).count(), 0)
            self.assertEqual(Task.objects.filter(id__in=Task.objects.values("id")).count(), 1)
        with owner_scope(self.alice):
            self.assertEqual(Tag.objects.count(), 1)
            self.assertEqual(Task.objects.get(id=self.alice_task.id).priority, 5)
            child = Task.objects.create(header="Child", parent=self.alice_task)
            self.assertEqual(list(self.alice_task.children.all()), [child])

    def test_bulk_create_assigns_the_owner(self):
        with owner_scope(self.bob):
            Tag.objects.bulk_create([Tag(name="a"), Tag(name="b")])
            self.assertEqual(Tag.objects.count(), 2)
        with owner_scope(self.alice):
            self.assertEqual(Tag.objects.count(), 1)

    def test_saving_another_users_row_is_refused(self):
        with owner_scope(self.alice):
            with self.assertRaises(ScopeError):
                TaskDependency(predecessor=self.alice_task, successor=self.alice_task, owner=self.bob).save()
            with self.assertRaises(ScopeError):
                Tag.objects.bulk_create([Tag(name="x", owner=self.bob)])

    def test_the_logged_in_user_of_a_request_decides(self):
        request = RequestFactory().get("/api/tasks/")
        request.user = self.bob
        with owner_scope(self.alice), request_scope(request):
            self.assertEqual([t.header for t in Task.objects.all()], ["Bob's"])

    def test_a_request_without_a_login_sees_nothing(self):
        from django.contrib.auth.models import AnonymousUser
        request = RequestFactory().get("/api/tasks/")
        request.user = AnonymousUser()
        with owner_scope(self.alice), request_scope(request), self.assertRaises(ScopeError):
            list(Task.objects.all())

    def test_settings_are_per_user(self):
        from tasks.services.settings import get_settings
        with owner_scope(self.alice):
            settings = get_settings()
            settings.time_zone = "Europe/Berlin"
            settings.save()
        with owner_scope(self.bob):
            self.assertEqual(get_settings().time_zone, "")
        with owner_scope(self.alice):
            self.assertEqual(get_settings().time_zone, "Europe/Berlin")
            self.assertEqual(UserSettings.objects.count(), 1)

    def test_deleting_a_user_deletes_their_data(self):
        with owner_scope(self.alice):
            Task.objects.create(header="Child", parent=self.alice_task)
        self.alice.delete()
        with owner_scope(self.bob):
            self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(Task.all_objects.count(), 1)


class DemoDataForOneUserTest(DjangoTestCase):
    def test_replaces_only_the_named_users_data(self):
        from django.core.management import CommandError, call_command
        alice, bob = User.objects.create_user("alice"), User.objects.create_user("bob")
        with owner_scope(bob):
            Task.objects.create(header="Bob's own")
        call_command("populate_demo_data", user="alice", verbosity=0)
        with owner_scope(alice):
            self.assertTrue(Task.objects.filter(header="Webshop Relaunch").exists())
        with owner_scope(bob):
            self.assertEqual([t.header for t in Task.objects.all()], ["Bob's own"])
        with self.assertRaisesMessage(CommandError, "--user"):
            call_command("populate_demo_data", verbosity=0)
        with self.assertRaisesMessage(CommandError, "nobody"):
            call_command("populate_demo_data", user="nobody", verbosity=0)
