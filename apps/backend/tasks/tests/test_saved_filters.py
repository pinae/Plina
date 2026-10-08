"""Saved filters (README: Filtering tasks): named filters of the Tasks tab and
the dependency editor, kept per user and synced to all devices."""
from django.contrib.auth.models import User

from tasks.tests.support import APIClient, TestCase

DEEP_WORK = {"search": "", "projects": [], "tags": ["tag-1"], "estimates": ["gt4"], "worked": [],
             "priority": [7, 10]}


class SavedFilterApiTest(TestCase):
    def setUp(self):
        self.api = APIClient()

    def save(self, name, value=DEEP_WORK):
        return self.api.post("/api/saved-filters/", {"name": name, "filter": value}, format="json")

    def test_saves_lists_by_name_updates_and_deletes(self):
        created = self.save("  Deep work ")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["name"], "Deep work")
        self.assertEqual(created.data["filter"], DEEP_WORK)
        self.save("admin")
        self.assertEqual([f["name"] for f in self.api.get("/api/saved-filters/").data], ["admin", "Deep work"])

        path = f"/api/saved-filters/{created.data['id']}/"
        changed = self.api.patch(path, {"filter": {**DEEP_WORK, "search": "cad"}}, format="json")
        self.assertEqual(changed.data["filter"]["search"], "cad")
        renamed = self.api.patch(path, {"name": "Focus"}, format="json")
        self.assertEqual(renamed.data["name"], "Focus")
        self.assertEqual(self.api.delete(path).status_code, 204)
        self.assertEqual([f["name"] for f in self.api.get("/api/saved-filters/").data], ["admin"])

    def test_completes_a_partial_filter(self):
        response = self.save("Quick ones", {"estimates": ["le15"]})
        self.assertEqual(response.data["filter"], {"search": "", "projects": [], "tags": [], "estimates": ["le15"],
                                                   "worked": [], "priority": [0, 10]})

    def test_names_are_needed_and_unique_in_any_case(self):
        self.save("Deep work")
        self.assertIn("already a filter", str(self.save("deep WORK").data["name"]))
        self.assertIn("name", str(self.save("   ").data["name"]))
        other = self.save("Other").data["id"]
        clash = self.api.patch(f"/api/saved-filters/{other}/", {"name": "Deep Work"}, format="json")
        self.assertEqual(clash.status_code, 400)
        # Its own name again is fine.
        self.assertEqual(self.api.patch(f"/api/saved-filters/{other}/", {"name": "other"}, format="json")
                         .status_code, 200)

    def test_refuses_filters_of_the_wrong_shape(self):
        for value in ([], {"tags": "maker"}, {"estimates": ["soon"]}, {"worked": ["often"]},
                      {"priority": [8, 3]}, {"priority": [0, 11]}, {"priority": [True, 10]},
                      {"search": 5}, {"colour": "red"}):
            response = self.save("Broken", value)
            self.assertEqual(response.status_code, 400, value)
            self.assertIn("filter", response.data)


class SavedFiltersPerUserTest(TestCase):
    def test_nobody_sees_or_changes_another_users_filters(self):
        alice = APIClient()
        saved = alice.post("/api/saved-filters/", {"name": "Deep work", "filter": DEEP_WORK}, format="json").data
        bob = APIClient()
        bob.force_login(User.objects.create_user("bob"))
        self.assertEqual(bob.get("/api/saved-filters/").data, [])
        path = f"/api/saved-filters/{saved['id']}/"
        self.assertEqual(bob.get(path).status_code, 404)
        self.assertEqual(bob.patch(path, {"name": "Bob's"}, format="json").status_code, 404)
        self.assertEqual(bob.delete(path).status_code, 404)
        # The same name is his to use too.
        self.assertEqual(bob.post("/api/saved-filters/", {"name": "Deep work", "filter": {}}, format="json")
                         .status_code, 201)
        self.assertEqual([f["name"] for f in alice.get("/api/saved-filters/").data], ["Deep work"])
