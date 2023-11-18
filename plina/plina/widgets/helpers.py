from datetime import timedelta
import re


def minutely_str(t: timedelta):
    hours = 0
    minutes = int(round(t / timedelta(minutes=1)))
    while minutes >= 60:
        hours += 1
        minutes -= 60
    if hours > 0 and minutes == 0:
        return "{:d}h".format(hours)
    return ("{:d}h ".format(hours) if hours > 0 else "") + "{:d}m".format(minutes)


def str_to_timedelta(s: str):
    matches = re.match(r"^((?P<minutes>\d+(,\d+)?)m)?((?P<hours>\d+(,\d+)?)h)?((?P<days>\d+(,\d+)?)d)?$", s)
    if matches:
        gm = matches.groupdict()
        return timedelta(minutes=float(gm['minutes']) if 'minutes' in gm and gm['minutes'] is not None else 0.0,
                         hours=float(gm['hours']) if 'hours' in gm and gm['hours'] is not None else 0.0,
                         days=float(gm['days']) if 'days' in gm and gm['days'] is not None else 0.0)
    raise ValueError("Malformatted string for constructing a timedelta.")
