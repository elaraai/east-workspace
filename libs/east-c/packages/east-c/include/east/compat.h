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

#include <time.h>
#include <stdint.h>

#ifdef _WIN32

#include <windows.h>
#include <bcrypt.h>
#include <direct.h>
#include <stdlib.h>
#include <string.h>
#include <io.h>
#include <psapi.h>

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

/* Run fn(arg) on a thread with a large reserved stack and return its result.
 * Deeply-recursive East programs overflow the main thread's link-time-fixed
 * stack; a created thread's stack can be far larger and is sized at runtime.
 * The reserve (MiB) is configurable via EAST_STACK_MB (default 512) — the
 * native analogue of Node's --stack-size. Reserved, not committed, so a large
 * value is cheap. Falls back to running inline if the thread can't be created. */
typedef struct {
    int (*fn)(void *);
    void *arg;
    int ret;
} east_stack_call;
static DWORD WINAPI east_stack_thunk(LPVOID p)
{
    east_stack_call *c = (east_stack_call *)p;
    c->ret = c->fn(c->arg);
    return 0;
}
static inline int east_run_on_large_stack(int (*fn)(void *), void *arg)
{
    SIZE_T reserve = (SIZE_T)512 << 20;
    const char *mb = getenv("EAST_STACK_MB");
    if (mb && *mb) {
        long v = atol(mb);
        if (v > 0) reserve = (SIZE_T)v << 20;
    }
    east_stack_call call = {fn, arg, 0};
    HANDLE th = CreateThread(NULL, reserve, east_stack_thunk, &call,
                             STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
    if (!th) return fn(arg);
    WaitForSingleObject(th, INFINITE);
    CloseHandle(th);
    return call.ret;
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

/* The POSIX main-thread stack (8 MiB, grows toward the rlimit) covers current
 * needs, so run inline. */
static inline int east_run_on_large_stack(int (*fn)(void *), void *arg)
{
    return fn(arg);
}

#endif /* _WIN32 */

#endif /* EAST_COMPAT_H */
