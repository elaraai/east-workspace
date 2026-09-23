/*
 * The content-defined segment boundary, pinned across runtimes.
 *
 * Segments of a collection must fall at the same elements here, in TypeScript
 * (`east/src/serialization/beast2/v5/boundary.spec.ts`) and in east-py, which
 * binds this writer — that is the whole claim the segment-object layout rests
 * on: equal values produce equal segment sets, so a state shares every segment
 * a write did not touch, and a manifest maintained by one runtime equals the
 * one another rebuilds.
 *
 * The parity fixtures are a 50,000-key `Dict<String, Integer>`, a 50,000-
 * element `Set<String>` and a 50,000-element `Array<String>`, and what is
 * compared is the segment count and a digest of the per-segment element
 * counts — compact, exact, and the same string on both sides. The expected
 * digests are the TypeScript writer's, so a divergence in either direction
 * fails here.
 */

#include <east/compat.h>
#include <east/east.h>
#include <east/serialization.h>

#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
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

/* The TypeScript writer's segmentation of the fixtures below: the segment
 * count, and fnv1a64 over the per-segment counts joined with ','. */
#define DICT_SEGMENTS 38
#define DICT_COUNTS_DIGEST "2d1d1a2f011d367d"
#define SET_SEGMENTS 44
#define SET_COUNTS_DIGEST "617fc98188343a6a"
#define ARRAY_SEGMENTS 43
#define ARRAY_COUNTS_DIGEST "4b14a976ccd91c65"

/* The reference vectors every FNV-1a 64 implementation agrees on. */
static void test_hash_vectors(void)
{
    CHECK(east_beast2_fnv1a64((const uint8_t *)"", 0) == 0xcbf29ce484222325ULL,
          "fnv1a64(\"\") is wrong");
    CHECK(east_beast2_fnv1a64((const uint8_t *)"a", 1) == 0xaf63dc4c8601ec8cULL,
          "fnv1a64(\"a\") is wrong");
    CHECK(east_beast2_fnv1a64((const uint8_t *)"foobar", 6) == 0x85944171f73967e8ULL,
          "fnv1a64(\"foobar\") is wrong");
}

/* The boundary hash's vectors, pinned in the TypeScript spec as well. */
static void test_boundary_hash_vectors(void)
{
    CHECK(east_beast2_segment_boundary_hash((const uint8_t *)"", 0) == 0x2c773e2cu,
          "boundary hash of \"\" is wrong");
    CHECK(east_beast2_segment_boundary_hash((const uint8_t *)"a", 1) == 0xa3eabd3fu,
          "boundary hash of \"a\" is wrong");
    CHECK(east_beast2_segment_boundary_hash((const uint8_t *)"foobar", 6) == 0x1f341994u,
          "boundary hash of \"foobar\" is wrong");
    CHECK(east_beast2_segment_boundary_hash((const uint8_t *)"k0000000", 8) == 0xc8ca7941u,
          "boundary hash of \"k0000000\" is wrong");
}

static void test_threshold(void)
{
    /* One narrow element in the target count is the base: a quarter of it
     * short of the target, four times it past. */
    uint32_t narrow = (uint32_t)(((uint64_t)1 << 32) / EAST_BEAST2_SEGMENT_TARGET_COUNT);
    CHECK(east_beast2_segment_is_boundary(narrow / 4 - 1, EAST_BEAST2_SEGMENT_MIN_COUNT,
                                          16 * EAST_BEAST2_SEGMENT_MIN_COUNT),
          "short of the target, the narrow threshold admits one below a quarter of it");
    CHECK(!east_beast2_segment_is_boundary(narrow / 4, EAST_BEAST2_SEGMENT_MIN_COUNT,
                                           16 * EAST_BEAST2_SEGMENT_MIN_COUNT),
          "short of the target, the narrow threshold refuses a quarter of itself");
    CHECK(east_beast2_segment_is_boundary(narrow * 4 - 1, EAST_BEAST2_SEGMENT_TARGET_COUNT,
                                          16 * EAST_BEAST2_SEGMENT_TARGET_COUNT),
          "past the target, the narrow threshold admits one below four times it");
    CHECK(!east_beast2_segment_is_boundary(narrow * 4, EAST_BEAST2_SEGMENT_TARGET_COUNT,
                                           16 * EAST_BEAST2_SEGMENT_TARGET_COUNT),
          "past the target, the narrow threshold refuses four times itself");

    /* An average of 64 KiB is one sixteenth of the byte target: a quarter of
     * that short of the target, four times it once the segment holds 1 MiB. */
    uint32_t wide = (uint32_t)(((uint64_t)1 << 32) / 16);
    CHECK(east_beast2_segment_is_boundary(wide / 4 - 1, 2, 2 * 64 * 1024),
          "the wide threshold admits one below a quarter of it");
    CHECK(!east_beast2_segment_is_boundary(wide / 4, 2, 2 * 64 * 1024),
          "the wide threshold refuses a quarter of itself");
    CHECK(east_beast2_segment_is_boundary(wide * 4 - 1, 16, 16 * 64 * 1024),
          "past the byte target, the wide threshold admits one below four times it");
    CHECK(!east_beast2_segment_is_boundary(wide * 4, 16, 16 * 64 * 1024),
          "past the byte target, the wide threshold refuses four times itself");

    /* At an average of the byte target every element is a boundary. */
    CHECK(east_beast2_segment_is_boundary(0xffffffffu, 1, EAST_BEAST2_SEGMENT_TARGET_BYTES),
          "an element of the byte target is always a boundary");
    CHECK(!east_beast2_segment_is_boundary(0xffffffffu, 1, EAST_BEAST2_SEGMENT_TARGET_BYTES - 1),
          "an element just below the byte target is not always a boundary");
}

static void test_rule_bounds(void)
{
    /* No threshold admits the empty input's hash at the maximum count, so
     * only the bound can cut there. */
    uint32_t never = east_beast2_segment_boundary_hash(NULL, 0);
    CHECK(!east_beast2_segment_is_boundary(never, EAST_BEAST2_SEGMENT_MAX_COUNT,
                                           EAST_BEAST2_SEGMENT_MAX_COUNT),
          "the empty input's hash is a boundary");
    CHECK(east_beast2_starts_segment_after(EAST_BEAST2_SEGMENT_MAX_COUNT, 1, NULL, 0),
          "the maximum count does not force a cut");
    CHECK(!east_beast2_starts_segment_after(EAST_BEAST2_SEGMENT_MAX_COUNT - 1,
                                            EAST_BEAST2_SEGMENT_MAX_COUNT - 1, NULL, 0),
          "a cut below the maximum count without a boundary hash");
    CHECK(east_beast2_starts_segment_after(1, EAST_BEAST2_SEGMENT_MAX_BYTES, NULL, 0),
          "the maximum bytes do not force a cut");

    /* Below both minimums the hash is not consulted: the first `k0000000`-
     * style key whose fence passes the narrow threshold still starts no
     * segment there, and does once the open segment holds the minimum bytes. */
    ByteBuffer *fence = NULL;
    for (int i = 0; !fence; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07d", i);
        EastValue *key = east_string(buf);
        ByteBuffer *candidate = east_beast2_encode_fence(key, &east_string_type);
        east_value_release(key);
        if (!candidate) break;
        uint32_t hash = east_beast2_segment_boundary_hash(candidate->data, candidate->len);
        if (east_beast2_segment_is_boundary(hash, 1, 1))
            fence = candidate;
        else
            byte_buffer_free(candidate);
    }
    CHECK(fence != NULL, "fence encode failed");
    if (fence) {
        CHECK(!east_beast2_starts_segment_after(1, 1, fence->data, fence->len),
              "a boundary hash below the minimum started a segment");
        CHECK(east_beast2_starts_segment_after(1, EAST_BEAST2_SEGMENT_MIN_BYTES, fence->data,
                                               fence->len),
              "a boundary hash at the minimum bytes did not start a segment");
        byte_buffer_free(fence);
    }
}

/* The per-segment counts of a blob, and fnv1a64 over them joined with ',' —
 * the parity digest. Every segment but the last must sit inside the bounds;
 * these fixtures are narrow, so the count bound is the one that binds. */
static bool counts_digest(const uint8_t *blob, size_t len, char *out, size_t outlen,
                          size_t *segment_count)
{
    Beast2SpliceExtents *ext = east_beast2_splice_extents(blob, len);
    if (!ext) {
        fprintf(stderr, "FAIL: %s\n", east_builtin_get_error());
        return false;
    }
    char *joined = malloc(ext->segment_count * 12 + 1);
    if (!joined) {
        east_beast2_splice_extents_free(ext);
        return false;
    }
    size_t at = 0;
    for (size_t i = 0; i < ext->segment_count; i++) {
        at += (size_t)snprintf(joined + at, ext->segment_count * 12 + 1 - at, "%s%zu",
                               i == 0 ? "" : ",", ext->counts[i]);
        if (i + 1 < ext->segment_count) {
            CHECK(ext->counts[i] >= EAST_BEAST2_SEGMENT_MIN_COUNT &&
                      ext->counts[i] <= EAST_BEAST2_SEGMENT_MAX_COUNT,
                  "segment %zu holds %zu elements, outside [%d, %d]", i, ext->counts[i],
                  EAST_BEAST2_SEGMENT_MIN_COUNT, EAST_BEAST2_SEGMENT_MAX_COUNT);
        }
    }
    snprintf(out, outlen, "%016" PRIx64, east_beast2_fnv1a64((const uint8_t *)joined, at));
    *segment_count = ext->segment_count;
    free(joined);
    east_beast2_splice_extents_free(ext);
    return true;
}

/* Encodes `value` through the paged encoder and checks its segmentation
 * against the TypeScript writer's. */
static void check_parity(const char *what, EastValue *value, EastType *type, size_t segments,
                         const char *digest)
{
    ByteBuffer *blob = east_beast2_encode_paged(value, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(blob != NULL, "%s: paged encode failed: %s", what, east_builtin_get_error());
    if (!blob) return;
    char got[32];
    size_t got_segments = 0;
    if (counts_digest(blob->data, blob->len, got, sizeof(got), &got_segments)) {
        CHECK(got_segments == segments && strcmp(got, digest) == 0,
              "%s segmentation diverges from TypeScript: %zu segments, digest %s (expected %zu, "
              "%s)",
              what, got_segments, got, segments, digest);
    }
    byte_buffer_free(blob);
}

/* 50,000 `k0000000`-style keys to their index. */
static EastValue *parity_dict(void)
{
    EastValue *dict = east_dict_new(&east_string_type, &east_integer_type);
    for (int i = 0; i < 50000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07d", i);
        EastValue *k = east_string(buf);
        EastValue *v = east_integer(i);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }
    return dict;
}

static void test_dict_parity(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict();
    check_parity("Dict", dict, type, DICT_SEGMENTS, DICT_COUNTS_DIGEST);
    east_value_release(dict);
    east_type_release(type);
}

static void test_set_parity(void)
{
    EastType *type = east_set_type(&east_string_type);
    EastValue *set = east_set_new(&east_string_type);
    for (int i = 0; i < 50000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "e%07d", i);
        EastValue *e = east_string(buf);
        east_set_insert(set, e);
        east_value_release(e);
    }
    check_parity("Set", set, type, SET_SEGMENTS, SET_COUNTS_DIGEST);
    east_value_release(set);
    east_type_release(type);
}

static void test_array_parity(void)
{
    EastType *type = east_array_type(&east_string_type);
    EastValue *array = east_array_new(&east_string_type);
    for (int i = 0; i < 50000; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "a%07d", i);
        EastValue *e = east_string(buf);
        east_array_push(array, e);
        east_value_release(e);
    }
    check_parity("Array", array, type, ARRAY_SEGMENTS, ARRAY_COUNTS_DIGEST);
    east_value_release(array);
    east_type_release(type);
}

/* east_beast2_segment_starts names the elements the writer cuts at. */
static void test_segment_starts(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict();
    size_t starts[64];
    size_t n = east_beast2_segment_starts(dict, type, starts, 64);
    CHECK(n == DICT_SEGMENTS - 1, "%zu segment starts, expected %d", n, DICT_SEGMENTS - 1);
    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE);
    Beast2SpliceExtents *ext = blob ? east_beast2_splice_extents(blob->data, blob->len) : NULL;
    CHECK(ext != NULL, "encode or extents failed: %s", east_builtin_get_error());
    if (ext && n == ext->segment_count - 1) {
        size_t at = 0;
        for (size_t i = 0; i < n; i++) {
            at += ext->counts[i];
            CHECK(starts[i] == at, "segment %zu starts at %zu, the writer cut at %zu", i + 1,
                  starts[i], at);
        }
    }
    CHECK(east_beast2_segment_starts(dict, type, starts, 2) == SIZE_MAX,
          "a short start buffer is not refused");
    free(east_builtin_get_error());
    if (ext) east_beast2_splice_extents_free(ext);
    if (blob) byte_buffer_free(blob);
    east_value_release(dict);
    east_type_release(type);
}

/* Segmentation is a pure function of the value: the same Dict built by
 * inserting in reverse order encodes to the same bytes. */
static void test_insertion_order_independence(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);

    ByteBuffer *blobs[2] = {NULL, NULL};
    for (int pass = 0; pass < 2; pass++) {
        EastValue *dict = east_dict_new(&east_string_type, &east_integer_type);
        for (int n = 0; n < 20000; n++) {
            int i = pass == 0 ? n : 19999 - n;
            char buf[16];
            snprintf(buf, sizeof(buf), "k%07d", i);
            EastValue *k = east_string(buf);
            EastValue *v = east_integer(i);
            east_dict_set(dict, k, v);
            east_value_release(k);
            east_value_release(v);
        }
        blobs[pass] = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE);
        east_value_release(dict);
    }

    CHECK(blobs[0] && blobs[1], "paged encode failed: %s", east_builtin_get_error());
    if (blobs[0] && blobs[1]) {
        CHECK(blobs[0]->len == blobs[1]->len &&
                  memcmp(blobs[0]->data, blobs[1]->data, blobs[0]->len) == 0,
              "insertion order changed the encoding (%zu vs %zu bytes)", blobs[0]->len,
              blobs[1]->len);
    }
    if (blobs[0]) byte_buffer_free(blobs[0]);
    if (blobs[1]) byte_buffer_free(blobs[1]);

    east_type_release(type);
}

/* A collection below the minimum is one segment, whatever its keys hash to. */
static void test_short_collection(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = east_dict_new(&east_string_type, &east_integer_type);
    for (int i = 0; i < EAST_BEAST2_SEGMENT_MIN_COUNT - 1; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07d", i);
        EastValue *k = east_string(buf);
        EastValue *v = east_integer(i);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }

    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE);
    CHECK(blob != NULL, "paged encode failed: %s", east_builtin_get_error());
    if (blob) {
        Beast2SpliceExtents *ext = east_beast2_splice_extents(blob->data, blob->len);
        CHECK(ext != NULL, "extents failed: %s", east_builtin_get_error());
        if (ext) {
            CHECK(ext->segment_count == 1, "a short dict is %zu segments, not 1",
                  ext->segment_count);
            east_beast2_splice_extents_free(ext);
        }
        byte_buffer_free(blob);
    }

    east_value_release(dict);
    east_type_release(type);
}

/* Drains a finished element writer. */
static ByteBuffer *finish_writer(Beast2ElementWriter *w)
{
    bool ok = east_beast2_element_writer_finish(w);
    ByteBuffer *out = ok ? east_beast2_element_writer_take(w) : NULL;
    east_beast2_element_writer_free(w);
    return out;
}

/* Elements handed over already encoded write the same bytes as the values. */
static void test_element_writer_encoded(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    EastValue *dict = parity_dict();
    Beast2ElementWriter *a = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_DEFLATE);
    Beast2ElementWriter *b = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_DEFLATE);
    bool ok = a && b;
    ByteBuffer *element = byte_buffer_new(64);
    for (size_t i = 0; ok && i < east_dict_len(dict); i++) {
        EastValue *k = east_dict_key_at(dict, i);
        EastValue *v = east_dict_val_at(dict, i);
        ok = east_beast2_element_writer_add_pair(a, k, v);
        ByteBuffer *kb = east_beast2_encode_fence(k, &east_string_type);
        ByteBuffer *vb = east_beast2_encode_fence(v, &east_integer_type);
        element->len = 0;
        byte_buffer_write_bytes(element, kb->data, kb->len);
        byte_buffer_write_bytes(element, vb->data, vb->len);
        ok = ok && east_beast2_element_writer_add_encoded(b, element->data, element->len, kb->len);
        byte_buffer_free(kb);
        byte_buffer_free(vb);
    }
    byte_buffer_free(element);
    CHECK(ok, "adding failed: %s", east_builtin_get_error());
    ByteBuffer *from_values = a ? finish_writer(a) : NULL;
    ByteBuffer *from_bytes = b ? finish_writer(b) : NULL;
    CHECK(from_values && from_bytes && from_values->len == from_bytes->len &&
              memcmp(from_values->data, from_bytes->data, from_values->len) == 0,
          "encoded elements wrote different bytes");
    if (from_values) byte_buffer_free(from_values);
    if (from_bytes) byte_buffer_free(from_bytes);
    east_value_release(dict);
    east_type_release(type);
}

/* A key that does not ascend is refused, and the writer carries on. */
static void test_element_writer_ascent(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
    Beast2ElementWriter *w = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_NONE);
    EastValue *a = east_string("a"), *b = east_string("b"), *c = east_string("c");
    EastValue *one = east_integer(1);
    CHECK(east_beast2_element_writer_add_pair(w, b, one), "the first key was refused");
    CHECK(!east_beast2_element_writer_add_pair(w, a, one), "a descending key was accepted");
    char *err = east_builtin_get_error();
    CHECK(err && strstr(err, "strictly ascending"), "the refusal says %s", err ? err : "nothing");
    free(err);
    CHECK(!east_beast2_element_writer_add_pair(w, b, one), "an equal key was accepted");
    free(east_builtin_get_error());
    CHECK(east_beast2_element_writer_add_pair(w, c, one), "an ascending key was refused");
    ByteBuffer *blob = finish_writer(w);
    EastValue *decoded = blob ? east_beast2_decode_full(blob->data, blob->len, type) : NULL;
    CHECK(decoded && east_dict_len(decoded) == 2, "the blob does not hold the two keys added");
    if (decoded) east_value_release(decoded);
    if (blob) byte_buffer_free(blob);
    east_value_release(a);
    east_value_release(b);
    east_value_release(c);
    east_value_release(one);
    east_type_release(type);
}

/* An element that fails to encode leaves the writer as it was. */
static void test_element_writer_rollback(void)
{
    const char *names[2] = {"a", "b"};
    EastType *cases[2] = {&east_integer_type, &east_null_type};
    EastType *variant = east_variant_type(names, cases, 2);
    EastType *type = east_dict_type(&east_string_type, variant);
    EastValue *k1 = east_string("k1"), *k2 = east_string("k2");
    EastValue *one = east_integer(1);
    EastValue *good = east_variant_new("a", one, variant);
    EastValue *bad = east_variant_new("zzz", east_null(), variant);

    Beast2ElementWriter *w = east_beast2_element_writer_new(type, EAST_BEAST2_CODEC_NONE);
    CHECK(east_beast2_element_writer_add_pair(w, k1, good), "a good entry was refused");
    CHECK(!east_beast2_element_writer_add_pair(w, k2, bad), "an unencodable entry was accepted");
    free(east_builtin_get_error());
    CHECK(east_beast2_element_writer_add_pair(w, k2, good), "the writer refused after a failure");
    ByteBuffer *blob = finish_writer(w);
    EastValue *decoded = blob ? east_beast2_decode_full(blob->data, blob->len, type) : NULL;
    CHECK(decoded && east_dict_len(decoded) == 2, "the blob does not hold the two good entries");
    if (decoded) east_value_release(decoded);
    if (blob) byte_buffer_free(blob);
    east_value_release(bad);
    east_value_release(good);
    east_value_release(one);
    east_value_release(k1);
    east_value_release(k2);
    east_type_release(type);
    east_type_release(variant);
}

int main(void)
{
    test_hash_vectors();
    test_boundary_hash_vectors();
    test_threshold();
    test_rule_bounds();
    test_dict_parity();
    test_set_parity();
    test_array_parity();
    test_segment_starts();
    test_insertion_order_independence();
    test_short_collection();
    test_element_writer_encoded();
    test_element_writer_ascent();
    test_element_writer_rollback();

    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 boundary: all checks passed\n");
    return 0;
}
