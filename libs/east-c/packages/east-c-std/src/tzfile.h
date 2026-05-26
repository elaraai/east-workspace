#ifndef EAST_STD_TZFILE_H
#define EAST_STD_TZFILE_H

#include <stdint.h>

/*
 * Minimal IANA TZif (zoneinfo) reader — used on platforms whose C runtime can't
 * resolve IANA timezone names (Windows). Looks up the UTC offset for a zone at a
 * given instant by reading the compiled tz database directly.
 *
 * The base directory is $TZDIR, falling back to /usr/share/zoneinfo. The data is
 * vendored onto the build/runner (CI ships it as an artifact; see test-east-c.yml).
 */

/* Resolve the UTC offset, in minutes east of UTC, for `zone_name` (e.g.
 * "America/New_York") at `epoch_sec` (Unix seconds). On success returns 0 and
 * writes the offset to *out_minutes; on failure (zone missing / malformed)
 * returns non-zero and leaves *out_minutes untouched. */
int east_tzfile_offset_minutes(const char *zone_name, int64_t epoch_sec, int64_t *out_minutes);

#endif /* EAST_STD_TZFILE_H */
