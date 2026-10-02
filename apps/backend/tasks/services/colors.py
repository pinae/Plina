"""Task and time bucket colors (docs/task-entry-ui.md §4.4).

A task shows its own color (``Task.color``, chosen by the user), else its
nearest ancestor's (``TreeIndex.effective_color``).  A top-level task without
one shows its automatic color (``Task.auto_color``): assigned once, as
different as possible from the colors the open tasks show, and kept while the
task is nested (it then follows its new parent) so it comes back when the
task is a project again.

Bucket types work like projects: the chosen color (``TimeBucketType.color``),
else an automatic one (``auto_color``) unlike the other bucket types' colors.

Distances are measured in OKLab, where equal distances look about equally
different (0.02 is roughly the smallest visible difference).
"""
import math
import random
from typing import Iterable, List, Optional, Sequence, Tuple

from django.db.models import F

from tasks.models import Task, TimeBucketType

#: Shown when nothing else applies (the app's teal).
FALLBACK_COLOR = "#539dad"

Lab = Tuple[float, float, float]


def to_hex(value: Optional[bytes]) -> Optional[str]:
    """The model's rgb bytes (bytes or memoryview) as ``#rrggbb``."""
    return "#" + bytes(value).hex() if value is not None else None


def from_hex(hex_color: str) -> bytes:
    return bytes.fromhex(hex_color.lstrip("#"))


# Color math ------------------------------------------------------------------

def _decode(channel: float) -> float:  # sRGB -> linear
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def _encode(channel: float) -> float:  # linear -> sRGB
    return 12.92 * channel if channel <= 0.0031308 else 1.055 * channel ** (1 / 2.4) - 0.055


def _linear_rgb(hex_color: str) -> Tuple[float, float, float]:
    r, g, b = from_hex(hex_color)
    return _decode(r / 255), _decode(g / 255), _decode(b / 255)


def oklab(hex_color: str) -> Lab:
    r, g, b = _linear_rgb(hex_color)
    l = math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def _oklch_hex(lightness: float, chroma: float, hue_degrees: float) -> Optional[str]:
    """``#rrggbb`` for an OKLCH color, or None outside the sRGB gamut."""
    a = chroma * math.cos(math.radians(hue_degrees))
    b = chroma * math.sin(math.radians(hue_degrees))
    l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3
    linear = (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
              -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
              -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    if any(channel < 0 or channel > 1 for channel in linear):
        return None
    return "#" + "".join(f"{round(_encode(channel) * 255):02x}" for channel in linear)


def oklab_distance(first: str, second: str) -> float:
    return math.dist(oklab(first), oklab(second))


def contrast_with_white(hex_color: str) -> float:
    """WCAG contrast ratio of white text on this color."""
    r, g, b = _linear_rgb(hex_color)
    return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)


# Automatic colors ------------------------------------------------------------

def _candidates() -> List[str]:
    # A hue circle at two lightness levels: vivid enough to tell apart, dark
    # enough for the white titles of the Week view's cards.
    colors: List[str] = []
    for lightness in (0.58, 0.66):
        for hue in range(0, 360, 10):
            color = _oklch_hex(lightness, 0.12, hue)
            if color and color not in colors and contrast_with_white(color) >= 3.0:
                colors.append(color)
    return colors


CANDIDATES: Sequence[str] = tuple(_candidates())
_CANDIDATE_LABS = [(color, oklab(color)) for color in CANDIDATES]


def distinct_color(used: Iterable[str], rng: Optional[random.Random] = None) -> str:
    """A candidate as far as possible from every color in ``used``: random
    among those within 90 % of the best distance (so new projects don't
    always walk the hue circle in the same order)."""
    rng = rng or random.Random()
    used_labs = [oklab(color) for color in used]
    if not used_labs:
        return rng.choice(CANDIDATES)
    scored = [(min(math.dist(lab, other) for other in used_labs), color)
              for color, lab in _CANDIDATE_LABS]
    best = max(score for score, _ in scored)
    return rng.choice([color for score, color in scored if score >= 0.9 * best])


def colors_in_use() -> List[str]:
    """The colors the open tasks show of their own: chosen ones, and the
    automatic ones of projects without a chosen color (inherited colors
    repeat these)."""
    used: List[str] = []
    rows = Task.objects.filter(completed_at=None).values_list("parent_id", "color", "auto_color")
    for parent_id, color, auto_color in rows:
        if color is not None:
            used.append(to_hex(color))
        elif parent_id is None and auto_color is not None:
            used.append(to_hex(auto_color))
    return used


def _assign_auto_colors(missing, used: List[str], rng: Optional[random.Random]) -> int:
    """One after another, so each also differs from those assigned before it."""
    for item in missing:
        color = distinct_color(used, rng)
        type(item).objects.filter(pk=item.pk).update(auto_color=from_hex(color))
        used.append(color)
    return len(missing)


def ensure_auto_colors(rng: Optional[random.Random] = None) -> int:
    """Give every top-level task an automatic color if it has none yet.  A
    project with a chosen color gets one too: it is what "Automatic" shows.
    Called by every path that can make a task top-level.  Returns how many."""
    # Projects that will show it first, so they get the most distinct colors.
    missing = list(Task.objects.filter(parent=None, auto_color=None)
                   .order_by(F("color").asc(nulls_first=True), "order", "header"))
    return _assign_auto_colors(missing, colors_in_use(), rng) if missing else 0


def bucket_colors_in_use() -> List[str]:
    """The colors the bucket types show: chosen, else automatic."""
    return [to_hex(color if color is not None else auto)
            for color, auto in TimeBucketType.objects.values_list("color", "auto_color")
            if color is not None or auto is not None]


def ensure_bucket_type_colors(rng: Optional[random.Random] = None) -> int:
    """Give every bucket type an automatic color if it has none yet, unlike
    the colors the other bucket types show.  Returns how many."""
    missing = list(TimeBucketType.objects.filter(auto_color=None)
                   .order_by(F("color").asc(nulls_first=True), "name", "id"))
    return _assign_auto_colors(missing, bucket_colors_in_use(), rng) if missing else 0
