/*
 * Cross-platform compatibility shims.
 *
 * east-c is written against POSIX (gmtime_r, timegm, mkdir(path, mode),
 * clock_gettime, setenv, struct tm.tm_gmtoff). MinGW/Windows lacks several of
 * these, so this header provides equivalents under _WIN32 and thin pass-throughs
 * elsewhere. Include it wherever those APIs are used.
 */
#ifndef EAST_COMPAT_H
#define EAST_COMPAT_H

#ifdef _WIN32
/* Use the POSIX CRT names (strdup, etc.) without C4996 deprecation noise.
 * Must precede any CRT header include (this header is force-included first on
 * Windows via /FI from the east-c CMakeLists). */
#ifndef _CRT_NONSTDC_NO_WARNINGS
#define _CRT_NONSTDC_NO_WARNINGS
#endif
#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS
#endif
#endif

#include <time.h>
#include <stdint.h>

/* printf-style format checking: kept on GCC/Clang, compiled out on MSVC. */
#if defined(__GNUC__) || defined(__clang__)
#define EAST_PRINTF_FMT(fmt_idx, va_idx) __attribute__((format(printf, fmt_idx, va_idx)))
#else
#define EAST_PRINTF_FMT(fmt_idx, va_idx)
#endif

#ifdef _WIN32

#include <windows.h>
#include <bcrypt.h>
#include <direct.h>
#include <stdlib.h>
#include <string.h>
#include <io.h>
#include <psapi.h>
#include <intrin.h> /* _InterlockedExchangeAdd, _umul128 */

/* GNU thread-local storage keyword -> MSVC. */
#define __thread __declspec(thread)

/* GCC/Clang atomic builtins (used for `int` ref_count inc/dec). MSVC has none;
 * map the two we use to Interlocked ops. ref_count is 32-bit `int`, so the
 * `long` Interlocked variant matches. _Interlocked* are full barriers, so the
 * memory-order argument is ignored. __atomic_{add,sub}_fetch return the NEW
 * value, while _InterlockedExchangeAdd returns the OLD (hence the +/- val). */
#define __ATOMIC_RELAXED 0
#define __ATOMIC_CONSUME 1
#define __ATOMIC_ACQUIRE 2
#define __ATOMIC_RELEASE 3
#define __ATOMIC_ACQ_REL 4
#define __ATOMIC_SEQ_CST 5
#define __atomic_add_fetch(ptr, val, mo)                                                           \
    (_InterlockedExchangeAdd((volatile long *)(ptr), (long)(val)) + (long)(val))
#define __atomic_sub_fetch(ptr, val, mo)                                                           \
    (_InterlockedExchangeAdd((volatile long *)(ptr), -(long)(val)) - (long)(val))
/* 8-bit load/store (used for the uint8_t EastType::gc_can_cycle memo). The
 * GCC builtins are polymorphic; these mappings are 8-bit only — widen them
 * before using __atomic_load_n/__atomic_store_n on any other width. */
#define __atomic_load_n(ptr, mo) ((unsigned char)_InterlockedOr8((volatile char *)(ptr), 0))
#define __atomic_store_n(ptr, val, mo)                                                             \
    ((void)_InterlockedExchange8((volatile char *)(ptr), (char)(val)))

/* Reentrant time conversions. MinGW does not declare gmtime_r/localtime_r;
 * gmtime/localtime use a static buffer (fine for east-c's single-threaded CLI
 * use), so copy out into the caller's struct. */
static inline struct tm *east_gmtime_r(const time_t *t, struct tm *out)
{
    struct tm *p = gmtime(t);
    if (!p) return NULL;
    *out = *p;
    return out;
}
static inline struct tm *east_localtime_r(const time_t *t, struct tm *out)
{
    struct tm *p = localtime(t);
    if (!p) return NULL;
    *out = *p;
    return out;
}
#define gmtime_r(t, out) east_gmtime_r((t), (out))
#define localtime_r(t, out) east_localtime_r((t), (out))

/* timegm -> MSVCRT _mkgmtime */
#define timegm _mkgmtime

/* setenv/unsetenv via _putenv_s */
static inline int east_setenv(const char *name, const char *value, int overwrite)
{
    (void)overwrite;
    return _putenv_s(name, value);
}
static inline int east_unsetenv(const char *name)
{
    return _putenv_s(name, "");
}
#define setenv(n, v, o) east_setenv((n), (v), (o))
#define unsetenv(n) east_unsetenv((n))

/* mkdir: POSIX 2-arg -> Windows 1-arg */
#define east_mkdir(path) _mkdir(path)

/* mkdtemp: fill the trailing XXXXXX with a unique name, then create the dir.
 * (Caller's template must be writable, ending in "XXXXXX".) */
static inline char *east_mkdtemp(char *tmpl)
{
    if (_mktemp_s(tmpl, strlen(tmpl) + 1) != 0) return NULL;
    if (_mkdir(tmpl) != 0) return NULL;
    return tmpl;
}
#define mkdtemp(tmpl) east_mkdtemp(tmpl)

/* Wall-clock milliseconds since the Unix epoch (replaces clock_gettime). */
static inline int64_t east_realtime_millis(void)
{
    FILETIME ft;
    GetSystemTimePreciseAsFileTime(&ft);
    uint64_t ticks = ((uint64_t)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    /* FILETIME is 100ns ticks since 1601-01-01; shift to the 1970 epoch. */
    ticks -= 11644473600ULL * 10000000ULL;
    return (int64_t)(ticks / 10000ULL);
}

/* Peak resident set size in KB (replaces getrusage RUSAGE_SELF ru_maxrss). */
static inline long east_peak_rss_kb(void)
{
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc)))
        return (long)(pmc.PeakWorkingSetSize / 1024);
    return 0;
}

/* A fault on Windows otherwise blocks on the Windows Error Reporting dialog,
 * which hangs headless CI indefinitely. Suppress the dialogs so a crash
 * terminates the process immediately (non-zero exit) and failures surface fast.
 * (_set_abort_behavior would also help but isn't in MinGW's msvcrt import lib.) */
static inline void east_init_crash_handling(void)
{
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);
}

/* Cryptographically-strong random bytes. Windows has no /dev/urandom, so use
 * the system RNG. Returns 0 on success, -1 on failure. */
static inline int east_random_bytes(void *buf, size_t len)
{
    return BCRYPT_SUCCESS(
               BCryptGenRandom(NULL, (PUCHAR)buf, (ULONG)len, BCRYPT_USE_SYSTEM_PREFERRED_RNG))
               ? 0
               : -1;
}

/* ================================================================== */
/*  POSIX shims for east-c-std + CLI. MinGW backfilled these; MSVC does */
/*  not. This header is force-included into every east-c/std/cli TU on  */
/*  Windows (see /FI in the east-c CMakeLists), so the mappings apply    */
/*  runtime-wide. Paths are treated as ANSI (UTF-8-as-ANSI), matching    */
/*  the fopen() usage elsewhere in east-c-std; full Unicode paths would  */
/*  require the *W APIs and UTF-8<->UTF-16 conversion.                   */
/* ================================================================== */

#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>

/* <limits.h> on MSVC has no PATH_MAX. */
#ifndef PATH_MAX
#define PATH_MAX MAX_PATH
#endif

/* MSVC <sys/stat.h> provides struct stat / stat() but not the S_IS* macros. */
#ifndef S_ISREG
#define S_ISREG(m) (((m) & _S_IFMT) == _S_IFREG)
#endif
#ifndef S_ISDIR
#define S_ISDIR(m) (((m) & _S_IFMT) == _S_IFDIR)
#endif

/* POSIX names -> MSVCRT equivalents (declared in <io.h>/<direct.h> included
 * above, so these macros must follow those includes). */
#define unlink(p) _unlink(p)
#define rmdir(p) _rmdir(p)
#define getcwd(b, n) _getcwd((b), (int)(n))

/* ssize_t -> Win32 SSIZE_T (BaseTsd.h, via <windows.h>). */
#ifndef _SSIZE_T_DEFINED
#define _SSIZE_T_DEFINED
typedef SSIZE_T ssize_t;
#endif

/* usleep -> Sleep (millisecond granularity is sufficient for time.sleep). */
typedef unsigned long useconds_t;
static inline int east_usleep(useconds_t usec)
{
    Sleep((DWORD)(usec / 1000));
    return 0;
}
#define usleep(us) east_usleep((useconds_t)(us))

/* clock_gettime: MSVC's <time.h> declares struct timespec (C11) but not
 * clock_gettime / CLOCK_*. MONOTONIC -> QueryPerformanceCounter,
 * REALTIME -> GetSystemTimePreciseAsFileTime. */
#ifndef CLOCK_REALTIME
#define CLOCK_REALTIME 0
#endif
#ifndef CLOCK_MONOTONIC
#define CLOCK_MONOTONIC 1
#endif
static inline int east_clock_gettime(int clk, struct timespec *ts)
{
    if (clk == CLOCK_MONOTONIC) {
        LARGE_INTEGER freq, ctr;
        QueryPerformanceFrequency(&freq);
        QueryPerformanceCounter(&ctr);
        ts->tv_sec = (time_t)(ctr.QuadPart / freq.QuadPart);
        ts->tv_nsec = (long)(((ctr.QuadPart % freq.QuadPart) * 1000000000LL) / freq.QuadPart);
    } else {
        FILETIME ft;
        GetSystemTimePreciseAsFileTime(&ft);
        uint64_t t = ((uint64_t)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
        t -= 11644473600ULL * 10000000ULL; /* 100ns ticks: 1601 -> 1970 epoch */
        ts->tv_sec = (time_t)(t / 10000000ULL);
        ts->tv_nsec = (long)((t % 10000000ULL) * 100);
    }
    return 0;
}
#define clock_gettime(clk, ts) east_clock_gettime((clk), (ts))

/* dirent shim over FindFirstFileA/FindNextFileA. Callers only read d_name. */
struct dirent {
    char d_name[MAX_PATH];
};
typedef struct east_DIR {
    HANDLE handle;
    WIN32_FIND_DATAA find;
    int first;
    struct dirent entry;
} east_DIR;
#define DIR east_DIR
static inline east_DIR *opendir(const char *path)
{
    east_DIR *d = (east_DIR *)calloc(1, sizeof(east_DIR));
    if (!d) return NULL;
    size_t plen = strlen(path);
    int has_sep = (plen > 0 && (path[plen - 1] == '/' || path[plen - 1] == '\\'));
    char pattern[MAX_PATH];
    int n = snprintf(pattern, sizeof(pattern), "%s%s*", path, has_sep ? "" : "\\");
    if (n < 0 || n >= (int)sizeof(pattern)) {
        free(d);
        return NULL;
    }
    d->handle = FindFirstFileA(pattern, &d->find);
    if (d->handle == INVALID_HANDLE_VALUE) {
        free(d);
        return NULL;
    }
    d->first = 1;
    return d;
}
static inline struct dirent *readdir(east_DIR *d)
{
    if (!d) return NULL;
    if (!d->first && !FindNextFileA(d->handle, &d->find)) return NULL;
    d->first = 0;
    snprintf(d->entry.d_name, sizeof(d->entry.d_name), "%s", d->find.cFileName);
    return &d->entry;
}
static inline int closedir(east_DIR *d)
{
    if (!d) return -1;
    if (d->handle != INVALID_HANDLE_VALUE) FindClose(d->handle);
    free(d);
    return 0;
}

#else /* !_WIN32 */

#include <stdio.h>

#include <sys/stat.h>
#include <sys/resource.h>
#define east_mkdir(path) mkdir((path), 0755)

static inline int64_t east_realtime_millis(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (int64_t)ts.tv_sec * 1000 + (int64_t)ts.tv_nsec / 1000000;
}

static inline long east_peak_rss_kb(void)
{
    struct rusage usage;
    getrusage(RUSAGE_SELF, &usage);
    return usage.ru_maxrss;
}

static inline void east_init_crash_handling(void) {}

/* Cryptographically-strong random bytes from /dev/urandom. Returns 0 on
 * success, -1 on failure. */
static inline int east_random_bytes(void *buf, size_t len)
{
    FILE *f = fopen("/dev/urandom", "rb");
    if (!f) return -1;
    size_t n = fread(buf, 1, len, f);
    fclose(f);
    return (n == len) ? 0 : -1;
}

#endif /* _WIN32 */

/* Run the program entry point. East evaluation can recurse deeply, so the
 * binary is linked with a large stack reserve (see -Wl,--stack in the east-c
 * CMakeLists); this simply invokes fn on that stack. A worker-thread variant
 * for runtime stack sizing was dropped: Windows did not honor the thread stack
 * reservation reliably, and the link-time reserve is the dependable mechanism. */
static inline int east_run_on_large_stack(int (*fn)(void *), void *arg)
{
    return fn(arg);
}

#endif /* EAST_COMPAT_H */
