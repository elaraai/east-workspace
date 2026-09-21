/*
 * The cgroup v2 CPU quota that caps east_cpu_count() (issue #763).
 *
 * This lives in its own translation unit deliberately. cpu_count.c must define
 * _GNU_SOURCE for sched_getaffinity()/CPU_COUNT(), and _GNU_SOURCE turns on
 * _ISOC2X_SOURCE: from glibc 2.38 on, that redirects sscanf() to
 * __isoc23_sscanf@GLIBC_2.38, which raises the minimum glibc of the WHOLE
 * linked binary to 2.38. east-c's Linux binaries are built on the CI image and
 * have to run on older ones — the published Docker tier is node:22-slim, i.e.
 * Debian bookworm at glibc 2.36 — so the scanf/strtol family has to stay out
 * of every _GNU_SOURCE unit. Parsing cpu.max next to the affinity call is what
 * shipped v1.0.77 and v1.0.78 with no Docker images at all; the floor is now
 * held by scripts/check-glibc-floor.mjs.
 */

#ifdef __linux__

#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

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

#else /* !__linux__ */

/* cgroups are Linux-only, and -Wpedantic rejects an empty translation unit. */
typedef int east_cgroup_quota_linux_only;

#endif /* __linux__ */
