/*
 * The stack guard on East calls (#948).
 *
 * East recursion runs on the C stack: every East call nests eval_ir frames.
 * A call nested too deeply used to overflow it and take the process down
 * (east-py's with it). Instead, an East call made with less than the headroom
 * left on its thread's stack is refused with EAST_CALL_DEPTH_MSG — the error
 * the TypeScript runtime raises for its own stack overflow — which a
 * program's try/catch can catch like any other.
 *
 * The bounds come from the thread itself (pthread_getattr_np, the Darwin
 * pthread_get_stack*_np pair, GetCurrentThreadStackLimits), read once per
 * thread. A call running on a stack outside those bounds — a fiber, a
 * greenlet — is never refused: the guard only acts on the stack it measured.
 */

#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE /* pthread_getattr_np */
#endif

#include <east/compat.h>

#include "east/compiler.h"

#include <stddef.h>
#include <stdint.h>

#if defined(__linux__) || defined(__APPLE__)
#include <pthread.h>
#endif

/* The stack an East call leaves free for what runs before the next call is
 * checked — the body's expression recursion, a builtin's frames, the error
 * path — capped at a quarter of a small stack. */
#define EAST_STACK_HEADROOM ((uintptr_t)256 * 1024)

static _Thread_local bool s_measured = false;
static _Thread_local uintptr_t s_low = 0;   /* the stack's lowest address; 0 = unknown */
static _Thread_local uintptr_t s_limit = 0; /* a call starting below this is refused */
static _Thread_local uintptr_t s_high = 0;  /* one past the stack's highest address */

/* This thread's stack as [*low, *high); false when the platform cannot say. */
static bool thread_stack(uintptr_t *low, uintptr_t *high)
{
#if defined(_WIN32)
    ULONG_PTR lo = 0, hi = 0;
    GetCurrentThreadStackLimits(&lo, &hi);
    *low = (uintptr_t)lo;
    *high = (uintptr_t)hi;
    return hi > lo;
#elif defined(__APPLE__)
    pthread_t self = pthread_self();
    uintptr_t top = (uintptr_t)pthread_get_stackaddr_np(self);
    size_t size = pthread_get_stacksize_np(self);
    *low = top - size;
    *high = top;
    return size > 0;
#elif defined(__linux__)
    pthread_attr_t attr;
    if (pthread_getattr_np(pthread_self(), &attr) != 0) return false;
    void *addr = NULL;
    size_t size = 0;
    int rc = pthread_attr_getstack(&attr, &addr, &size);
    pthread_attr_destroy(&attr);
    if (rc != 0 || size == 0) return false;
    *low = (uintptr_t)addr;
    *high = (uintptr_t)addr + size;
    return true;
#else
    (void)low;
    (void)high;
    return false;
#endif
}

/* Where on the machine stack this call is. The frame address, not a local's:
 * AddressSanitizer moves locals to a heap "fake stack", where a local's
 * address says nothing about the real stack's use. */
static inline uintptr_t current_frame(void)
{
#if defined(__GNUC__) || defined(__clang__)
    return (uintptr_t)__builtin_frame_address(0);
#elif defined(_MSC_VER)
    return (uintptr_t)_AddressOfReturnAddress();
#else
    volatile char probe = 0;
    return (uintptr_t)&probe;
#endif
}

bool east_stack_exhausted(void)
{
    if (!s_measured) {
        s_measured = true;
        uintptr_t low = 0, high = 0;
        if (thread_stack(&low, &high)) {
            uintptr_t size = high - low;
            uintptr_t headroom = size / 4 < EAST_STACK_HEADROOM ? size / 4 : EAST_STACK_HEADROOM;
            s_low = low;
            s_limit = low + headroom;
            s_high = high;
        }
    }
    if (!s_low) return false;
    uintptr_t sp = current_frame();
    return sp >= s_low && sp < s_limit && sp < s_high;
}
