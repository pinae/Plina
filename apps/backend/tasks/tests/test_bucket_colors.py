"""Time bucket colors work like project colors (docs/task-entry-ui.md §4.4):
a bucket type shows its chosen color, else an automatic one — assigned once,
as different as possible from the colors the other bucket types show. Every
bucket shows its type's color.

``hex_color`` is the color a type shows, ``own_hex_color`` the chosen one
(null = automatic), ``auto_hex_color`` its automatic one.
"""
import random
from datetime import timedelta

from tasks.tests.support import TestCase
from tasks.tests.support import APIClient

from tasks.models import TimeBucketType
from tasks.services.colors import (bucket_colors_in_use, ensure_bucket_type_colors,
                                   oklab_distance)

HEX = r"^#[0-9a-f]{6}$"
RED, BLUE = "#d03b3b", "#3357ff"


class EnsureBucketTypeColorsTest(TestCase):
    def test_every_type_gets_a_distinct_automatic_color(self):
        mornings = TimeBucketType.objects.create(name="Mornings")
        evenings = TimeBucketType.objects.create(name="Evenings")
        chosen = TimeBucketType.objects.create(name="Chosen", color=bytes.fromhex("d03b3b"))

        self.assertEqual(ensure_bucket_type_colors(random.Random(5)), 3)

        mornings, evenings, chosen = (TimeBucketType.objects.get(id=t.id)
                                      for t in (mornings, evenings, chosen))
        self.assertNotEqual(bytes(mornings.auto_color), bytes(evenings.auto_color))
        self.assertIsNotNone(chosen.auto_color)  # what "Automatic" would show
        for bucket_type in (mornings, evenings):
            self.assertGreater(oklab_distance(bucket_type.hex_color, RED), 0.07)
        self.assertEqual(chosen.hex_color, RED)

    def test_existing_automatic_colors_stay(self):
        TimeBucketType.objects.create(name="A", auto_color=bytes.fromhex("3357ff"))
        self.assertEqual(ensure_bucket_type_colors(), 0)

    def test_colors_in_use_are_the_ones_the_types_show(self):
        TimeBucketType.objects.create(name="Auto", auto_color=bytes.fromhex("3357ff"))
        TimeBucketType.objects.create(name="Chosen", color=bytes.fromhex("d03b3b"),
                                      auto_color=bytes.fromhex("2e9e4f"))
        self.assertEqual(sorted(bucket_colors_in_use()), sorted([BLUE, RED]))


class BucketTypeColorApiTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def post(self, **body):
        body = {"name": "Mornings", "start_times": "every weekday at 09:00",
                "duration": "04:00:00", **body}
        response = self.client.post("/api/buckettypes/", body, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def patch(self, bucket_type, **body):
        response = self.client.patch(f"/api/buckettypes/{bucket_type['id']}/", body, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_a_new_type_gets_an_automatic_color_unlike_the_others(self):
        mornings = self.post(name="Mornings")
        evenings = self.post(name="Evenings")
        self.assertRegex(mornings["hex_color"], HEX)
        self.assertIsNone(mornings["own_hex_color"])
        self.assertEqual(mornings["auto_hex_color"], mornings["hex_color"])
        self.assertNotEqual(mornings["hex_color"], evenings["hex_color"])
        listed = {t["name"]: t["hex_color"] for t in self.client.get("/api/buckettypes/").data}
        self.assertEqual(listed["Mornings"], mornings["hex_color"])  # stable

    def test_choosing_and_clearing_a_color(self):
        mornings = self.post(own_hex_color=RED)
        self.assertEqual((mornings["hex_color"], mornings["own_hex_color"]), (RED, RED))
        automatic = mornings["auto_hex_color"]
        self.assertRegex(automatic, HEX)
        self.assertNotIn(automatic, (RED, "#539dad"))

        mornings = self.patch(mornings, own_hex_color=BLUE)
        self.assertEqual(mornings["hex_color"], BLUE)
        mornings = self.patch(mornings, own_hex_color=None)
        self.assertEqual(mornings["hex_color"], automatic)
        mornings = self.patch(mornings, name="Early mornings")  # other edits keep it
        self.assertEqual(mornings["hex_color"], automatic)

    def test_malformed_colors_are_rejected(self):
        mornings = self.post()
        response = self.client.patch(f"/api/buckettypes/{mornings['id']}/",
                                     {"own_hex_color": "blue"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("#3357ff", str(response.data["own_hex_color"]))

    def test_buckets_in_the_plan_show_their_types_color(self):
        self.post(name="Mornings", start_times="every day at 09:00", own_hex_color=BLUE)
        evenings = self.post(name="Evenings", start_times="every day at 19:00")
        colors = {b["type_name"]: b["hex_color"] for b in self.client.get("/api/plan/").data["buckets"]}
        self.assertEqual(colors["Mornings"], BLUE)
        self.assertEqual(colors["Evenings"], evenings["hex_color"])
        # Unlike the color Mornings shows; its unshown automatic color isn't
        # reserved, so Evenings may get the same one.
        self.assertGreater(oklab_distance(colors["Evenings"], BLUE), 0.07)


class HexColorSetterTest(TestCase):
    def test_the_setter_writes_the_chosen_color(self):
        bucket_type = TimeBucketType(name="A", duration=timedelta(hours=1))
        bucket_type.hex_color = "#3357FF"
        self.assertEqual(bucket_type.color, b"\x33\x57\xff")
        bucket_type.hex_color = None
        self.assertIsNone(bucket_type.color)
