from datetime import timedelta


def minutely_str(t: timedelta):
    hours = 0
    minutes = int(round(t / timedelta(minutes=1)))
    while minutes >= 60:
        hours += 1
        minutes -= 60
    if hours > 0 and minutes == 0:
        return "{:d}h".format(hours)
    return ("{:d}h ".format(hours) if hours > 0 else "") + "{:d}m".format(minutes)

