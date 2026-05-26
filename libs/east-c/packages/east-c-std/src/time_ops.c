/*
 * Time platform functions for East.
 *
 * Provides time-related operations for East programs running in C.
 */

#include "east_std/east_std.h"
#include <east/values.h>
#include <east/eval_result.h>
#include <east/compat.h>
#include <time.h>
#ifndef _WIN32
#include <unistd.h>
#endif
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "tzfile.h"

static EvalResult time_now(EastValue **args, size_t num_args, EastType **input_types,
                           size_t num_input_types, EastType *output_type)
{
    (void)args;
    (void)num_args;

    return eval_ok(east_integer(east_realtime_millis()));
}

static EvalResult time_sleep(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    int64_t millis = args[0]->data.integer;

    if (millis > 0) {
        usleep((useconds_t)(millis * 1000));
    }
    return eval_ok(east_null());
}

static EvalResult time_get_timezone_offset(EastValue **args, size_t num_args,
                                           EastType **input_types, size_t num_input_types,
                                           EastType *output_type)
{
    (void)num_args;
    int64_t epoch_ms = args[0]->data.datetime;
    const char *zone_name = args[1]->data.string.data;
    time_t epoch_sec = (time_t)(epoch_ms / 1000);

#ifdef _WIN32
    /* Windows' CRT can't resolve IANA zone names, so read the vendored tz
     * database directly. Unknown zones fall back to UTC, matching POSIX. */
    int64_t offset_minutes = 0;
    east_tzfile_offset_minutes(zone_name, (int64_t)epoch_sec, &offset_minutes);
    return eval_ok(east_integer(offset_minutes));
#else
    /* POSIX: resolve via TZ + the system tz database and read tm_gmtoff,
     * saving/restoring TZ so the process environment is left untouched. */
    char *old_tz = getenv("TZ");
    char *saved_tz = old_tz ? strdup(old_tz) : NULL;
    setenv("TZ", zone_name, 1);
    tzset();

    struct tm local_tm;
    localtime_r(&epoch_sec, &local_tm);

    if (saved_tz) {
        setenv("TZ", saved_tz, 1);
        free(saved_tz);
    } else {
        unsetenv("TZ");
    }
    tzset();

    return eval_ok(east_integer((int64_t)local_tm.tm_gmtoff / 60));
#endif
}

void east_std_register_time(PlatformRegistry *reg)
{
    platform_registry_add(reg, "time_now", time_now, false);
    platform_registry_add(reg, "time_sleep", time_sleep, false);
    platform_registry_add(reg, "time_get_timezone_offset", time_get_timezone_offset, false);
}
