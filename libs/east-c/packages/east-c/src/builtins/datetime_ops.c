/*
 * DateTime builtin functions.
 *
 * DateTime is stored as epoch milliseconds (int64_t). The UTC calendar
 * conversion in both directions is computed here rather than by the C library,
 * which cannot represent pre-1970 instants on every platform.
 */
#include "east/builtins.h"
#include "east/values.h"
#include "east/compat.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* Proleptic Gregorian calendar arithmetic, done here rather than by the CRT.
 *
 * The C library is not usable for this: MSVCRT's gmtime returns NULL for any
 * time_t before the 1970 epoch and leaves the caller's struct tm UNTOUCHED,
 * and _mkgmtime likewise refuses to compose one — so on Windows every pre-1970
 * instant decomposed to uninitialized stack while POSIX answered correctly.
 * JavaScript's Date and python's datetime are both unbounded proleptic
 * Gregorian, so computing the calendar here is what makes the runtimes agree
 * at EVERY instant rather than only after 1970. The two functions are exact
 * over the whole int64 range (Howard Hinnant's chrono algorithms), and days
 * are counted from 1970-01-01. */
static void civil_from_days(int64_t z, int64_t *y, unsigned *m, unsigned *d)
{
    z += 719468; /* shift the epoch to 0000-03-01, so leap day ends the year */
    int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    unsigned doe = (unsigned)(z - era * 146097);                          /* [0, 146096] */
    unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; /* [0, 399] */
    unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);               /* [0, 365] */
    unsigned mp = (5 * doy + 2) / 153;                                    /* [0, 11] */
    *d = doy - (153 * mp + 2) / 5 + 1;                                    /* [1, 31] */
    *m = mp < 10 ? mp + 3 : mp - 9;                                       /* [1, 12] */
    *y = (int64_t)yoe + era * 400 + (*m <= 2);
}

static int64_t days_from_civil(int64_t y, unsigned m, unsigned d)
{
    y -= m <= 2;
    int64_t era = (y >= 0 ? y : y - 399) / 400;
    unsigned yoe = (unsigned)(y - era * 400);                       /* [0, 399] */
    unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1; /* [0, 365] */
    unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;           /* [0, 146096] */
    return era * 146097 + (int64_t)doe - 719468;
}

/* Helper: get struct tm from epoch millis (UTC).
 *
 * The split FLOORS toward negative infinity. C division truncates toward
 * ZERO, so a negative epoch-ms would land on the next second UP and every
 * pre-1970 datetime would decompose one second late — -1 read as
 * 1970-01-01 00:00:00 rather than 1969-12-31 23:59:59. The millisecond
 * getter already takes its remainder this way, and JavaScript's Date does
 * too, so this is what makes the components agree across runtimes. */
static struct tm millis_to_tm(int64_t millis)
{
    int64_t secs = millis / 1000;
    if (millis % 1000 < 0) secs -= 1;

    int64_t days = secs / 86400;
    int64_t sod = secs % 86400; /* second of day, floored the same way */
    if (sod < 0) {
        sod += 86400;
        days -= 1;
    }

    int64_t year;
    unsigned month, day;
    civil_from_days(days, &year, &month, &day);

    struct tm result;
    memset(&result, 0, sizeof result);
    result.tm_year = (int)(year - 1900);
    result.tm_mon = (int)month - 1;
    result.tm_mday = (int)day;
    result.tm_hour = (int)(sod / 3600);
    result.tm_min = (int)(sod / 60 % 60);
    result.tm_sec = (int)(sod % 60);
    /* 1970-01-01 was a Thursday (tm_wday 4); days % 7 is in [-6, 6], so the
     * +11 keeps the second modulus off C's negative remainder. */
    result.tm_wday = (int)((days % 7 + 11) % 7);
    result.tm_yday = (int)(days - days_from_civil(year, 1, 1));
    return result;
}

/* Epoch milliseconds from UTC components, normalising out of range exactly as
 * timegm does — an out-of-range component rolls into the next one rather than
 * raising, which is the documented FromComponents behaviour (31 February is
 * 2 or 3 March). The month is carried into the year explicitly; every other
 * component carries through the arithmetic on its own. */
static int64_t millis_from_components(int64_t year, int64_t month, int64_t day, int64_t hour,
                                      int64_t minute, int64_t second, int64_t millis)
{
    int64_t mz = month - 1;
    int64_t carry = mz >= 0 ? mz / 12 : -((-mz + 11) / 12);
    int64_t days = days_from_civil(year + carry, (unsigned)(mz - carry * 12) + 1, 1) + (day - 1);
    return (days * 86400 + hour * 3600 + minute * 60 + second) * 1000 + millis;
}

/* --- static implementations --- */

static EastValue *datetime_add_milliseconds(EastValue **args, size_t n)
{
    (void)n;
    int64_t dt = args[0]->data.datetime;
    int64_t ms = args[1]->data.integer;
    return east_datetime(dt + ms);
}

static EastValue *datetime_duration_milliseconds(EastValue **args, size_t n)
{
    (void)n;
    int64_t a = args[0]->data.datetime;
    int64_t b = args[1]->data.datetime;
    return east_integer(a - b);
}

static EastValue *datetime_get_year(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_year + 1900);
}

static EastValue *datetime_get_month(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_mon + 1); /* 1-12 */
}

static EastValue *datetime_get_day_of_month(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_mday);
}

static EastValue *datetime_get_hour(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_hour);
}

static EastValue *datetime_get_minute(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_min);
}

static EastValue *datetime_get_second(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    return east_integer(t.tm_sec);
}

static EastValue *datetime_get_millisecond(EastValue **args, size_t n)
{
    (void)n;
    int64_t millis = args[0]->data.datetime;
    int64_t ms = millis % 1000;
    if (ms < 0) ms += 1000;
    return east_integer(ms);
}

static EastValue *datetime_get_day_of_week(EastValue **args, size_t n)
{
    (void)n;
    struct tm t = millis_to_tm(args[0]->data.datetime);
    /* ISO 8601: 1=Monday, 7=Sunday.  tm_wday: 0=Sunday, 6=Saturday */
    int iso_day = t.tm_wday == 0 ? 7 : t.tm_wday;
    return east_integer(iso_day);
}

static EastValue *datetime_to_epoch_milliseconds(EastValue **args, size_t n)
{
    (void)n;
    return east_integer(args[0]->data.datetime);
}

static EastValue *datetime_from_epoch_milliseconds(EastValue **args, size_t n)
{
    (void)n;
    return east_datetime(args[0]->data.integer);
}

static EastValue *datetime_from_components(EastValue **args, size_t n)
{
    (void)n;
    return east_datetime(millis_from_components(
        args[0]->data.integer, args[1]->data.integer, args[2]->data.integer, args[3]->data.integer,
        args[4]->data.integer, args[5]->data.integer, args[6]->data.integer));
}

/* ---- Month/weekday name tables ---- */

static const char *MONTH_FULL[] = {"January",   "February", "March",    "April",
                                   "May",       "June",     "July",     "August",
                                   "September", "October",  "November", "December"};
static const char *MONTH_SHORT[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
static const char *WDAY_FULL[] = {"Sunday",   "Monday", "Tuesday", "Wednesday",
                                  "Thursday", "Friday", "Saturday"};
static const char *WDAY_SHORT[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char *WDAY_MIN[] = {"Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"};

/* ---- Helper: append to dynamic buffer ---- */
typedef struct {
    char *data;
    size_t len;
    size_t cap;
} DtBuf;
static void dtbuf_init(DtBuf *b)
{
    b->cap = 128;
    b->data = malloc(b->cap);
    b->len = 0;
    b->data[0] = '\0';
}
static void dtbuf_append(DtBuf *b, const char *s, size_t slen)
{
    while (b->len + slen + 1 > b->cap) {
        b->cap *= 2;
        b->data = realloc(b->data, b->cap);
    }
    memcpy(b->data + b->len, s, slen);
    b->len += slen;
    b->data[b->len] = '\0';
}
static void dtbuf_append_str(DtBuf *b, const char *s)
{
    dtbuf_append(b, s, strlen(s));
}

/* ---- DateTimePrintFormat ---- */

static EastValue *datetime_print_format_impl(EastValue **args, size_t n)
{
    (void)n;
    int64_t millis = args[0]->data.datetime;
    EastValue *tokens = args[1]; /* Array of DateTimeFormatToken variants */

    struct tm t = millis_to_tm(millis);
    int64_t ms = millis % 1000;
    if (ms < 0) ms += 1000;
    int year = t.tm_year + 1900;
    int month = t.tm_mon + 1;
    int day = t.tm_mday;
    int hour = t.tm_hour;
    int min = t.tm_min;
    int sec = t.tm_sec;
    int wday = t.tm_wday; /* 0=Sunday */

    DtBuf buf;
    dtbuf_init(&buf);

    for (size_t i = 0; i < tokens->data.array.len; i++) {
        EastValue *tok = tokens->data.array.items[i];
        const char *ttype = east_variant_case_name(tok);
        char tmp[32];

        if (strcmp(ttype, "year4") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", year);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "year2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", year % 100);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "month1") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", month);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "month2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", month);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "monthNameShort") == 0) {
            dtbuf_append_str(&buf, MONTH_SHORT[month - 1]);
        } else if (strcmp(ttype, "monthNameFull") == 0) {
            dtbuf_append_str(&buf, MONTH_FULL[month - 1]);
        } else if (strcmp(ttype, "day1") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", day);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "day2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", day);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "weekdayNameMin") == 0) {
            dtbuf_append_str(&buf, WDAY_MIN[wday]);
        } else if (strcmp(ttype, "weekdayNameShort") == 0) {
            dtbuf_append_str(&buf, WDAY_SHORT[wday]);
        } else if (strcmp(ttype, "weekdayNameFull") == 0) {
            dtbuf_append_str(&buf, WDAY_FULL[wday]);
        } else if (strcmp(ttype, "hour24_1") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", hour);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "hour24_2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", hour);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "hour12_1") == 0) {
            int h12 = hour % 12;
            if (h12 == 0) h12 = 12;
            snprintf(tmp, sizeof(tmp), "%d", h12);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "hour12_2") == 0) {
            int h12 = hour % 12;
            if (h12 == 0) h12 = 12;
            snprintf(tmp, sizeof(tmp), "%02d", h12);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "minute1") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", min);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "minute2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", min);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "second1") == 0) {
            snprintf(tmp, sizeof(tmp), "%d", sec);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "second2") == 0) {
            snprintf(tmp, sizeof(tmp), "%02d", sec);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "millisecond3") == 0) {
            snprintf(tmp, sizeof(tmp), "%03d", (int)ms);
            dtbuf_append_str(&buf, tmp);
        } else if (strcmp(ttype, "ampmUpper") == 0) {
            dtbuf_append_str(&buf, hour < 12 ? "AM" : "PM");
        } else if (strcmp(ttype, "ampmLower") == 0) {
            dtbuf_append_str(&buf, hour < 12 ? "am" : "pm");
        } else if (strcmp(ttype, "literal") == 0) {
            EastValue *val = tok->data.variant.value;
            if (val && val->kind == EAST_VAL_STRING)
                dtbuf_append(&buf, val->data.string.data, val->data.string.len);
        }
    }

    EastValue *result = east_string(buf.data);
    free(buf.data);
    return result;
}

/* ---- DateTimeParseFormat ---- */

/* Helper: case-insensitive prefix match, returns matched length or 0 */
static size_t ci_prefix(const char *input, size_t ilen, const char *pattern)
{
    size_t plen = strlen(pattern);
    if (ilen < plen) return 0;
    for (size_t i = 0; i < plen; i++) {
        char a = input[i], b = pattern[i];
        if (a >= 'A' && a <= 'Z') a += 32;
        if (b >= 'A' && b <= 'Z') b += 32;
        if (a != b) return 0;
    }
    return plen;
}

/* Helper: parse exactly N digits at position */
static int parse_digits(const char *s, size_t slen, size_t pos, int count, int *out)
{
    if (pos + (size_t)count > slen) return 0;
    int val = 0;
    for (int i = 0; i < count; i++) {
        char c = s[pos + i];
        if (c < '0' || c > '9') return 0;
        val = val * 10 + (c - '0');
    }
    *out = val;
    return 1;
}

/* Helper: parse 1-or-2 digits */
static int parse_1or2_digits(const char *s, size_t slen, size_t pos, int *out, int *consumed)
{
    if (pos >= slen || s[pos] < '0' || s[pos] > '9') return 0;
    /* Try 2 digits first */
    if (pos + 1 < slen && s[pos + 1] >= '0' && s[pos + 1] <= '9') {
        *out = (s[pos] - '0') * 10 + (s[pos + 1] - '0');
        *consumed = 2;
        return 1;
    }
    *out = s[pos] - '0';
    *consumed = 1;
    return 1;
}

/* Helper: set parse error and return NULL */
#define PARSE_ERR(pos, ...)                                                                        \
    do {                                                                                           \
        char _buf[512];                                                                            \
        int _off = snprintf(_buf, sizeof(_buf),                                                    \
                            "Failed to parse datetime at position %zu: ", (size_t)(pos));          \
        snprintf(_buf + _off, sizeof(_buf) - _off, __VA_ARGS__);                                   \
        east_builtin_error(_buf);                                                                  \
        return NULL;                                                                               \
    } while (0)

static EastValue *datetime_parse_format_impl(EastValue **args, size_t n)
{
    (void)n;
    const char *input = args[0]->data.string.data;
    size_t ilen = args[0]->data.string.len;
    EastValue *tokens = args[1];

    int year = -1, month = -1, day = -1;
    int hour = -1, minute = -1, second = -1, millisecond = -1;
    int hour12 = -1, is_pm = -1;
    int parsed_weekday = -1;
    size_t pos = 0;

    for (size_t i = 0; i < tokens->data.array.len; i++) {
        EastValue *tok = tokens->data.array.items[i];
        const char *ttype = east_variant_case_name(tok);

        if (strcmp(ttype, "year4") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 4, &v)) PARSE_ERR(pos, "Expected 4-digit year");
            year = v;
            pos += 4;
        } else if (strcmp(ttype, "year2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v)) PARSE_ERR(pos, "Expected 2-digit year");
            year = 2000 + v;
            pos += 2;
        } else if (strcmp(ttype, "month2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit month (01-12)");
            if (v < 1 || v > 12) PARSE_ERR(pos, "Month out of range (got %d, expected 01-12)", v);
            month = v;
            pos += 2;
        } else if (strcmp(ttype, "month1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit month");
            if (v < 1 || v > 12) PARSE_ERR(pos, "Month out of range (got %d, expected 1-12)", v);
            month = v;
            pos += c;
        } else if (strcmp(ttype, "monthNameFull") == 0) {
            int found = 0;
            for (int m = 0; m < 12; m++) {
                size_t ml = ci_prefix(input + pos, ilen - pos, MONTH_FULL[m]);
                if (ml > 0) {
                    month = m + 1;
                    pos += ml;
                    found = 1;
                    break;
                }
            }
            if (!found) PARSE_ERR(pos, "Expected full month name (e.g., \"January\")");
        } else if (strcmp(ttype, "monthNameShort") == 0) {
            int found = 0;
            for (int m = 0; m < 12; m++) {
                size_t ml = ci_prefix(input + pos, ilen - pos, MONTH_SHORT[m]);
                if (ml > 0) {
                    month = m + 1;
                    pos += ml;
                    found = 1;
                    break;
                }
            }
            if (!found) PARSE_ERR(pos, "Expected short month name (e.g., \"Jan\")");
        } else if (strcmp(ttype, "day2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit day (01-31)");
            if (v < 1 || v > 31) PARSE_ERR(pos, "Day out of range (got %d, expected 01-31)", v);
            day = v;
            pos += 2;
        } else if (strcmp(ttype, "day1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit day");
            if (v < 1 || v > 31) PARSE_ERR(pos, "Day out of range (got %d, expected 1-31)", v);
            day = v;
            pos += c;
        } else if (strcmp(ttype, "weekdayNameFull") == 0) {
            int found = 0;
            for (int w = 0; w < 7; w++) {
                size_t wl = ci_prefix(input + pos, ilen - pos, WDAY_FULL[w]);
                if (wl > 0) {
                    parsed_weekday = w;
                    pos += wl;
                    found = 1;
                    break;
                }
            }
            if (!found) PARSE_ERR(pos, "Expected full weekday name (e.g., \"Monday\")");
        } else if (strcmp(ttype, "weekdayNameShort") == 0) {
            int found = 0;
            for (int w = 0; w < 7; w++) {
                size_t wl = ci_prefix(input + pos, ilen - pos, WDAY_SHORT[w]);
                if (wl > 0) {
                    parsed_weekday = w;
                    pos += wl;
                    found = 1;
                    break;
                }
            }
            if (!found) PARSE_ERR(pos, "Expected short weekday name (e.g., \"Mon\")");
        } else if (strcmp(ttype, "weekdayNameMin") == 0) {
            int found = 0;
            for (int w = 0; w < 7; w++) {
                size_t wl = ci_prefix(input + pos, ilen - pos, WDAY_MIN[w]);
                if (wl > 0) {
                    parsed_weekday = w;
                    pos += wl;
                    found = 1;
                    break;
                }
            }
            if (!found) PARSE_ERR(pos, "Expected minimal weekday name (e.g., \"Mo\")");
        } else if (strcmp(ttype, "hour24_2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit hour (00-23)");
            if (v > 23) PARSE_ERR(pos, "Hour out of range (got %d, expected 00-23)", v);
            hour = v;
            pos += 2;
        } else if (strcmp(ttype, "hour24_1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit hour");
            if (v > 23) PARSE_ERR(pos, "Hour out of range (got %d, expected 0-23)", v);
            hour = v;
            pos += c;
        } else if (strcmp(ttype, "hour12_2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit hour (01-12)");
            if (v < 1 || v > 12) PARSE_ERR(pos, "Hour out of range (got %d, expected 01-12)", v);
            hour12 = v;
            pos += 2;
        } else if (strcmp(ttype, "hour12_1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit hour");
            if (v < 1 || v > 12) PARSE_ERR(pos, "Hour out of range (got %d, expected 1-12)", v);
            hour12 = v;
            pos += c;
        } else if (strcmp(ttype, "minute2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit minute (00-59)");
            if (v > 59) PARSE_ERR(pos, "Minute out of range (got %d, expected 00-59)", v);
            minute = v;
            pos += 2;
        } else if (strcmp(ttype, "minute1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit minute");
            if (v > 59) PARSE_ERR(pos, "Minute out of range (got %d, expected 0-59)", v);
            minute = v;
            pos += c;
        } else if (strcmp(ttype, "second2") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 2, &v))
                PARSE_ERR(pos, "Expected 2-digit second (00-59)");
            if (v > 59) PARSE_ERR(pos, "Second out of range (got %d, expected 00-59)", v);
            second = v;
            pos += 2;
        } else if (strcmp(ttype, "second1") == 0) {
            int v, c;
            if (!parse_1or2_digits(input, ilen, pos, &v, &c))
                PARSE_ERR(pos, "Expected 1 or 2-digit second");
            if (v > 59) PARSE_ERR(pos, "Second out of range (got %d, expected 0-59)", v);
            second = v;
            pos += c;
        } else if (strcmp(ttype, "millisecond3") == 0) {
            int v;
            if (!parse_digits(input, ilen, pos, 3, &v))
                PARSE_ERR(pos, "Expected 3-digit millisecond (000-999)");
            millisecond = v;
            pos += 3;
        } else if (strcmp(ttype, "ampmUpper") == 0 || strcmp(ttype, "ampmLower") == 0) {
            if (pos + 2 > ilen) PARSE_ERR(pos, "Expected \"AM\" or \"PM\"");
            char a = input[pos], b = input[pos + 1];
            if (a >= 'A' && a <= 'Z') a += 32;
            if (b >= 'A' && b <= 'Z') b += 32;
            if (a == 'a' && b == 'm') {
                is_pm = 0;
                pos += 2;
            } else if (a == 'p' && b == 'm') {
                is_pm = 1;
                pos += 2;
            } else
                PARSE_ERR(pos, "Expected \"AM\" or \"PM\"");
        } else if (strcmp(ttype, "literal") == 0) {
            EastValue *val = tok->data.variant.value;
            if (val && val->kind == EAST_VAL_STRING) {
                size_t llen = val->data.string.len;
                if (pos + llen > ilen || memcmp(input + pos, val->data.string.data, llen) != 0)
                    PARSE_ERR(pos, "Expected literal \"%.*s\"", (int)llen, val->data.string.data);
                pos += llen;
            }
        }
    }

    /* Check for trailing input */
    if (pos < ilen) PARSE_ERR(pos, "Unexpected trailing characters: \"%s\"", input + pos);

    /* Convert hour12 + am/pm to hour24 */
    if (hour == -1 && hour12 != -1) {
        if (is_pm == -1) PARSE_ERR(0, "12-hour format specified without AM/PM indicator");
        if (is_pm)
            hour = (hour12 == 12) ? 12 : hour12 + 12;
        else
            hour = (hour12 == 12) ? 0 : hour12;
    }

    /* Defaults */
    if (year == -1) year = 1970;
    if (month == -1) month = 1;
    if (day == -1) day = 1;
    if (hour == -1) hour = 0;
    if (minute == -1) minute = 0;
    if (second == -1) second = 0;
    if (millisecond == -1) millisecond = 0;

    int64_t stamp = millis_from_components(year, month, day, hour, minute, second, 0);

    /* Validate date (e.g., Feb 31 would roll over) */
    struct tm check = millis_to_tm(stamp);
    if (check.tm_year + 1900 != year || check.tm_mon + 1 != month || check.tm_mday != day)
        PARSE_ERR(0, "Invalid date: %04d-%02d-%02d", year, month, day);

    /* Validate weekday if parsed */
    if (parsed_weekday >= 0 && check.tm_wday != parsed_weekday)
        PARSE_ERR(0, "Weekday mismatch: parsed \"%s\" but date is actually \"%s\"",
                  WDAY_FULL[parsed_weekday], WDAY_FULL[check.tm_wday]);

    return east_datetime(stamp + millisecond);
}

#undef PARSE_ERR

/* --- factory functions --- */

static BuiltinImpl datetime_add_ms_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_add_milliseconds;
}
static BuiltinImpl datetime_dur_ms_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_duration_milliseconds;
}
static BuiltinImpl datetime_year_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_year;
}
static BuiltinImpl datetime_month_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_month;
}
static BuiltinImpl datetime_day_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_day_of_month;
}
static BuiltinImpl datetime_hour_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_hour;
}
static BuiltinImpl datetime_minute_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_minute;
}
static BuiltinImpl datetime_second_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_second;
}
static BuiltinImpl datetime_ms_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_millisecond;
}
static BuiltinImpl datetime_dow_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_get_day_of_week;
}
static BuiltinImpl datetime_to_epoch_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_to_epoch_milliseconds;
}
static BuiltinImpl datetime_from_epoch_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_from_epoch_milliseconds;
}
static BuiltinImpl datetime_from_comp_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_from_components;
}
static BuiltinImpl datetime_print_fmt_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_print_format_impl;
}
static BuiltinImpl datetime_parse_fmt_factory(EastType **tp, size_t ntp)
{
    (void)tp;
    (void)ntp;
    return datetime_parse_format_impl;
}

/* --- registration --- */

void east_register_datetime_builtins(BuiltinRegistry *reg)
{
    builtin_registry_register(reg, "DateTimeAddMilliseconds", datetime_add_ms_factory);
    builtin_registry_register(reg, "DateTimeDurationMilliseconds", datetime_dur_ms_factory);
    builtin_registry_register(reg, "DateTimeGetYear", datetime_year_factory);
    builtin_registry_register(reg, "DateTimeGetMonth", datetime_month_factory);
    builtin_registry_register(reg, "DateTimeGetDayOfMonth", datetime_day_factory);
    builtin_registry_register(reg, "DateTimeGetHour", datetime_hour_factory);
    builtin_registry_register(reg, "DateTimeGetMinute", datetime_minute_factory);
    builtin_registry_register(reg, "DateTimeGetSecond", datetime_second_factory);
    builtin_registry_register(reg, "DateTimeGetMillisecond", datetime_ms_factory);
    builtin_registry_register(reg, "DateTimeGetDayOfWeek", datetime_dow_factory);
    builtin_registry_register(reg, "DateTimeToEpochMilliseconds", datetime_to_epoch_factory);
    builtin_registry_register(reg, "DateTimeFromEpochMilliseconds", datetime_from_epoch_factory);
    builtin_registry_register(reg, "DateTimeFromComponents", datetime_from_comp_factory);
    builtin_registry_register(reg, "DateTimePrintFormat", datetime_print_fmt_factory);
    builtin_registry_register(reg, "DateTimeParseFormat", datetime_parse_fmt_factory);
}
