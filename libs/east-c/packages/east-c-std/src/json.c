/*
 * Reading JSON documents that do not fit in memory.
 *
 * The ingest half of the contract boundary: jsonSchemaFor(T) publishes what a
 * producer must send, and these read it back under exactly that contract. One
 * element is in flight at a time, whatever the document's size.
 *
 * The file is mapped rather than read — a POSIX mmap, or a file mapping on
 * Windows — so residency is the kernel's business on every platform: the pages
 * a scan touches are the pages it costs, and nothing is copied onto the heap.
 * That is why this runtime needs no chunking machinery of its own.
 */

#include "east_std/east_std.h"
#include <east/eval_result.h>
#include <east/hashmap.h>
#include <east/serialization.h>
#include <east/types.h>
#include <east/values.h>
#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

/* The bytes a reader borrows: a file mapping, or heap bytes copied from an
 * East string (json_open_text). Released with the handle. */
typedef struct {
    char *data;
    size_t len;
    bool mapped;
#ifdef _WIN32
    HANDLE mapping; /* the mapping object behind `data` while it is mapped */
#endif
} JsonBytes;

/* An open reader and the bytes it borrows. The mapping outlives every read and
 * is released only by json_close. */
typedef struct {
    EastJsonReader *reader;
    JsonBytes bytes;
} JsonHandle;

static Hashmap *json_handles = NULL;
static unsigned long json_next_handle = 1;

/* "<fn>: <detail>", sized to fit: the detail can carry a pointer and a quoted
 * value, and a clipped message would not be the text the other runtimes give. */
static EvalResult json_error(const char *fn, const char *detail)
{
    size_t need = strlen(fn) + 2 + strlen(detail) + 1;
    char *msg = malloc(need);
    if (!msg) return eval_error(fn);
    snprintf(msg, need, "%s: %s", fn, detail);
    EvalResult r = eval_error(msg);
    free(msg);
    return r;
}

static void json_bytes_release(JsonBytes *b)
{
    if (!b->data) return;
    if (b->mapped) {
#ifdef _WIN32
        UnmapViewOfFile(b->data);
        CloseHandle(b->mapping);
#else
        munmap(b->data, b->len);
#endif
    } else {
        free(b->data);
    }
    b->data = NULL;
    b->len = 0;
}

static void json_handle_free(void *v)
{
    JsonHandle *h = (JsonHandle *)v;
    if (!h) return;
    /* The reader borrows the bytes, so it goes first. */
    east_json_reader_free(h->reader);
    json_bytes_release(&h->bytes);
    free(h);
}

#ifdef _WIN32
/* The system's text for a Win32 error, without its trailing line break. */
static const char *json_win_error(DWORD code)
{
    static char text[256];
    DWORD n = FormatMessageA(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, NULL, code,
                             MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), text, sizeof text, NULL);
    if (n == 0) {
        snprintf(text, sizeof text, "error %lu", (unsigned long)code);
        return text;
    }
    while (n > 0 && (text[n - 1] == '\n' || text[n - 1] == '\r' || text[n - 1] == ' '))
        text[--n] = '\0';
    return text;
}
#endif

/* Maps the whole file read-only. False on failure, with `detail` set. */
static bool json_map_file(const char *path, JsonBytes *out, const char **detail)
{
    out->data = NULL;
    out->len = 0;
    out->mapped = false;
#ifdef _WIN32
    DWORD attrs = GetFileAttributesA(path);
    if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
        *detail = strerror(EISDIR);
        return false;
    }
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) {
        *detail = json_win_error(GetLastError());
        return false;
    }
    LARGE_INTEGER size;
    if (!GetFileSizeEx(file, &size)) {
        *detail = json_win_error(GetLastError());
        CloseHandle(file);
        return false;
    }
    if (size.QuadPart == 0) {
        CloseHandle(file);
        *detail = "the document is empty";
        return false;
    }
    if ((unsigned long long)size.QuadPart > (unsigned long long)SIZE_MAX) {
        CloseHandle(file);
        *detail = "the document is too large to map";
        return false;
    }
    HANDLE mapping = CreateFileMappingA(file, NULL, PAGE_READONLY, 0, 0, NULL);
    DWORD map_error = GetLastError();
    CloseHandle(file); /* the mapping keeps the file open for as long as it lives */
    if (!mapping) {
        *detail = json_win_error(map_error);
        return false;
    }
    void *view = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
    if (!view) {
        *detail = json_win_error(GetLastError());
        CloseHandle(mapping);
        return false;
    }
    out->data = (char *)view;
    out->len = (size_t)size.QuadPart;
    out->mapped = true;
    out->mapping = mapping;
    return true;
#else
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        *detail = strerror(errno);
        return false;
    }
    struct stat st;
    if (fstat(fd, &st) != 0) {
        *detail = strerror(errno);
        close(fd);
        return false;
    }
    if (S_ISDIR(st.st_mode)) {
        *detail = strerror(EISDIR);
        close(fd);
        return false;
    }
    if (st.st_size == 0) {
        close(fd);
        *detail = "the document is empty";
        return false;
    }
    size_t len = (size_t)st.st_size;
    void *map = mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0);
    int map_errno = errno;
    close(fd);
    if (map == MAP_FAILED) {
        *detail = strerror(map_errno);
        return false;
    }
    out->data = (char *)map;
    out->len = len;
    out->mapped = true;
    return true;
#endif
}

/* Stores an open reader and returns its opaque handle. Takes ownership of the
 * reader and the bytes on every path. */
static EvalResult json_hold(EastJsonReader *reader, JsonBytes *bytes)
{
    if (!json_handles) json_handles = hashmap_new();
    JsonHandle *h = calloc(1, sizeof(JsonHandle));
    if (!h) {
        east_json_reader_free(reader);
        json_bytes_release(bytes);
        return eval_error("json_open: out of memory");
    }
    h->reader = reader;
    h->bytes = *bytes;

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

    JsonBytes bytes;
    const char *detail = NULL;
    if (!json_map_file(path, &bytes, &detail))
        return json_error("json_open", detail ? detail : "cannot open the document");

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(bytes.data, bytes.len, pointer, true, &err);
    if (!reader) {
        EvalResult r = json_error("json_open", err ? err : "cannot read the document");
        free(err);
        json_bytes_release(&bytes);
        return r;
    }
    return json_hold(reader, &bytes);
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
    JsonBytes bytes = {.data = malloc(len ? len : 1), .len = len, .mapped = false};
    if (!bytes.data) return eval_error("json_open_text: out of memory");
    memcpy(bytes.data, text, len);

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(bytes.data, len, pointer, true, &err);
    if (!reader) {
        EvalResult r = json_error("json_open_text", err ? err : "cannot read the document");
        free(err);
        json_bytes_release(&bytes);
        return r;
    }
    return json_hold(reader, &bytes);
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

    JsonBytes bytes;
    const char *detail = NULL;
    if (!json_map_file(path, &bytes, &detail))
        return json_error("json_value", detail ? detail : "cannot open the document");

    char *err = NULL;
    EastJsonReader *reader = east_json_reader_open(bytes.data, bytes.len, pointer, false, &err);
    EastValue *value = NULL;
    if (reader) {
        value = east_json_reader_read(reader, output_type, &err);
        east_json_reader_free(reader);
    }
    json_bytes_release(&bytes);
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
