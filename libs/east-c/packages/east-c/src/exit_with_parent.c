/*
 * Exit with the parent (issue #770) — see east_exit_with_parent in
 * include/east/east.h.
 *
 * A parent that must not leave its runner behind when it dies without warning
 * — e3's orchestrator under a V8 abort or `kill -9`, with no chance to stop
 * the process group — spawns the runner with a stdin pipe it never writes to
 * and EAST_EXIT_WITH_PARENT=1. The pipe's write end lives exactly as long as
 * the parent, so a read of stdin blocks until the parent is gone and then
 * returns end of file; the watcher ends the process there. It only reads a
 * file descriptor and exits: it touches no East value and allocates nothing,
 * so the runtime's single-thread contract holds.
 */

#include <east/compat.h>
#include <east/east.h>

#include <stdlib.h>
#include <string.h>

#ifndef _WIN32
#include <errno.h>
#include <poll.h>
#include <unistd.h>
#endif

/* Blocks reading stdin one byte at a time, discarding what it reads, and ends
 * the process with _exit(1) once a read returns end of file or an error. */
static EAST_THREAD_ENTRY exit_with_parent_watch(void *arg)
{
    (void)arg;
    char byte;
#ifdef _WIN32
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    DWORD n = 1;
    while (n == 1 && in != NULL && in != INVALID_HANDLE_VALUE) {
        if (!ReadFile(in, &byte, 1, &n, NULL)) break;
    }
#else
    for (;;) {
        ssize_t n = read(0, &byte, 1);
        if (n == 1) continue;
        if (n < 0 && errno == EINTR) continue;
        /* A stdin opened non-blocking: wait for data or the hang-up, then
         * read again. */
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct pollfd fd = {.fd = 0, .events = POLLIN};
            if (poll(&fd, 1, -1) >= 0 || errno == EINTR) continue;
        }
        break; /* end of file, or an error */
    }
#endif
    _exit(1);
    return EAST_THREAD_DONE;
}

void east_exit_with_parent(void)
{
    const char *flag = getenv("EAST_EXIT_WITH_PARENT");
    if (!flag || strcmp(flag, "1") != 0) return;
    EastThread watcher;
    if (east_thread_start(&watcher, exit_with_parent_watch, NULL)) east_thread_detach(watcher);
}
