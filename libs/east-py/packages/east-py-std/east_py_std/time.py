#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Time platform functions for East.

Provides time-related operations for East programs running in Python.
"""

import asyncio
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from east.runtime.platform import platform_function, platform_functions
from east.types.types import DateTimeType, IntegerType, NullType, StringType


@platform_function(name="time_now", inputs=[], output=IntegerType)
def time_now() -> int:
    """Return the current wall-clock time as a Unix timestamp in milliseconds.

    Returns:
        ``Integer`` (``int``) - milliseconds elapsed since the Unix epoch
        (1970-01-01 00:00:00 UTC).
    """
    return int(time.time() * 1000)


@platform_function(name="time_sleep", inputs=[IntegerType], output=NullType)
async def time_sleep(ms: int) -> None:
    """Suspend execution for the given number of milliseconds.

    Args:
        ms: ``Integer`` (``int``) - duration in milliseconds; must be
            non-negative.

    Returns:
        ``Null`` (``None``).

    Raises:
        ValueError: If ``ms`` is negative.
    """
    if ms < 0:
        raise ValueError(f"Sleep duration must be non-negative, got {ms}")
    await asyncio.sleep(ms / 1000.0)


@platform_function(
    name="time_get_timezone_offset",
    inputs=[DateTimeType, StringType],
    output=IntegerType,
)
def time_get_timezone_offset(dt: datetime, zone_name: str) -> int:
    """Return the UTC offset in minutes for an IANA timezone at a given instant.

    The offset is positive when the timezone is ahead of UTC and negative when
    behind. DST transitions are accounted for via the supplied UTC datetime.

    Args:
        dt: ``DateTime`` (``datetime``) - the UTC instant at which to evaluate
            the offset.
        zone_name: ``String`` (``str``) - IANA timezone name (e.g.,
            ``"Australia/Sydney"``, ``"America/New_York"``).

    Returns:
        ``Integer`` (``int``) - UTC offset in whole minutes.

    Raises:
        ValueError: If ``zone_name`` is not a recognised IANA timezone.
    """
    try:
        tz = ZoneInfo(zone_name)
    except (KeyError, Exception) as e:
        raise ValueError(
            f'Invalid IANA timezone: "{zone_name}". '
            f"Use a valid IANA timezone name such as "
            f'"Australia/Sydney", "America/New_York", or "Europe/London". '
            f"See https://en.wikipedia.org/wiki/List_of_tz_database_time_zones "
            f"for the full list."
        ) from e

    # Ensure the datetime is UTC-aware
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)

    offset = dt.astimezone(tz).utcoffset()
    if offset is None:
        raise ValueError(f'Could not determine UTC offset for timezone "{zone_name}"')

    return int(offset.total_seconds() / 60)


# Collected from the @platform_function decorations above.
time_impl = platform_functions(__name__)


__all__ = [
    "time_impl",
    "time_now",
    "time_sleep",
    "time_get_timezone_offset",
]
