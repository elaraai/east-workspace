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

from east.runtime.platform import PlatformFunction
from east.types.types import DateTimeType, IntegerType, NullType, StringType


def time_now_impl() -> int:
    """Get current Unix timestamp in milliseconds.

    Returns:
        Current time as milliseconds since Unix epoch (January 1, 1970 UTC)
    """
    return int(time.time() * 1000)


async def time_sleep_impl(ms: int) -> None:
    """Sleep for specified number of milliseconds.

    Args:
        ms: Number of milliseconds to sleep (must be non-negative)

    Raises:
        ValueError: If ms is negative
    """
    if ms < 0:
        raise ValueError(f"Sleep duration must be non-negative, got {ms}")
    await asyncio.sleep(ms / 1000.0)


def time_get_timezone_offset_impl(dt: datetime, zone_name: str) -> int:
    """Get the UTC offset in minutes for an IANA timezone at a given UTC datetime.

    Returns the number of minutes that the given timezone is ahead of (positive)
    or behind (negative) UTC at the specified instant. This accounts for DST
    transitions.

    Args:
        dt: UTC datetime object
        zone_name: IANA timezone name (e.g., "Australia/Sydney", "America/New_York")

    Returns:
        UTC offset in minutes

    Raises:
        ValueError: If the timezone name is not a valid IANA timezone
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


# Platform function implementations
time_impl = [
    PlatformFunction(
        name="time_now",
        inputs=[],
        output=IntegerType,
        type="sync",
        fn=time_now_impl,
    ),
    PlatformFunction(
        name="time_sleep",
        inputs=[IntegerType],
        output=NullType,
        type="async",
        fn=time_sleep_impl,
    ),
    PlatformFunction(
        name="time_get_timezone_offset",
        inputs=[DateTimeType, StringType],
        output=IntegerType,
        type="sync",
        fn=time_get_timezone_offset_impl,
    ),
]


__all__ = ["time_impl"]
