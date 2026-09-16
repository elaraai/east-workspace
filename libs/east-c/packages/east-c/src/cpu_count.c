/*
 * How many CPUs this process may use — the size of east-c's worker pools.
 *
 * The TypeScript runtime sizes the same pools from Node's
 * `os.availableParallelism()`, which is libuv's `uv_available_parallelism()`.
 * This is that count, so a writer pools the same number of threads whichever
 * runtime it runs on (issue #763):
 *
 *   - the scheduler affinity mask (`taskset`, `docker --cpuset-cpus`, a
 *     process pinned by its parent) rather than every online CPU;
 *   - on Linux, capped by the cgroup v2 CPU quota (`docker --cpus`, a
 *     Kubernetes CPU limit), in whole CPUs;
 *   - on Windows, the process affinity mask;
 *   - at least 1.
 *
 * Two deliberate differences from libuv 1.51/1.52: a quota below one CPU caps
 * the count at 1 (libuv's integer division turns it into "no quota" and
 * reports every CPU), and the TIGHTEST quota along the cgroup hierarchy wins
 * (libuv keeps the outermost one it reads, so a container limit under a looser
 * pod limit reports the pod's). With a single limit, the usual case, the two
 * counts agree. cgroup v1 quotas are not read, as libuv's v1 path does not
 * resolve on common layouts either.
 */

#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE /* sched_getaffinity, CPU_COUNT */
#endif

#include <east/compat.h>

#ifdef _WIN32

int east_cpu_count(void)
{
    DWORD_PTR process_mask;
    DWORD_PTR system_mask;
    int count = 0;
    if (GetProcessAffinityMask(GetCurrentProcess(), &process_mask, &system_mask)) {
        for (; process_mask != 0; process_mask &= process_mask - 1)
            count++;
    }
    return count > 0 ? count : 1;
}

#else /* !_WIN32 */

#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifdef __linux__
#include <sched.h>

/* The tightest cgroup v2 CPU quota, in whole CPUs (at least 1), over the
 * cgroup `proc_self_cgroup` names and each of its ancestors under
 * `cgroup_mount`; 0 when none of them sets one. The paths are parameters so the
 * test can point this at a fabricated tree; production passes
 * /proc/self/cgroup and /sys/fs/cgroup. */
long east_cgroup_cpu_quota_at(const char *proc_self_cgroup, const char *cgroup_mount)
{
    char line[PATH_MAX];
    FILE *self = fopen(proc_self_cgroup, "r");
    if (!self) return 0;
    bool read = fgets(line, sizeof line, self) != NULL;
    fclose(self);
    /* The unified hierarchy is the single entry "0::/<path>". */
    if (!read || strncmp(line, "0::/", 4) != 0) return 0;
    line[strcspn(line, "\n")] = '\0';

    char dir[PATH_MAX];
    int written = snprintf(dir, sizeof dir, "%s%s", cgroup_mount, line + 3);
    if (written < 0 || (size_t)written >= sizeof dir) return 0;
    size_t mount_len = strlen(cgroup_mount);

    long tightest = 0;
    for (;;) {
        size_t len = strlen(dir);
        while (len > mount_len && dir[len - 1] == '/')
            dir[--len] = '\0';

        char file[PATH_MAX];
        written = snprintf(file, sizeof file, "%s/cpu.max", dir);
        if (written > 0 && (size_t)written < sizeof file) {
            FILE *max = fopen(file, "r");
            if (max) {
                char buf[64];
                long long quota = 0;
                long long period = 0;
                /* "max <period>" is no limit; "<quota> <period>" is quota/period CPUs. */
                if (fgets(buf, sizeof buf, max) && strncmp(buf, "max", 3) != 0 &&
                    sscanf(buf, "%lld %lld", &quota, &period) == 2 && quota > 0 && period > 0) {
                    long cpus = (long)(quota / period);
                    if (cpus < 1) cpus = 1;
                    if (tightest == 0 || cpus < tightest) tightest = cpus;
                }
                fclose(max);
            }
        }

        if (len <= mount_len) break;
        char *slash = strrchr(dir + mount_len, '/');
        if (!slash) break;
        *slash = '\0';
    }
    return tightest;
}
#endif /* __linux__ */

int east_cpu_count(void)
{
    long count = -1;
#ifdef __linux__
    cpu_set_t set;
    CPU_ZERO(&set);
    if (sched_getaffinity(0, sizeof set, &set) == 0) count = CPU_COUNT(&set);
#endif
    if (count < 1) count = sysconf(_SC_NPROCESSORS_ONLN);
#ifdef __linux__
    long quota = east_cgroup_cpu_quota_at("/proc/self/cgroup", "/sys/fs/cgroup");
    if (quota > 0 && quota < count) count = quota;
#endif
    return count > 0 ? (int)count : 1;
}

#endif /* _WIN32 */
