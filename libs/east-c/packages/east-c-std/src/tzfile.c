/*
 * IANA TZif (zoneinfo) reader. See tzfile.h. Format per RFC 8536.
 */
#include "tzfile.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint32_t rd_u32(const unsigned char *p)
{
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}
static int32_t rd_i32(const unsigned char *p)
{
    return (int32_t)rd_u32(p);
}
static int64_t rd_i64(const unsigned char *p)
{
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) v = (v << 8) | p[i];
    return (int64_t)v;
}

/* The six 32-bit counts that follow a 44-byte TZif header. */
typedef struct {
    uint32_t isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt;
} tz_counts;

static int read_counts(const unsigned char *p, const unsigned char *end, tz_counts *c)
{
    if (p + 44 > end || memcmp(p, "TZif", 4) != 0) return -1;
    c->isutcnt = rd_u32(p + 20);
    c->isstdcnt = rd_u32(p + 24);
    c->leapcnt = rd_u32(p + 28);
    c->timecnt = rd_u32(p + 32);
    c->typecnt = rd_u32(p + 36);
    c->charcnt = rd_u32(p + 40);
    return 0;
}

/* Bytes occupied by the data block after a header, given the transition-time
 * width (4 for the v1 block, 8 for the v2/v3 block). */
static long block_size(tz_counts c, int timew)
{
    return (long)c.timecnt * timew + (long)c.timecnt + (long)c.typecnt * 6 + (long)c.charcnt +
           (long)c.leapcnt * (timew + 4) + (long)c.isstdcnt + (long)c.isutcnt;
}

/* Find the offset (seconds east of UTC) applicable at `epoch` in the block at
 * `blk`, whose transition times are `timew` bytes wide. */
static int lookup_in_block(const unsigned char *blk, const unsigned char *end, tz_counts c,
                           int timew, int64_t epoch, int32_t *out_utoff)
{
    const unsigned char *trans = blk;
    const unsigned char *types = trans + (long)c.timecnt * timew;
    const unsigned char *ttinfo = types + c.timecnt;
    if (c.typecnt == 0 || ttinfo + (long)c.typecnt * 6 > end) return -1;

    /* Last transition with time <= epoch (transitions are ascending). */
    int found = -1, lo = 0, hi = (int)c.timecnt - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        int64_t t = (timew == 8) ? rd_i64(trans + (long)mid * 8) : (int64_t)rd_i32(trans + (long)mid * 4);
        if (t <= epoch) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    int typeidx;
    if (found >= 0) {
        typeidx = types[found];
    } else {
        /* Before the first transition: use the first non-DST type (RFC 8536). */
        typeidx = 0;
        for (uint32_t i = 0; i < c.typecnt; i++) {
            if (ttinfo[i * 6 + 4] == 0) {
                typeidx = (int)i;
                break;
            }
        }
    }
    if (typeidx < 0 || (uint32_t)typeidx >= c.typecnt) return -1;
    *out_utoff = rd_i32(ttinfo + (long)typeidx * 6);
    return 0;
}

static int parse_offset(const unsigned char *buf, long sz, int64_t epoch, int64_t *out_minutes)
{
    const unsigned char *end = buf + sz;
    tz_counts c1;
    if (read_counts(buf, end, &c1)) return -1;

    char version = (char)buf[4];
    int32_t utoff;

    if (version == '2' || version == '3') {
        /* Prefer the 64-bit v2/v3 block that follows the v1 block. */
        long h2 = 44 + block_size(c1, 4);
        tz_counts c2;
        if (read_counts(buf + h2, end, &c2)) return -1;
        if (lookup_in_block(buf + h2 + 44, end, c2, 8, epoch, &utoff)) return -1;
    } else {
        if (lookup_in_block(buf + 44, end, c1, 4, epoch, &utoff)) return -1;
    }

    *out_minutes = utoff / 60;
    return 0;
}

int east_tzfile_offset_minutes(const char *zone_name, int64_t epoch_sec, int64_t *out_minutes)
{
    /* Reject absolute paths and traversal — the name indexes the tz tree only. */
    if (!zone_name || !*zone_name || zone_name[0] == '/' || strstr(zone_name, "..")) return -1;

    const char *base = getenv("TZDIR");
    if (!base || !*base) base = "/usr/share/zoneinfo";

    char path[1024];
    if (snprintf(path, sizeof(path), "%s/%s", base, zone_name) >= (int)sizeof(path)) return -1;

    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (sz < 44) {
        fclose(f);
        return -1;
    }
    unsigned char *buf = malloc((size_t)sz);
    if (!buf) {
        fclose(f);
        return -1;
    }
    int rc = -1;
    if (fread(buf, 1, (size_t)sz, f) == (size_t)sz) {
        rc = parse_offset(buf, sz, epoch_sec, out_minutes);
    }
    free(buf);
    fclose(f);
    return rc;
}
