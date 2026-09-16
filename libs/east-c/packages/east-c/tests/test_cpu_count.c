/*
 * CPU-count gate (issue #763).
 *
 * east-c sizes its worker pools with east_cpu_count(), and the TypeScript
 * runtime sizes the same pools with Node's os.availableParallelism(). This
 * pins the rules that make the two agree: the affinity mask rather than every
 * online CPU, capped by the cgroup v2 CPU quota. The quota reader runs against
 * fabricated cgroup trees, so every case is deterministic on any host.
 */

#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE /* sched_getaffinity, sched_setaffinity, CPU_* */
#endif

#include <east/compat.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

#define CHECK(cond, ...)                                                                           \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);                                   \
            fprintf(stderr, __VA_ARGS__);                                                          \
            fprintf(stderr, "\n");                                                                 \
            failures++;                                                                            \
        }                                                                                          \
    } while (0)

#ifdef __linux__

#include <limits.h>
#include <sched.h>
#include <unistd.h>

/* Declared here: the reader is internal to src/cpu_count.c, and the tests get
 * only include/. */
long east_cgroup_cpu_quota_at(const char *proc_self_cgroup, const char *cgroup_mount);

/* mkdtemp's short path; small enough that joined paths cannot truncate. */
static char root[256];

/* Write `content` to `root`/`rel`, creating parent directories. */
static void put(const char *rel, const char *content)
{
    char path[PATH_MAX];
    snprintf(path, sizeof path, "%s/%s", root, rel);
    for (char *p = path + strlen(root) + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            east_mkdir(path);
            *p = '/';
        }
    }
    FILE *f = fopen(path, "w");
    if (!f) {
        CHECK(false, "cannot write %s", path);
        return;
    }
    fputs(content, f);
    fclose(f);
}

/* The quota a fabricated tree reports: `self` is /proc/self/cgroup's content,
 * the tree's files already written under `case_dir`/fs. */
static long quota_of(const char *case_dir, const char *self)
{
    char rel[PATH_MAX];
    snprintf(rel, sizeof rel, "%s/self", case_dir);
    put(rel, self);
    char self_path[PATH_MAX];
    char mount[PATH_MAX];
    snprintf(self_path, sizeof self_path, "%s/%s/self", root, case_dir);
    snprintf(mount, sizeof mount, "%s/%s/fs", root, case_dir);
    return east_cgroup_cpu_quota_at(self_path, mount);
}

static void test_quota_reader(void)
{
    /* One limit on the process's own cgroup. */
    put("single/fs/app.slice/run.scope/cpu.max", "200000 100000\n");
    CHECK(quota_of("single", "0::/app.slice/run.scope\n") == 2, "a 2-CPU limit reads 2");

    /* Nested: the TIGHTEST limit wins — a container under a looser pod. */
    put("nested/fs/pod.slice/cpu.max", "800000 100000\n");
    put("nested/fs/pod.slice/container.scope/cpu.max", "300000 100000\n");
    CHECK(quota_of("nested", "0::/pod.slice/container.scope\n") == 3,
          "a 3-CPU container under an 8-CPU pod reads 3");
    put("looser/fs/pod.slice/cpu.max", "200000 100000\n");
    put("looser/fs/pod.slice/container.scope/cpu.max", "max 100000\n");
    CHECK(quota_of("looser", "0::/pod.slice/container.scope\n") == 2,
          "an unlimited container under a 2-CPU pod reads 2");

    /* Whole CPUs, floored, never below one. */
    put("fraction/fs/job/cpu.max", "150000 100000\n");
    CHECK(quota_of("fraction", "0::/job\n") == 1, "1.5 CPUs reads 1");
    put("half/fs/job/cpu.max", "50000 100000\n");
    CHECK(quota_of("half", "0::/job\n") == 1, "half a CPU reads 1, not unlimited");

    /* No limit anywhere, a limit at the mount root itself, and the root cgroup. */
    put("unlimited/fs/job/cpu.max", "max 100000\n");
    CHECK(quota_of("unlimited", "0::/job\n") == 0, "\"max\" is no limit");
    put("rootlimit/fs/cpu.max", "400000 100000\n");
    put("rootlimit/fs/a/b/.keep", "");
    CHECK(quota_of("rootlimit", "0::/a/b\n") == 4, "a limit at the mount root applies");
    put("rootgroup/fs/cpu.max", "500000 100000\n");
    CHECK(quota_of("rootgroup", "0::/\n") == 5, "the root cgroup reads the mount's cpu.max");

    /* Not the unified hierarchy (cgroup v1), malformed and missing files. */
    put("v1/fs/job/cpu.max", "100000 100000\n");
    CHECK(quota_of("v1", "4:cpu,cpuacct:/job\n") == 0, "cgroup v1 is not read");
    put("garbage/fs/job/cpu.max", "not a quota\n");
    CHECK(quota_of("garbage", "0::/job\n") == 0, "a malformed cpu.max is ignored");
    put("zero/fs/job/cpu.max", "100000 0\n");
    CHECK(quota_of("zero", "0::/job\n") == 0, "a zero period is ignored");
    CHECK(east_cgroup_cpu_quota_at("/nonexistent/self", "/nonexistent") == 0,
          "an unreadable /proc/self/cgroup is no limit");
}

static void test_affinity(void)
{
    cpu_set_t original;
    CPU_ZERO(&original);
    if (sched_getaffinity(0, sizeof original, &original) != 0) {
        printf("  (affinity unavailable; skipped)\n");
        return;
    }
    int allowed = CPU_COUNT(&original);
    int counted = east_cpu_count();
    CHECK(counted >= 1 && counted <= allowed, "counts %d of %d allowed CPUs", counted, allowed);

    int first = -1;
    for (int i = 0; i < CPU_SETSIZE && first < 0; i++)
        if (CPU_ISSET(i, &original)) first = i;
    cpu_set_t one;
    CPU_ZERO(&one);
    CPU_SET(first, &one);
    if (sched_setaffinity(0, sizeof one, &one) == 0) {
        CHECK(east_cpu_count() == 1, "pinned to one CPU, counts %d", east_cpu_count());
        sched_setaffinity(0, sizeof original, &original);
    }
}

#endif /* __linux__ */

int main(void)
{
    CHECK(east_cpu_count() >= 1, "at least one CPU");

#ifdef __linux__
    char tmpl[] = "/tmp/east-cpu-count-XXXXXX";
    char *dir = mkdtemp(tmpl);
    if (!dir) {
        fprintf(stderr, "cannot create a temp dir\n");
        return 1;
    }
    snprintf(root, sizeof root, "%s", dir);
    test_quota_reader();
    test_affinity();
    char cleanup[PATH_MAX + 16];
    snprintf(cleanup, sizeof cleanup, "rm -rf '%s'", root);
    if (system(cleanup) != 0) fprintf(stderr, "warning: could not remove %s\n", root);
#endif

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("cpu count gate: all checks passed (%d CPUs)\n", east_cpu_count());
    return 0;
}
