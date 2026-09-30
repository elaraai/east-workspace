/*
 * This process's resident memory now — what a runner's verbose account of an
 * input decoded whole reads its growth from, before and after the decode
 * (issue #1033): a task's inputs decode at many times their stored size, and
 * the peak alone does not say which input it went to.
 *
 * Deliberately not a _GNU_SOURCE unit, and it parses /proc by hand: the
 * scanf/strtol family in a _GNU_SOURCE unit raises the whole binary's glibc
 * floor (see cgroup_quota.c).
 */

#include <east/compat.h>

#if defined(_WIN32)

/* windows.h and psapi.h come in with compat.h, for east_peak_rss_kb. */
long east_resident_kb(void)
{
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc)))
        return (long)(pmc.WorkingSetSize / 1024);
    return 0;
}

#elif defined(__APPLE__)

#include <mach/mach.h>

long east_resident_kb(void)
{
    mach_task_basic_info_data_t info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) !=
        KERN_SUCCESS)
        return 0;
    return (long)(info.resident_size / 1024);
}

#elif defined(__linux__)

#include <stdio.h>
#include <unistd.h>

/* /proc/self/statm holds "size resident shared text lib data dt", in pages:
 * the second field, by the page size. */
long east_resident_kb(void)
{
    FILE *statm = fopen("/proc/self/statm", "r");
    if (!statm) return 0;
    char buf[128];
    size_t n = fread(buf, 1, sizeof buf - 1, statm);
    fclose(statm);
    buf[n] = '\0';
    const char *p = buf;
    while (*p >= '0' && *p <= '9')
        p++;
    while (*p == ' ')
        p++;
    unsigned long long pages = 0;
    while (*p >= '0' && *p <= '9')
        pages = pages * 10 + (unsigned long long)(*p++ - '0');
    long page = sysconf(_SC_PAGESIZE);
    return page > 0 ? (long)(pages * (unsigned long long)page / 1024) : 0;
}

#else

long east_resident_kb(void)
{
    return 0;
}

#endif
