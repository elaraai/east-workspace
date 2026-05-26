/*
 * Parallel platform functions for East.
 *
 * parallel_map uses fork() rather than pthreads. The east-c runtime is NOT
 * thread-safe — refcounts on EastValue/EastType/PlatformRegistry are plain
 * (non-atomic) increments, and several globals are lazily initialised without
 * locks. Threads sharing those values race and corrupt the heap.
 *
 * fork() gives each worker its own address space (copy-on-write), so the
 * runtime remains effectively single-threaded inside each worker.
 *
 * IPC: each worker writes its result back to the parent over a pipe with the
 * wire format below. Beast2 (full mode) is used both for the per-chunk input
 * (so the parent's heap state isn't observed mid-mutation by the COW child)
 * and for the result. The "value-only" beast2 API can't roundtrip arrays or
 * functions, so all encode/decode here uses east_beast2_encode_full /
 * east_beast2_decode_auto.
 *
 * Wire format (per worker → parent):
 *   [1 byte status]   0 = OK, 1 = error
 *   [4 byte len LE]   payload length
 *   [len bytes]       OK: encoded result array (beast2 full).
 *                      error: UTF-8 message.
 *
 * Caveat: fork() in a multi-threaded host process replicates only the calling
 * thread; other threads' mutexes etc are left in undefined states in the
 * child. east-c-std callers (CLI, compliance runner) are single-threaded so
 * this is fine. If parallel_map is ever invoked from a multi-threaded host,
 * a thread-safe runtime will be required (atomic refcounts, init guards).
 */

#include "east_std/east_std.h"
#include <east/values.h>
#include <east/eval_result.h>
#include <east/types.h>
#include <east/compiler.h>
#include <east/serialization.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#ifndef _WIN32
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>
#endif

static _Thread_local EastType *s_input_type = NULL;
static _Thread_local EastType *s_result_type = NULL;
static EvalResult parallel_map_impl(EastValue **args, size_t num_args, EastType **input_types,
                                    size_t num_input_types, EastType *output_type);

PlatformFn east_std_parallel_map_factory(EastType **tp, size_t num_tp)
{
    /* tp[0] = T (input element type), tp[1] = R (output element type) */
    if (num_tp >= 2) {
        s_input_type = tp[0];
        s_result_type = tp[1];
    }
    return parallel_map_impl;
}

#ifndef _WIN32 /* fork-based worker machinery; Windows uses the serial path */

/* ================================================================== */
/*  IPC helpers                                                        */
/* ================================================================== */

static int write_all(int fd, const void *buf, size_t len)
{
    const uint8_t *p = (const uint8_t *)buf;
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, p + off, len - off);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (n == 0) return -1;
        off += (size_t)n;
    }
    return 0;
}

static int read_all(int fd, void *buf, size_t len)
{
    uint8_t *p = (uint8_t *)buf;
    size_t off = 0;
    while (off < len) {
        ssize_t n = read(fd, p + off, len - off);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (n == 0) return -1; /* eof before len bytes */
        off += (size_t)n;
    }
    return 0;
}

/* Send [status:1][len:4][payload:len] to the parent and exit the child.
 * Always _exit() — never returns to caller. */
static void child_send_and_exit(int write_fd, uint8_t status, const uint8_t *payload, size_t len)
{
    uint32_t plen = (uint32_t)len;
    write_all(write_fd, &status, 1);
    write_all(write_fd, &plen, 4);
    if (len > 0) write_all(write_fd, payload, len);
    close(write_fd);
    _exit(status == 0 ? 0 : 1);
}

static void child_send_error_and_exit(int write_fd, const char *msg)
{
    child_send_and_exit(write_fd, 1, (const uint8_t *)msg, strlen(msg));
}

/* ================================================================== */
/*  Worker (forked-child) entry                                        */
/* ================================================================== */

typedef struct {
    const uint8_t *fn_bytes;
    size_t fn_bytes_len;
    const uint8_t *chunk_bytes;
    size_t chunk_bytes_len;
    EastType *array_out_type; /* inherited via COW from parent */
    EastType *elem_out_type;
} WorkerInput;

/* Runs in the forked child. Decodes function + chunk, applies fn over each
 * element, encodes the result array, ships it via the pipe, and exits. */
static void worker_main(const WorkerInput *in, int write_fd)
{
    EastValue *fn_val = east_beast2_decode_auto(in->fn_bytes, in->fn_bytes_len);
    if (!fn_val || fn_val->kind != EAST_VAL_FUNCTION || !fn_val->data.function.compiled) {
        child_send_error_and_exit(write_fd, "Failed to decode function in worker");
    }

    EastValue *chunk = east_beast2_decode_auto(in->chunk_bytes, in->chunk_bytes_len);
    if (!chunk) {
        child_send_error_and_exit(write_fd, "Failed to decode input chunk in worker");
    }

    size_t len = east_array_len(chunk);
    EastValue *results = east_array_new(in->elem_out_type);

    for (size_t i = 0; i < len; i++) {
        EastValue *item = east_array_get(chunk, i);
        east_value_retain(item);
        EastValue *call_args[] = {item};
        EvalResult r = east_call(fn_val->data.function.compiled, call_args, 1);
        east_value_release(item);

        if (r.status != EVAL_OK) {
            const char *msg = r.error_message ? r.error_message : "Worker function error";
            /* Copy out before the eval result is freed. */
            char *err = strdup(msg);
            eval_result_free(&r);
            child_send_error_and_exit(write_fd, err ? err : "worker error");
        }

        east_array_push(results, r.value);
        east_value_release(r.value);
        eval_result_free(&r);
    }

    ByteBuffer *buf = east_beast2_encode_full(results, in->array_out_type);
    if (!buf) {
        child_send_error_and_exit(write_fd, "Failed to encode worker results");
    }

    child_send_and_exit(write_fd, 0, buf->data, buf->len);
}

/* ================================================================== */
/*  Parent: read worker payload                                        */
/* ================================================================== */

typedef struct {
    pid_t pid;
    int read_fd;
} WorkerProc;

/* Read [status][len][payload] from a worker. Returns 0 on success and writes
 * the decoded result into *out_result_bytes / *out_len (heap-allocated, caller
 * frees). Returns 1 on error and writes a UTF-8 message into *out_error
 * (caller frees). On read failure, returns 1 with a synthesized message. */
static int read_worker_payload(int read_fd, uint8_t **out_result_bytes, size_t *out_len,
                               char **out_error)
{
    *out_result_bytes = NULL;
    *out_len = 0;
    *out_error = NULL;

    uint8_t status = 0;
    if (read_all(read_fd, &status, 1) != 0) {
        *out_error = strdup("Worker exited without writing a result");
        return 1;
    }

    uint32_t plen = 0;
    if (read_all(read_fd, &plen, 4) != 0) {
        *out_error = strdup("Worker did not write payload length");
        return 1;
    }

    uint8_t *payload = NULL;
    if (plen > 0) {
        payload = malloc(plen);
        if (!payload) {
            *out_error = strdup("Out of memory reading worker payload");
            return 1;
        }
        if (read_all(read_fd, payload, plen) != 0) {
            free(payload);
            *out_error = strdup("Worker payload truncated");
            return 1;
        }
    }

    if (status == 0) {
        *out_result_bytes = payload;
        *out_len = (size_t)plen;
        return 0;
    }

    /* Status 1: payload is a UTF-8 error message. */
    char *msg = malloc((size_t)plen + 1);
    if (msg) {
        if (plen > 0) memcpy(msg, payload, plen);
        msg[plen] = '\0';
    }
    free(payload);
    *out_error = msg ? msg : strdup("Worker reported error (message lost)");
    return 1;
}

#endif /* !_WIN32 */

/* ================================================================== */
/*  parallel_map implementation                                        */
/* ================================================================== */

static EvalResult parallel_map_impl(EastValue **args, size_t num_args, EastType **input_types,
                                    size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    EastValue *array = args[0];
    EastValue *fn_val = args[1];
    size_t len = east_array_len(array);

    EastType *T = s_input_type ? s_input_type : &east_null_type;
    EastType *R = s_result_type ? s_result_type : &east_null_type;

    /* Small arrays run sequentially to avoid fork overhead. Windows has no
     * fork(), so ALL arrays take this in-process sequential path there. */
#ifdef _WIN32
    const int run_sequential = 1;
#else
    const int run_sequential = (len <= 4);
#endif
    if (run_sequential) {
        EastValue *result = east_array_new(R);
        for (size_t i = 0; i < len; i++) {
            EastValue *item = east_array_get(array, i);
            east_value_retain(item);
            EastValue *call_args[] = {item};
            EvalResult r = east_call(fn_val->data.function.compiled, call_args, 1);
            east_value_release(item);
            if (r.status != EVAL_OK) {
                east_value_release(result);
                return r;
            }
            east_array_push(result, r.value);
            east_value_release(r.value);
            eval_result_free(&r);
        }
        return eval_ok(result);
    }

#ifndef _WIN32
    /* Build types */
    EastType *fn_type = east_function_type(&T, 1, R);
    EastType *array_in_type = east_array_type(T);
    EastType *array_out_type = east_array_type(R);

    /* Encode the function once (shared across workers via COW). */
    ByteBuffer *fn_buf = east_beast2_encode_full(fn_val, fn_type);
    if (!fn_buf) {
        east_type_release(fn_type);
        east_type_release(array_in_type);
        east_type_release(array_out_type);
        return eval_error("Failed to encode function for parallel_map");
    }

    /* Determine worker count */
    long ncpus = sysconf(_SC_NPROCESSORS_ONLN);
    if (ncpus < 1) ncpus = 1;
    size_t num_workers = (size_t)ncpus;
    if (num_workers > len) num_workers = len;

    size_t chunk_size = (len + num_workers - 1) / num_workers;
    WorkerProc *workers = calloc(num_workers, sizeof(WorkerProc));
    ByteBuffer **chunk_bufs = calloc(num_workers, sizeof(ByteBuffer *));
    if (!workers || !chunk_bufs) {
        free(workers);
        free(chunk_bufs);
        byte_buffer_free(fn_buf);
        east_type_release(fn_type);
        east_type_release(array_in_type);
        east_type_release(array_out_type);
        return eval_error("Out of memory in parallel_map");
    }

    char *error = NULL;
    size_t spawned = 0;

    for (size_t w = 0; w < num_workers && !error; w++) {
        size_t start = w * chunk_size;
        if (start >= len) break;
        size_t end = start + chunk_size;
        if (end > len) end = len;
        size_t clen = end - start;

        /* Build chunk array */
        EastValue *chunk = east_array_new(T);
        for (size_t i = 0; i < clen; i++) {
            EastValue *item = east_array_get(array, start + i);
            east_value_retain(item);
            east_array_push(chunk, item);
            east_value_release(item);
        }

        /* Encode chunk (full mode, so arrays inside the items roundtrip) */
        chunk_bufs[w] = east_beast2_encode_full(chunk, array_in_type);
        east_value_release(chunk);
        if (!chunk_bufs[w]) {
            error = strdup("Failed to encode chunk for parallel_map");
            break;
        }

        /* Pipe + fork */
        int pipefd[2];
        if (pipe(pipefd) != 0) {
            error = strdup("Failed to create pipe for parallel_map");
            break;
        }

        pid_t pid = fork();
        if (pid < 0) {
            close(pipefd[0]);
            close(pipefd[1]);
            error = strdup("Failed to fork worker for parallel_map");
            break;
        }

        if (pid == 0) {
            /* Child: do the work, write payload, _exit. We inherit fn_buf and
             * chunk_bufs[w] via COW so we can read directly from them. */
            close(pipefd[0]);
            WorkerInput in = {
                .fn_bytes = fn_buf->data,
                .fn_bytes_len = fn_buf->len,
                .chunk_bytes = chunk_bufs[w]->data,
                .chunk_bytes_len = chunk_bufs[w]->len,
                .array_out_type = array_out_type,
                .elem_out_type = R,
            };
            worker_main(&in, pipefd[1]);
            /* worker_main always _exits. */
            _exit(127);
        }

        /* Parent */
        close(pipefd[1]);
        workers[w].pid = pid;
        workers[w].read_fd = pipefd[0];
        spawned = w + 1;
    }

    /* Read each worker's payload, collect results. We read in spawn order; the
     * pipe buffer is large enough for typical small results, and even if a
     * worker's payload exceeds the pipe buffer, the parent draining unblocks
     * the writer (children don't deadlock among themselves). */
    EastValue *result = NULL;
    if (!error && spawned > 0) {
        result = east_array_new(R);
        for (size_t w = 0; w < spawned; w++) {
            uint8_t *result_bytes = NULL;
            size_t result_len = 0;
            char *worker_err = NULL;

            int rc =
                read_worker_payload(workers[w].read_fd, &result_bytes, &result_len, &worker_err);
            close(workers[w].read_fd);
            workers[w].read_fd = -1;

            int status = 0;
            waitpid(workers[w].pid, &status, 0);

            if (rc != 0) {
                if (!error)
                    error = worker_err;
                else
                    free(worker_err);
                continue;
            }

            EastValue *chunk_result = east_beast2_decode_auto(result_bytes, result_len);
            free(result_bytes);
            if (!chunk_result) {
                if (!error) error = strdup("Failed to decode worker results");
                continue;
            }

            size_t clen = east_array_len(chunk_result);
            for (size_t i = 0; i < clen; i++) {
                EastValue *item = east_array_get(chunk_result, i);
                east_value_retain(item);
                east_array_push(result, item);
                east_value_release(item);
            }
            east_value_release(chunk_result);
        }
    }

    if (error && result) {
        east_value_release(result);
        result = NULL;
    }

    /* If we errored mid-spawn, still reap any children we did create. */
    for (size_t w = 0; w < spawned; w++) {
        if (workers[w].read_fd >= 0) {
            close(workers[w].read_fd);
            int status = 0;
            waitpid(workers[w].pid, &status, 0);
        }
    }

    /* Cleanup */
    for (size_t w = 0; w < num_workers; w++) {
        if (chunk_bufs[w]) byte_buffer_free(chunk_bufs[w]);
    }
    free(chunk_bufs);
    free(workers);
    byte_buffer_free(fn_buf);
    east_type_release(fn_type);
    east_type_release(array_in_type);
    east_type_release(array_out_type);

    if (error) {
        EvalResult err = eval_error(error);
        free(error);
        return err;
    }

    return eval_ok(result);
#else
    /* Unreachable: run_sequential is always true on Windows. */
    return eval_error("parallel_map: unreachable");
#endif
}

void east_std_register_parallel(PlatformRegistry *reg)
{
    platform_registry_add_generic(reg, "parallel_map", east_std_parallel_map_factory, true);
}
