/*
 * Filesystem platform functions for East.
 *
 * Provides filesystem operations for East programs running in C.
 * Uses POSIX APIs for directory and file operations.
 */

#include "east_std/east_std.h"
#include <east/values.h>
#include <east/types.h>
#include <east/eval_result.h>
#include <east/compat.h>
#include <east/builtins.h>
#include <east/serialization.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#ifndef _WIN32
#include <unistd.h>
#include <dirent.h>
#include <fcntl.h>
#include <sys/mman.h>
#endif
#include <errno.h>

/*
 * OS failures must be LOUD (#64): a missing/unreadable file previously
 * returned an empty value and a failed write was a silent no-op, so the
 * real failure surfaced far downstream (or as data loss). Every failure
 * path now returns an eval error carrying the action, path and errno
 * detail — message shape matches the east-node-std runtime
 * ("Failed to read file <path>: <detail>") so runners agree.
 */
static EvalResult fs_error(const char *action, const char *path, const char *detail)
{
    char msg[1024];
    snprintf(msg, sizeof msg, "Failed to %s %s: %s", action, path, detail);
    return eval_error(msg);
}

static EvalResult fs_read_file(EastValue **args, size_t num_args, EastType **input_types,
                               size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;

    FILE *f = fopen(path, "rb");
    if (!f) {
        return fs_error("read file", path, strerror(errno));
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (size < 0) {
        fclose(f);
        return fs_error("read file", path, strerror(errno));
    }

    char *buf = malloc((size_t)size + 1);
    if (!buf) {
        fclose(f);
        return fs_error("read file", path, "out of memory");
    }

    size_t read_bytes = fread(buf, 1, (size_t)size, f);
    fclose(f);
    if (read_bytes != (size_t)size) {
        free(buf);
        return fs_error("read file", path, "short read");
    }

    buf[read_bytes] = '\0';
    EastValue *result = east_string_len(buf, read_bytes);
    free(buf);
    return eval_ok(result);
}

static EvalResult fs_write_file(EastValue **args, size_t num_args, EastType **input_types,
                                size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    const char *content = args[1]->data.string.data;
    size_t len = args[1]->data.string.len;

    /* Binary mode: East strings are byte-exact, so no \n -> \r\n translation
     * (Windows text mode would corrupt the round-trip against the "rb" read). */
    FILE *f = fopen(path, "wb");
    if (!f) {
        return fs_error("write file", path, strerror(errno));
    }
    size_t written = fwrite(content, 1, len, f);
    if (fclose(f) != 0 || written != len) {
        return fs_error("write file", path, written != len ? "short write" : strerror(errno));
    }
    return eval_ok(east_null());
}

static EvalResult fs_append_file(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    const char *content = args[1]->data.string.data;
    size_t len = args[1]->data.string.len;

    FILE *f = fopen(path, "ab");
    if (!f) {
        return fs_error("append to file", path, strerror(errno));
    }
    size_t written = fwrite(content, 1, len, f);
    if (fclose(f) != 0 || written != len) {
        return fs_error("append to file", path, written != len ? "short write" : strerror(errno));
    }
    return eval_ok(east_null());
}

static EvalResult fs_delete_file(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    unlink(path);
    return eval_ok(east_null());
}

static EvalResult fs_exists(EastValue **args, size_t num_args, EastType **input_types,
                            size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    struct stat st;
    return eval_ok(east_boolean(stat(path, &st) == 0));
}

static EvalResult fs_is_file(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    struct stat st;
    if (stat(path, &st) != 0) {
        return eval_ok(east_boolean(false));
    }
    return eval_ok(east_boolean(S_ISREG(st.st_mode)));
}

static EvalResult fs_is_directory(EastValue **args, size_t num_args, EastType **input_types,
                                  size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    struct stat st;
    if (stat(path, &st) != 0) {
        return eval_ok(east_boolean(false));
    }
    return eval_ok(east_boolean(S_ISDIR(st.st_mode)));
}

static EvalResult fs_create_directory(EastValue **args, size_t num_args, EastType **input_types,
                                      size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;

    /* Create directory with parents, similar to mkdir -p */
    char *tmp = strdup(path);
    if (!tmp) return eval_ok(east_null());

    size_t len = strlen(tmp);
    /* Remove trailing slash */
    if (len > 1 && tmp[len - 1] == '/') {
        tmp[len - 1] = '\0';
    }

    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            east_mkdir(tmp);
            *p = '/';
        }
    }
    east_mkdir(tmp);
    free(tmp);
    return eval_ok(east_null());
}

static EvalResult fs_read_directory(EastValue **args, size_t num_args, EastType **input_types,
                                    size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;

    EastValue *arr = east_array_new(&east_string_type);

    DIR *dir = opendir(path);
    if (!dir) {
        return eval_ok(arr);
    }

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        /* Skip . and .. */
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }
        EastValue *name = east_string(entry->d_name);
        east_array_push(arr, name);
    }
    closedir(dir);
    return eval_ok(arr);
}

static EvalResult fs_read_file_bytes(EastValue **args, size_t num_args, EastType **input_types,
                                     size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;

    FILE *f = fopen(path, "rb");
    if (!f) {
        return fs_error("read file bytes", path, strerror(errno));
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    if (size < 0) {
        fclose(f);
        return fs_error("read file bytes", path, strerror(errno));
    }

    /* A zero-byte file needs no buffer — malloc(0) may legally return NULL. */
    uint8_t *buf = size > 0 ? malloc((size_t)size) : NULL;
    if (size > 0 && !buf) {
        fclose(f);
        return fs_error("read file bytes", path, "out of memory");
    }

    size_t read_bytes = fread(buf, 1, (size_t)size, f);
    fclose(f);
    if (read_bytes != (size_t)size) {
        free(buf);
        return fs_error("read file bytes", path, "short read");
    }

    EastValue *result = east_blob(buf, read_bytes);
    free(buf);
    return eval_ok(result);
}

static EvalResult fs_write_file_bytes(EastValue **args, size_t num_args, EastType **input_types,
                                      size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    const char *path = args[0]->data.string.data;
    const uint8_t *data = args[1]->data.blob.data;
    size_t len = args[1]->data.blob.len;

    FILE *f = fopen(path, "wb");
    if (!f) {
        return fs_error("write file bytes", path, strerror(errno));
    }
    size_t written = fwrite(data, 1, len, f);
    if (fclose(f) != 0 || written != len) {
        return fs_error("write file bytes", path, written != len ? "short write" : strerror(errno));
    }
    return eval_ok(east_null());
}

/*
 * FileSystem.openBeast (fs_open_beast<T>): the file-backed twin of the
 * blob.openBeast builtin. The file is mapped read-only and handed to the
 * host-released lazy open, so the paged value reads its segments straight
 * from the page cache and the mapping lives exactly as long as the value
 * does — the release hook below unmaps it when the value dies. A file that
 * cannot page (no index, or a Ref- or function-bearing element shape)
 * decodes whole, frozen, and its mapping is dropped at once. Windows has no
 * mmap here: the file is read into a heap buffer the same hook frees. The
 * file must stay as it is while the value is alive: a mapping of a file
 * truncated underneath it faults on the next read.
 */
static void fs_release_mapping(void *ctx, uint8_t *data, size_t len)
{
    (void)ctx;
#ifndef _WIN32
    munmap(data, len);
#else
    (void)len;
    free(data);
#endif
}

/* Maps (POSIX) or reads (Windows) the whole file. NULL on failure, with the
 * detail text in *detail. */
static uint8_t *fs_map_file(const char *path, size_t *len_out, const char **detail)
{
#ifndef _WIN32
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        *detail = strerror(errno);
        return NULL;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) {
        *detail = strerror(errno);
        close(fd);
        return NULL;
    }
    if (S_ISDIR(st.st_mode)) {
        *detail = strerror(EISDIR);
        close(fd);
        return NULL;
    }
    if (st.st_size <= 0) {
        *detail = "Data too short for Beast2 format: 0 bytes";
        close(fd);
        return NULL;
    }
    size_t len = (size_t)st.st_size;
    void *map = mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0);
    int map_errno = errno;
    close(fd);
    if (map == MAP_FAILED) {
        *detail = strerror(map_errno);
        return NULL;
    }
    *len_out = len;
    return (uint8_t *)map;
#else
    FILE *f = fopen(path, "rb");
    if (!f) {
        *detail = strerror(errno);
        return NULL;
    }
    /* 64-bit positions: `ftell` is 32-bit on Windows, and these files are
     * the ones too big to read whole. */
    _fseeki64(f, 0, SEEK_END);
    long long size = _ftelli64(f);
    _fseeki64(f, 0, SEEK_SET);
    if (size <= 0) {
        fclose(f);
        *detail = size < 0 ? strerror(errno) : "Data too short for Beast2 format: 0 bytes";
        return NULL;
    }
    uint8_t *buf = malloc((size_t)size);
    if (!buf) {
        fclose(f);
        *detail = "out of memory";
        return NULL;
    }
    size_t read_bytes = fread(buf, 1, (size_t)size, f);
    fclose(f);
    if (read_bytes != (size_t)size) {
        free(buf);
        *detail = "short read";
        return NULL;
    }
    *len_out = read_bytes;
    return buf;
#endif
}

static EvalResult fs_open_beast(EastValue **args, size_t num_args, EastType **input_types,
                                size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    const char *path = args[0]->data.string.data;
    /* The evaluator passes the call's resolved output type: T itself. */
    EastType *type = output_type;
    if (!type) return fs_error("open beast file", path, "the collection type is unknown");

    size_t len = 0;
    const char *detail = NULL;
    uint8_t *data = fs_map_file(path, &len, &detail);
    if (!data) return fs_error("open beast file", path, detail ? detail : "cannot map file");

    /* Not a beast2 container at all: the diagnostics the other runtimes
     * give, under the same prefix. */
    char magic_msg[128];
    const char *magic_problem = east_beast2_magic_problem(data, len, magic_msg, sizeof magic_msg);
    if (magic_problem) {
        fs_release_mapping(NULL, data, len);
        return fs_error("open beast file", path, magic_problem);
    }

    /* The header must carry exactly the requested type — both container
     * versions name it; a type the header cannot be read for is left to the
     * decode, which reports its own failure. */
    EastType *wire = east_beast2_extract_type(data, len);
    if (wire) {
        if (!east_type_equal(wire, type)) {
            char *wire_s = east_print_type(wire);
            char *want_s = east_print_type(type);
            char msg[1024];
            snprintf(msg, sizeof msg, "beast2: cannot open a blob of type %s as %s",
                     wire_s ? wire_s : "?", want_s ? want_s : "?");
            free(wire_s);
            free(want_s);
            east_type_release(wire);
            fs_release_mapping(NULL, data, len);
            return fs_error("open beast file", path, msg);
        }
        east_type_release(wire);
    } else {
        free(east_builtin_get_error());
    }

    EastValue *paged =
        east_beast2_open_paged_external(data, len, type, true, fs_release_mapping, NULL);
    if (paged) return eval_ok(paged);
    /* Not pageable: the callback never fired, the mapping is still ours.
     * Keep the pager's reason in case the decode fails without one. */
    char *open_err = east_builtin_get_error();

    EastValue *whole = east_beast2_decode_full_frozen(data, len, type);
    fs_release_mapping(NULL, data, len);
    if (!whole) {
        char *err = east_builtin_get_error();
        const char *detail = err ? err : (open_err ? open_err : "beast2 decode failed");
        EvalResult r = fs_error("open beast file", path, detail);
        free(err);
        free(open_err);
        return r;
    }
    free(open_err);
    return eval_ok(whole);
}

/* The generic's one type argument is the output type itself, and the
 * evaluator hands every call its resolved output type, so there is nothing
 * to specialise per instantiation: one implementation serves every T. (A
 * per-T closure would need a thread-local stash of `type_params`, which is
 * unsafe here because arguments are evaluated after the registry lookup.) */
static PlatformFn fs_open_beast_factory(EastType **type_params, size_t num_type_params)
{
    (void)type_params;
    (void)num_type_params;
    return fs_open_beast;
}

void east_std_register_fs(PlatformRegistry *reg)
{
    platform_registry_add(reg, "fs_read_file", fs_read_file, false);
    platform_registry_add(reg, "fs_write_file", fs_write_file, false);
    platform_registry_add(reg, "fs_append_file", fs_append_file, false);
    platform_registry_add(reg, "fs_delete_file", fs_delete_file, false);
    platform_registry_add(reg, "fs_exists", fs_exists, false);
    platform_registry_add(reg, "fs_is_file", fs_is_file, false);
    platform_registry_add(reg, "fs_is_directory", fs_is_directory, false);
    platform_registry_add(reg, "fs_create_directory", fs_create_directory, false);
    platform_registry_add(reg, "fs_read_directory", fs_read_directory, false);
    platform_registry_add(reg, "fs_read_file_bytes", fs_read_file_bytes, false);
    platform_registry_add(reg, "fs_write_file_bytes", fs_write_file_bytes, false);
    platform_registry_add_generic(reg, "fs_open_beast", fs_open_beast_factory, false);
}
