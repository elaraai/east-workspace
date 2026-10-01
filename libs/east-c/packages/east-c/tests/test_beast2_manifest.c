/*
 * Segment manifests, pinned against TypeScript's manifest writer: the
 * directories three 50,000-element collections (and an empty one) are written
 * as are TypeScript's to the byte — the manifest's SHA-256 is pinned, and the
 * manifest names every segment by its own — each object is named by its
 * SHA-256, and a directory reads back, lazily through the manifest pager or
 * whole, as the value it was written from; and the merge reads manifest
 * directories and writes one. Run under ASan/LSan for the pager's segment
 * source and the writer's lifetimes, their error paths included.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef _WIN32
#include <dirent.h>
#endif

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

/* TypeScript's manifests of the parity values below — the SHA-256 of each
 * manifest's bytes, as Beast2ManifestWriter writes them
 * (`east/src/serialization/beast2/v5/manifest-writer.spec.ts`). */
#define DICT_MANIFEST "5564111725b1962b7ae8c82cf91d24c4e1fb8d2c9613245693757fe4ff4187b0"
#define SET_MANIFEST "7b2c57db1da82f98ef88018589dc7a4f96bac120472b35e9826dbd60c395789c"
#define ARRAY_MANIFEST "127030afceae0c9590ad26ed26521cff170b8024229f28ccd54d647fc218df4c"
#define EMPTY_DICT_MANIFEST "356518ed344e3e210d0a2acb26eef7eff25cd76ba08b1aedd0640af5256cefb0"

static char g_dir[64];

/* ----- files ------------------------------------------------------------ */

static ByteBuffer *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    ByteBuffer *buf = byte_buffer_new(len > 0 ? (size_t)len : 1);
    buf->len = fread(buf->data, 1, (size_t)len, f);
    fclose(f);
    return buf;
}

static void path_of(char *out, size_t cap, const char *name)
{
    snprintf(out, cap, "%s/%s", g_dir, name);
}

static void object_path(char *out, size_t cap, const char *manifest_path, const char *hash,
                        size_t len)
{
    snprintf(out, cap, "%s.segments/%.*s.beast2", manifest_path, (int)len, hash);
}

static EastValue *entries_of(EastValue *manifest)
{
    return east_struct_get_field_idx(manifest, 5);
}

static EastValue *entry_hash(EastValue *manifest, size_t i)
{
    return east_struct_get_field_idx(east_array_get(entries_of(manifest), i), 0);
}

/* The manifest a directory's file holds, decoded. */
static EastValue *manifest_at(const char *path)
{
    ByteBuffer *bytes = read_file(path);
    EastValue *manifest = NULL;
    int found = bytes ? east_beast2_read_manifest(bytes->data, bytes->len, &manifest) : 0;
    CHECK(found == 1, "%s does not hold a manifest", path);
    byte_buffer_free(bytes);
    return manifest;
}

/* Removes a manifest directory: every object the manifest names, the objects
 * directory, and the manifest. */
static void remove_dir(const char *path)
{
    EastValue *manifest = manifest_at(path);
    char object[512];
    if (manifest) {
        EastValue *header = east_struct_get_field_idx(manifest, 4);
        object_path(object, sizeof(object), path, header->data.string.data,
                    header->data.string.len);
        remove(object);
        for (size_t i = 0; i < east_array_len(entries_of(manifest)); i++) {
            EastValue *hash = entry_hash(manifest, i);
            object_path(object, sizeof(object), path, hash->data.string.data,
                        hash->data.string.len);
            remove(object);
        }
        east_value_release(manifest);
    }
    snprintf(object, sizeof(object), "%s.segments", path);
    rmdir(object);
    remove(path);
}

/* The manifest file's SHA-256, and every object's name its own SHA-256. */
static void check_directory(const char *what, const char *path, const char *pin,
                            size_t expected_entries)
{
    ByteBuffer *bytes = read_file(path);
    CHECK(bytes != NULL, "%s: no manifest written", what);
    if (!bytes) return;
    char hex[EAST_SHA256_HEX_SIZE];
    east_sha256_hex(bytes->data, bytes->len, hex);
    CHECK(strcmp(hex, pin) == 0, "%s: the manifest diverges from TypeScript's: %s (expected %s)",
          what, hex, pin);
    byte_buffer_free(bytes);

    EastValue *manifest = manifest_at(path);
    if (!manifest) return;
    size_t n = east_array_len(entries_of(manifest));
    CHECK(n == expected_entries, "%s: %zu entries, expected %zu", what, n, expected_entries);
    char object[512];
    for (size_t i = 0; i <= n; i++) {
        /* Entry i's segment, and after the entries the header. */
        EastValue *hash = i < n ? entry_hash(manifest, i) : east_struct_get_field_idx(manifest, 4);
        object_path(object, sizeof(object), path, hash->data.string.data, hash->data.string.len);
        ByteBuffer *blob = read_file(object);
        CHECK(blob != NULL, "%s: object %.64s is missing", what, hash->data.string.data);
        if (!blob) continue;
        east_sha256_hex(blob->data, blob->len, hex);
        CHECK(strncmp(hex, hash->data.string.data, 64) == 0, "%s: object %.64s hashes to %s", what,
              hash->data.string.data, hex);
        byte_buffer_free(blob);
    }
    east_value_release(manifest);
}

/* ----- values ------------------------------------------------------------ */

static EastValue *parity_dict(EastType *type, size_t n)
{
    EastValue *d = east_dict_new(type->data.dict.key, type->data.dict.value);
    for (size_t i = 0; i < n; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07u", (unsigned)i);
        EastValue *k = east_string(buf), *v = east_integer((int64_t)i);
        east_dict_set(d, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return d;
}

static EastValue *parity_set(EastType *type)
{
    EastValue *s = east_set_new(type->data.element);
    for (size_t i = 0; i < 50000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "e%07u", (unsigned)i);
        EastValue *e = east_string(buf);
        east_set_insert(s, e);
        east_value_release(e);
    }
    return s;
}

static EastValue *parity_array(EastType *type)
{
    EastValue *a = east_array_new(type->data.element);
    for (size_t i = 0; i < 50000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "a%07u", (unsigned)i);
        EastValue *e = east_string(buf);
        east_array_push(a, e);
        east_value_release(e);
    }
    return a;
}

/* ----- the gates ---------------------------------------------------------- */

static void test_parity_directories(void)
{
    char path[256];
    EastType *dict_type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(dict_type, 50000);
    path_of(path, sizeof(path), "dict.beast2");
    CHECK(east_beast2_write_manifest_dir(dict, dict_type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing the Dict failed: %s", east_builtin_get_error());
    check_directory("Dict", path, DICT_MANIFEST, 38);
    remove_dir(path);
    east_value_release(dict);

    EastType *set_type = east_set_type(&east_string_type);
    EastValue *set = parity_set(set_type);
    path_of(path, sizeof(path), "set.beast2");
    CHECK(east_beast2_write_manifest_dir(set, set_type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing the Set failed: %s", east_builtin_get_error());
    check_directory("Set", path, SET_MANIFEST, 44);
    remove_dir(path);
    east_value_release(set);

    EastType *array_type = east_array_type(&east_string_type);
    EastValue *array = parity_array(array_type);
    path_of(path, sizeof(path), "array.beast2");
    CHECK(east_beast2_write_manifest_dir(array, array_type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing the Array failed: %s", east_builtin_get_error());
    check_directory("Array", path, ARRAY_MANIFEST, 43);
    remove_dir(path);
    east_value_release(array);

    EastValue *empty = east_dict_new(&east_string_type, &east_integer_type);
    path_of(path, sizeof(path), "empty.beast2");
    CHECK(east_beast2_write_manifest_dir(empty, dict_type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing the empty Dict failed: %s", east_builtin_get_error());
    check_directory("empty Dict", path, EMPTY_DICT_MANIFEST, 0);
    EastValue *manifest = manifest_at(path);
    EastValue *back =
        manifest ? east_beast2_decode_manifest_dir(path, manifest, dict_type, true) : NULL;
    CHECK(back && east_dict_len(back) == 0, "the empty Dict does not read back empty");
    if (back) east_value_release(back);
    if (manifest) east_value_release(manifest);
    remove_dir(path);
    east_value_release(empty);
}

/* A directory reads back as its value: lazily, a keyed read opening the one
 * segment it lands in; and whole, through a hydrate or a decode. */
static void test_read_back(void)
{
    char path[256];
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(type, 50000);
    path_of(path, sizeof(path), "read.beast2");
    CHECK(east_beast2_write_manifest_dir(dict, type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing failed: %s", east_builtin_get_error());
    EastValue *manifest = manifest_at(path);
    if (!manifest) {
        east_value_release(dict);
        return;
    }

    EastValue *lazy = east_beast2_open_manifest_dir(path, manifest, type, true);
    CHECK(lazy && lazy->kind == EAST_VAL_PAGED, "the directory did not open lazily: %s",
          east_builtin_get_error());
    if (lazy) {
        CHECK(east_dict_len(lazy) == 50000, "the lazy Dict holds %zu pairs", east_dict_len(lazy));
        Beast2Pages *pages = lazy->data.paged.pages;
        EastValue *key = east_string("k0031415");
        EastValue *value = NULL;
        CHECK(east_beast2_pages_get_key(pages, key, &value) == 1 && value &&
                  value->data.integer == 31415,
              "a keyed read of the directory missed");
        if (value) east_value_release(value);
        east_value_release(key);
        size_t decoded = 0, probed = 0;
        east_beast2_pages_stats(pages, &decoded, &probed);
        CHECK(decoded == 1, "a keyed read decoded %zu segments, not one", decoded);

        EastValue *whole = east_paged_hydrated(lazy);
        CHECK(whole && east_value_equal(whole, dict), "the hydrated directory is not the value");
        east_value_release(lazy);
    }

    EastValue *decoded = east_beast2_decode_manifest_dir(path, manifest, type, false);
    CHECK(decoded && east_value_equal(decoded, dict), "the decoded directory is not the value");
    if (decoded) east_value_release(decoded);

    /* A segment gone from the directory is named when a read needs it. */
    char object[512];
    EastValue *hash = entry_hash(manifest, 7);
    object_path(object, sizeof(object), path, hash->data.string.data, hash->data.string.len);
    remove(object);
    CHECK(east_beast2_decode_manifest_dir(path, manifest, type, false) == NULL,
          "a directory missing a segment decoded");
    char *err = east_builtin_get_error();
    CHECK(err && strstr(err, "cannot be read") && strstr(err, hash->data.string.data),
          "the missing segment was reported as: %s", err ? err : "nothing");
    free(err);

    remove_dir(path);
    east_value_release(manifest);
    east_value_release(dict);
}

/* What is not a manifest is not read as one. */
static void test_recognition(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(type, 10);
    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE);
    EastValue *manifest = NULL;
    CHECK(east_beast2_read_manifest(blob->data, blob->len, &manifest) == 0 && !manifest,
          "a collection blob read as a manifest");
    static const uint8_t junk[16] = {1, 2, 3};
    CHECK(east_beast2_read_manifest(junk, sizeof(junk), &manifest) == 0,
          "sixteen bytes of junk read as a manifest");
    byte_buffer_free(blob);
    east_value_release(dict);
}

static bool write_bytes(const char *path, const ByteBuffer *bytes)
{
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    bool ok = fwrite(bytes->data, 1, bytes->len, f) == bytes->len;
    return fclose(f) == 0 && ok;
}

/* The merge reads manifest directories and writes one: the two halves of the
 * parity Dict merge into TypeScript's directory of the whole, and a key range
 * of them into the blob of that range, sought through the manifests' fences. */
static void test_merge(void)
{
    char evens_path[256], odds_path[256], merged[256], ranged[256], range_path[256];
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(type, 50000);
    EastValue *evens = east_dict_new(&east_string_type, &east_integer_type);
    EastValue *odds = east_dict_new(&east_string_type, &east_integer_type);
    for (size_t i = 0; i < east_dict_len(dict); i++)
        east_dict_set(i % 2 ? odds : evens, east_dict_key_at(dict, i), east_dict_val_at(dict, i));
    path_of(evens_path, sizeof(evens_path), "evens.beast2");
    path_of(odds_path, sizeof(odds_path), "odds.beast2");
    CHECK(east_beast2_write_manifest_dir(evens, type, EAST_BEAST2_CODEC_DEFLATE, evens_path) &&
              east_beast2_write_manifest_dir(odds, type, EAST_BEAST2_CODEC_DEFLATE, odds_path),
          "writing the halves failed: %s", east_builtin_get_error());

    const char *inputs[2] = {evens_path, odds_path};
    path_of(merged, sizeof(merged), "merged.beast2");
    EastMergeConfig cfg = {
        .input_paths = inputs, .num_inputs = 2, .output_path = merged, .output_manifest = true};
    EastMergeStats stats;
    CHECK(east_merge_blobs(&cfg, &stats) && stats.entries == 50000,
          "merging the manifests failed: %s", east_builtin_get_error());
    check_directory("merged Dict", merged, DICT_MANIFEST, 38);
    remove_dir(merged);

    /* [k0010000, k0020000) of the halves, into one blob. */
    const char *case_names[2] = {"none", "some"};
    EastType *case_types[2] = {&east_null_type, &east_string_type};
    EastType *option = east_variant_type(case_names, case_types, 2);
    const char *field_names[2] = {"from", "to"};
    EastType *field_types[2] = {option, option};
    EastType *range_type = east_struct_type(field_names, field_types, 2);
    EastValue *lo = east_string("k0010000"), *hi = east_string("k0020000");
    EastValue *bound_fields[2] = {east_variant_new("some", lo, option),
                                  east_variant_new("some", hi, option)};
    east_value_release(lo);
    east_value_release(hi);
    EastValue *bounds = east_struct_new_owned(field_names, bound_fields, 2, range_type);
    ByteBuffer *range_bytes = east_beast2_encode_full(bounds, range_type);
    path_of(range_path, sizeof(range_path), "range.beast2");
    CHECK(range_bytes && write_bytes(range_path, range_bytes), "writing the range failed");
    path_of(ranged, sizeof(ranged), "ranged.beast2");
    cfg = (EastMergeConfig){
        .input_paths = inputs, .num_inputs = 2, .output_path = ranged, .range_path = range_path};
    CHECK(east_merge_blobs(&cfg, &stats) && stats.entries == 10000,
          "the ranged merge of the manifests failed: %s", east_builtin_get_error());
    EastValue *expected = east_dict_new(&east_string_type, &east_integer_type);
    for (size_t i = 10000; i < 20000; i++)
        east_dict_set(expected, east_dict_key_at(dict, i), east_dict_val_at(dict, i));
    ByteBuffer *want = east_beast2_encode_paged(expected, type, EAST_BEAST2_CODEC_DEFLATE);
    ByteBuffer *got = read_file(ranged);
    CHECK(got && want && got->len == want->len && memcmp(got->data, want->data, got->len) == 0,
          "the ranged merge of the manifests is not the range's blob");

    byte_buffer_free(got);
    byte_buffer_free(want);
    byte_buffer_free(range_bytes);
    east_value_release(expected);
    east_value_release(bounds);
    remove(ranged);
    remove(range_path);
    remove_dir(evens_path);
    remove_dir(odds_path);
    east_value_release(evens);
    east_value_release(odds);
    east_value_release(dict);
}

/* ----- segments the host places as they are read -------------------------- */

/* A host on a thread of its own — the reader waits on its own thread — that
 * places each segment asked for in `segment_dir` from `store`, where the
 * segments were moved, or writes `refusal` for it, until stopped. */
typedef struct {
    const char *segment_dir;
    const char *store;
    const char *refusal;
    unsigned char stop;
    int placed;
} Host;

static EAST_THREAD_ENTRY host_serve(void *arg)
{
    Host *h = arg;
    while (!__atomic_load_n(&h->stop, __ATOMIC_ACQUIRE)) {
        DIR *d = opendir(h->segment_dir);
        struct dirent *e;
        while (d && (e = readdir(d))) {
            size_t n = strlen(e->d_name);
            if (n < 5 || strcmp(e->d_name + n - 5, ".want") != 0) continue;
            char file[512], from[512], placing[600];
            struct stat st;
            snprintf(file, sizeof(file), "%s/%.*s", h->segment_dir, (int)(n - 5), e->d_name);
            if (stat(file, &st) == 0) continue;
            if (h->refusal) {
                snprintf(placing, sizeof(placing), "%s.error", file);
                if (stat(placing, &st) == 0) continue;
                /* Written whole, as e3's host writes it: under a name of its
                 * own, then renamed into place, so a reader that finds it
                 * reads all of it. */
                char partial[640];
                snprintf(partial, sizeof(partial), "%s.partial", placing);
                FILE *f = fopen(partial, "wb");
                if (f) {
                    fputs(h->refusal, f);
                    bool written = fclose(f) == 0;
                    if (!written || rename(partial, placing) != 0) remove(partial);
                }
                continue;
            }
            snprintf(from, sizeof(from), "%s/%.*s", h->store, (int)(n - 5), e->d_name);
            snprintf(placing, sizeof(placing), "%s.placing", file);
            ByteBuffer *bytes = read_file(from);
            FILE *f = bytes ? fopen(placing, "wb") : NULL;
            if (f) {
                fwrite(bytes->data, 1, bytes->len, f);
                fclose(f);
                if (rename(placing, file) == 0) h->placed++;
            }
            byte_buffer_free(bytes);
        }
        if (d) closedir(d);
        usleep(1000);
    }
    return EAST_THREAD_DONE;
}

/* With EAST_BEAST2_FETCH_SEGMENTS_ENV at "1" a reader asks the host for each
 * segment it reads, beside where it would be, and waits for it: a keyed read
 * asks for the one it lands in, and a segment the host cannot place fails the
 * read in the host's words. Without it, an absent segment fails the read at
 * once. */
static void test_fetched_segments(void)
{
    char path[256], store[256], segment_dir[300], object[512], moved[512];
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(type, 50000);
    path_of(path, sizeof(path), "fetched.beast2");
    CHECK(east_beast2_write_manifest_dir(dict, type, EAST_BEAST2_CODEC_DEFLATE, path),
          "writing failed: %s", east_builtin_get_error());
    EastValue *manifest = manifest_at(path);
    if (!manifest) {
        east_value_release(dict);
        return;
    }
    path_of(store, sizeof(store), "store");
    east_mkdir(store);
    snprintf(segment_dir, sizeof(segment_dir), "%s.segments", path);
    size_t n = east_array_len(entries_of(manifest));
    for (size_t i = 0; i < n; i++) {
        EastValue *hash = entry_hash(manifest, i);
        object_path(object, sizeof(object), path, hash->data.string.data, hash->data.string.len);
        snprintf(moved, sizeof(moved), "%s/%.64s.beast2", store, hash->data.string.data);
        rename(object, moved);
    }

    setenv(EAST_BEAST2_FETCH_SEGMENTS_ENV, "1", 1);
    Host host = {segment_dir, store, NULL, 0, 0};
    EastThread thread;
    CHECK(east_thread_start(&thread, host_serve, &host), "the host did not start");
    EastValue *lazy = east_beast2_open_manifest_dir(path, manifest, type, true);
    CHECK(lazy && lazy->kind == EAST_VAL_PAGED, "the directory did not open lazily: %s",
          east_builtin_get_error());
    if (lazy) {
        EastValue *key = east_string("k0031415");
        EastValue *value = NULL;
        CHECK(east_beast2_pages_get_key(lazy->data.paged.pages, key, &value) == 1 && value &&
                  value->data.integer == 31415,
              "a keyed read of the fetched directory missed: %s", east_builtin_get_error());
        if (value) east_value_release(value);
        east_value_release(key);
        east_value_release(lazy);
    }
    __atomic_store_n(&host.stop, 1, __ATOMIC_RELEASE);
    east_thread_join(thread);
    CHECK(host.placed == 1, "a keyed read asked for %d segments, not the one it lands in",
          host.placed);

    Host refusing = {segment_dir, store, "the store is throttling", 0, 0};
    CHECK(east_thread_start(&thread, host_serve, &refusing), "the refusing host did not start");
    CHECK(east_beast2_decode_manifest_dir(path, manifest, type, false) == NULL,
          "a directory whose host refused a segment decoded");
    char *err = east_builtin_get_error();
    CHECK(err && strstr(err, "cannot be placed: the store is throttling"),
          "the refusal was reported as: %s", err ? err : "nothing");
    free(err);
    __atomic_store_n(&refusing.stop, 1, __ATOMIC_RELEASE);
    east_thread_join(thread);

    unsetenv(EAST_BEAST2_FETCH_SEGMENTS_ENV);
    CHECK(east_beast2_decode_manifest_dir(path, manifest, type, false) == NULL,
          "a directory missing its segments decoded with no host placing them");
    err = east_builtin_get_error();
    CHECK(err && strstr(err, "cannot be read"), "the missing segment was reported as: %s",
          err ? err : "nothing");
    free(err);

    /* Everything back where the directory's removal finds it. */
    for (size_t i = 0; i < n; i++) {
        EastValue *hash = entry_hash(manifest, i);
        object_path(object, sizeof(object), path, hash->data.string.data, hash->data.string.len);
        snprintf(moved, sizeof(moved), "%s/%.64s.beast2", store, hash->data.string.data);
        remove(object);
        rename(moved, object);
        char asked[600];
        snprintf(asked, sizeof(asked), "%s.want", object);
        remove(asked);
        snprintf(asked, sizeof(asked), "%s.error", object);
        remove(asked);
    }
    rmdir(store);
    remove_dir(path);
    east_value_release(manifest);
    east_value_release(dict);
}

/* ----- a sink that refuses ------------------------------------------------ */

typedef struct {
    size_t objects;
    size_t refuse_at; /* the object refused, counting the header as 0 */
    bool manifest_written;
} Refusing;

static bool refusing_object(void *ctx, const char *hash, const uint8_t *bytes, size_t len)
{
    (void)hash;
    (void)bytes;
    (void)len;
    Refusing *r = ctx;
    if (r->objects++ == r->refuse_at) {
        east_builtin_error("test: the store is full");
        return false;
    }
    return true;
}

static bool refusing_manifest(void *ctx, const uint8_t *bytes, size_t len)
{
    (void)bytes;
    (void)len;
    ((Refusing *)ctx)->manifest_written = true;
    return true;
}

/* A segment the sink refuses fails the write, and no manifest is written. */
static void test_refused_segment(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict(type, 50000);
    Refusing r = {0, 3, false};
    Beast2ManifestSink sink = {&r, refusing_object, refusing_manifest};
    Beast2ManifestWriter *w =
        east_beast2_manifest_writer_new(type, EAST_BEAST2_CODEC_DEFLATE, &sink);
    bool ok = w != NULL;
    for (size_t i = 0; ok && i < east_dict_len(dict); i++)
        ok = east_beast2_manifest_writer_add_pair(w, east_dict_key_at(dict, i),
                                                  east_dict_val_at(dict, i));
    char *err = east_builtin_get_error();
    CHECK(!ok && err && strcmp(err, "test: the store is full") == 0, "the refusal surfaced as: %s",
          err ? err : "nothing");
    free(err);
    CHECK(w && !east_beast2_manifest_writer_add_pair(w, east_dict_key_at(dict, 0),
                                                     east_dict_val_at(dict, 0)),
          "the writer took an element after a refused segment");
    free(east_builtin_get_error());
    CHECK(w && !east_beast2_manifest_writer_finish(w) && !r.manifest_written,
          "a failed writer wrote its manifest");
    free(east_builtin_get_error());
    east_beast2_manifest_writer_free(w);
    east_value_release(dict);
}

int main(void)
{
    east_type_of_type_init();
    BuiltinRegistry *builtins = builtin_registry_new();
    east_register_all_builtins(builtins);
    PlatformRegistry *platform = platform_registry_new();
    east_set_thread_context(platform, builtins);

    snprintf(g_dir, sizeof(g_dir), "manifest_gate_XXXXXX");
    if (!mkdtemp(g_dir)) {
        fprintf(stderr, "cannot create a scratch directory\n");
        return 1;
    }
    test_parity_directories();
    test_read_back();
    test_recognition();
    test_merge();
    test_fetched_segments();
    test_refused_segment();
    rmdir(g_dir);

    platform_registry_free(platform);
    builtin_registry_free(builtins);
    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 manifests: all checks passed\n");
    return 0;
}
