/*
 * The stack guard's budget (#986).
 *
 * east_stack_exhausted refuses an East call made with less than its headroom
 * left, and on a stack larger than EAST_STACK_BUDGET, one made beyond what an
 * 8 MiB stack allows (src/stack_guard.c): a runaway recursion is refused at
 * the same depth on every platform. Before the budget, the 1 GiB stack
 * east-c's Windows executables reserve let one run a gigabyte deep, and the
 * compliance suite's runaway-recursion case took 17 minutes there.
 *
 * The probe below recurses as East calls do, a frame of fixed size between
 * checks, until the guard refuses, and measures the stack it used. On POSIX it
 * runs on an 8 MiB thread and on a 256 MiB one; on Windows on the main thread,
 * whose 1 GiB reserve the link gives every executable (a thread's runtime
 * reservation is not honoured reliably there, compat.h).
 */

#include <east/compat.h>

#include <east/compiler.h>

#include <stdint.h>
#include <stdio.h>

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

/* The stack between two checks: about what an East call's frames take. */
#define PROBE_FRAME 1024

#if defined(_MSC_VER)
#define PROBE_NOINLINE __declspec(noinline)
#else
#define PROBE_NOINLINE __attribute__((noinline))
#endif

/* Where on the machine stack the calling frame is, read as the guard reads it. */
#if defined(__GNUC__) || defined(__clang__)
#define FRAME_ADDRESS() ((uintptr_t)__builtin_frame_address(0))
#else
#define FRAME_ADDRESS() ((uintptr_t)_AddressOfReturnAddress())
#endif

/* Recurses until the guard refuses, and gives the frame it refused at. */
static PROBE_NOINLINE uintptr_t probe(unsigned level)
{
    volatile char frame[PROBE_FRAME];
    frame[0] = (char)level;
    if (east_stack_exhausted()) return FRAME_ADDRESS();
    uintptr_t refused = probe(level + 1);
    /* The frame stays live across the call, so the call is no tail call. */
    frame[PROBE_FRAME - 1] = frame[0];
    return refused;
}

/* The stack the probe used before the guard refused it. */
static PROBE_NOINLINE uintptr_t stack_used(void)
{
    uintptr_t start = FRAME_ADDRESS();
    return start - probe(0);
}

#ifndef _WIN32

typedef struct {
    uintptr_t used;
} Probe;

static void *run_probe(void *arg)
{
    ((Probe *)arg)->used = stack_used();
    return NULL;
}

/* The stack the probe uses on a thread with a stack of `size` bytes. */
static uintptr_t used_on(size_t size)
{
    Probe p = {0};
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setstacksize(&attr, size);
    pthread_t t;
    if (pthread_create(&t, &attr, run_probe, &p) != 0) {
        CHECK(false, "cannot start a thread with a %zu-byte stack", size);
    } else {
        pthread_join(t, NULL);
    }
    pthread_attr_destroy(&attr);
    return p.used;
}

#endif

int main(void)
{
    const uintptr_t budget = (uintptr_t)EAST_STACK_BUDGET;

#ifdef _WIN32
    /* The main thread: the link's 1 GiB reserve. */
    uintptr_t large = stack_used();
    CHECK(large <= budget,
          "the 1 GiB main thread gave East calls %zu bytes, past the %zu-byte budget",
          (size_t)large, (size_t)budget);
    CHECK(large >= budget / 2, "the 1 GiB main thread gave East calls only %zu bytes",
          (size_t)large);
    printf("stack guard gate: a 1 GiB stack gives East calls %zu bytes (budget %zu)\n",
           (size_t)large, (size_t)budget);
#else
    const size_t mib = (size_t)1024 * 1024;
    uintptr_t eight = used_on(8 * mib);
    uintptr_t large = used_on(256 * mib);
    CHECK(eight >= budget / 2, "an 8 MiB stack gave East calls only %zu bytes", (size_t)eight);
    CHECK(large <= budget, "a 256 MiB stack gave East calls %zu bytes, past the %zu-byte budget",
          (size_t)large, (size_t)budget);
    /* The same depth as on an 8 MiB stack: within a few frames, the difference
     * being what the thread keeps at its top. */
    uintptr_t apart = large > eight ? large - eight : eight - large;
    CHECK(apart <= (uintptr_t)16 * PROBE_FRAME,
          "a 256 MiB stack gave East calls %zu bytes, an 8 MiB one %zu", (size_t)large,
          (size_t)eight);
    printf("stack guard gate: 8 MiB and 256 MiB stacks give East calls %zu and %zu bytes (budget "
           "%zu)\n",
           (size_t)eight, (size_t)large, (size_t)budget);
#endif

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    return 0;
}
