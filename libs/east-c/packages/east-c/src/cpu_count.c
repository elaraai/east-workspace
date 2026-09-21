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

#include <unistd.h>

#ifdef __linux__
#include <sched.h>

/* Defined in cgroup_quota.c, which is deliberately NOT a _GNU_SOURCE unit:
 * the sscanf() it needs would bind to __isoc23_sscanf@GLIBC_2.38 here and lift
 * the whole binary's glibc floor above the Docker tier's. See its header. */
long east_cgroup_cpu_quota_at(const char *proc_self_cgroup, const char *cgroup_mount);

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
