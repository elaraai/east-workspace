/*
 * Reading JSON documents that do not fit in memory.
 *
 * The ingest half of the contract boundary: jsonSchemaFor(T) publishes what a
 * producer must send, and these read it back under exactly that contract. One
 * element is in flight at a time, whatever the document's size.
 *
 * The file is mapped rather than read, so residency is the kernel's business:
 * the pages a scan touches are the pages it costs, and nothing is copied onto
 * the heap. That is the same idiom fs_open_beast uses, and it is why this
 * runtime needs no chunking machinery of its own.
 */

#include "east_std/east_std.h"
#include <east/eval_result.h>
#include <east/hashmap.h>
#include <east/serialization.h>
#include <east/types.h>
#include <east/values.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#ifndef _WIN32
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

/* An open reader and the bytes it borrows. The mapping outlives every read and
 * is released only by json_close. */
typedef struct {
    EastJsonReader *reader;
    char *data;
    size_t len;
    bool mapped; /* mapped (POSIX) rather than read onto the heap (Windows, text) */
} JsonHandle;

static Hashmap *json_handles = NULL;
static unsigned long json_next_handle = 1;

static EvalResult json_error(const char *fn, const char *detail)
{
    char msg[1024];
    snprintf(msg, sizeof msg, "%s: %s", fn, detail);
    return eval_error(msg);
}

static void json_handle_free(void *v)
{
    JsonHandle *h = (JsonHandle *)v;
    if (!h) return;
    east_json_reader_free(h->reader);
    if (h->data) {
#ifndef _WIN32
        if (h->mapped)
            munmap(h->data, h->len);
        else
            free(h->data);
#else
        free(h->data);
#endif
    }
    free(h);
}

/* Maps (POSIX) or reads (Windows) the whole file. NULL on failure, detail set. */
static char *json_map_file(const char *path, size_t *len_out, bool *mapped, const char **detail)
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
    if (st.st_size == 0) {
        close(fd);
        *detail = "the document is empty";
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
    *mapped = true;
    return (char *)map;
#else
    FILE *f = fopen(path, "rb");
    if (!f) {
        *detail = strerror(errno);
        return NULL;
    }
    _fseeki64(f, 0, SEEK_END);
    long long size = _ftelli64(f);
    _fseeki64(f, 0, SEEK_SET);
    if (size <= 0) {
        fclose(f);
        *detail = size < 0 ? strerror(errno) : "the document is empty";
        return NULL;
    }
    char *buf = malloc((size_t)size);
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
    *mapped = false;
    return buf;
#endif
}

/* Stores an open reader and returns its opaque handle. */
static EvalResult json_hold(EastJsonReader *reader, char *data, size_t len, bool mapped)
{
    if (!json_handles) json_handles = hashmap_new();
    JsonHandle *h = calloc(1, sizeof(JsonHandle));
    if (!h) {
        east_json_reader_free(reader);
        return eval_error("json_open: out of memory");
    }
    h->reader = reader;
    h->data = data;
    h->len = len;
    h->mapped = mapped;

    char key[32];
    snprintf(key, sizeof key, "%lu", json_next_handle++);
    hashmap_set(json_handles, key, h);
    return eval_ok(east_string(key));
}

static JsonHandle *json_get(const char *handle)
{
    if (!json_handles) return NULL;
    return (JsonHandle *)hashmap_get(json_handles, handle);
}

static EvalResult json_open(EastValue **args, size_t num_args, EastType **input_types,
                            size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    const char *path = args[0]->data.string.data;
    const char *pointer = args[1]->data.string.data;

    size_t len = 0;
    bool mapped = false;
    const char *detail = NULL;
    char *data = json_map_file(path, &len, &mapped, &detail);
    if (!data) return json_error("json_open", detail ? detail : "cannot open the document");

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(data, len, pointer, true, &err);
    if (!reader) {
        EvalResult r = json_error("json_open", err ? err : "cannot read the document");
        free(err);
#ifndef _WIN32
        if (mapped)
            munmap(data, len);
        else
            free(data);
#else
        free(data);
#endif
        return r;
    }
    return json_hold(reader, data, len, mapped);
}

static EvalResult json_open_text(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    const char *text = args[0]->data.string.data;
    size_t len = args[0]->data.string.len;
    const char *pointer = args[1]->data.string.data;

    /* The East string is the caller's; the reader borrows for its whole life,
     * so the bytes are copied here and freed with the handle. */
    char *copy = malloc(len ? len : 1);
    if (!copy) return eval_error("json_open_text: out of memory");
    memcpy(copy, text, len);

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(copy, len, pointer, true, &err);
    if (!reader) {
        EvalResult r = json_error("json_open_text", err ? err : "cannot read the document");
        free(err);
        free(copy);
        return r;
    }
    return json_hold(reader, copy, len, false);
}

static EvalResult json_more(EastValue **args, size_t num_args, EastType **input_types,
                            size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    JsonHandle *h = json_get(args[0]->data.string.data);
    if (!h) return json_error("json_more", "no open JSON reader for this handle");
    return eval_ok(east_boolean(east_json_reader_more(h->reader)));
}

static EvalResult json_next(EastValue **args, size_t num_args, EastType **input_types,
                            size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    JsonHandle *h = json_get(args[0]->data.string.data);
    if (!h) return json_error("json_next", "no open JSON reader for this handle");
    if (!output_type) return json_error("json_next", "the element type is unknown");

    char *err = NULL;
    EastValue *value = east_json_reader_next(h->reader, output_type, &err);
    if (!value) {
        EvalResult r = json_error("json_next", err ? err : "the element does not satisfy the type");
        free(err);
        return r;
    }
    return eval_ok(value);
}

static EvalResult json_value(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    const char *path = args[0]->data.string.data;
    const char *pointer = args[1]->data.string.data;
    if (!output_type) return json_error("json_value", "the value's type is unknown");

    size_t len = 0;
    bool mapped = false;
    const char *detail = NULL;
    char *data = json_map_file(path, &len, &mapped, &detail);
    if (!data) return json_error("json_value", detail ? detail : "cannot open the document");

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(data, len, pointer, false, &err);
    EastValue *value = NULL;
    if (reader) {
        value = east_json_reader_read(reader, output_type, &err);
        east_json_reader_free(reader);
    }
#ifndef _WIN32
    if (mapped)
        munmap(data, len);
    else
        free(data);
#else
    free(data);
#endif
    if (!value) {
        EvalResult r = json_error("json_value", err ? err : "cannot read the value");
        free(err);
        return r;
    }
    free(err);
    return eval_ok(value);
}

static EvalResult json_close(EastValue **args, size_t num_args, EastType **input_types,
                             size_t num_input_types, EastType *output_type)
{
    (void)num_args;
    (void)input_types;
    (void)num_input_types;
    (void)output_type;
    const char *handle = args[0]->data.string.data;
    JsonHandle *h = json_get(handle);
    if (!h) return json_error("json_close", "no open JSON reader for this handle");
    hashmap_delete(json_handles, handle, json_handle_free);
    return eval_ok(east_null());
}

/* Both generics read their resolved output type from the call, as
 * fs_open_beast does, so one implementation serves every T. */
static PlatformFn json_next_factory(EastType **type_params, size_t num_type_params)
{
    (void)type_params;
    (void)num_type_params;
    return json_next;
}

static PlatformFn json_value_factory(EastType **type_params, size_t num_type_params)
{
    (void)type_params;
    (void)num_type_params;
    return json_value;
}

void east_std_register_json(PlatformRegistry *reg)
{
    platform_registry_add(reg, "json_open", json_open, false);
    platform_registry_add(reg, "json_open_text", json_open_text, false);
    platform_registry_add(reg, "json_more", json_more, false);
    platform_registry_add(reg, "json_close", json_close, false);
    platform_registry_add_generic(reg, "json_next", json_next_factory, false);
    platform_registry_add_generic(reg, "json_value", json_value_factory, false);
}
