/*
 * The content-defined segment boundary, pinned across runtimes.
 *
 * Segments of a Set or Dict must fall at the same keys here, in TypeScript
 * (`east/src/serialization/beast2/v5/boundary.spec.ts`) and in east-py, which
 * binds this encoder — that is the whole claim the segment-object layout rests
 * on: equal values produce equal segment sets, so a state shares every segment
 * a write did not touch, and a manifest maintained by one runtime equals the
 * one another rebuilds.
 *
 * The parity fixture is a 50,000-key `Dict<String, Integer>` and a 50,000-
 * element `Set<String>`, and what is compared is a digest of the per-segment
 * element counts — compact, exact, and the same string on both sides. The
 * expected digests are the TypeScript encoder's, so a divergence in either
 * direction fails here.
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

/* The rule's pinned bounds, mirrored from internal_v5.h (private to the
 * implementation) so a change to either side shows up as a failure here. */
#define SEGMENT_MIN_COUNT 256
#define SEGMENT_MAX_COUNT 4096

/* The digests the TypeScript encoder produces for the fixtures below:
 * fnv1a64 over the per-segment counts, joined with ','. */
#define DICT_COUNTS_DIGEST "20251373dc14fe4e"
#define SET_COUNTS_DIGEST "cb54163306a3a43d"

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

/* fnv1a64 over the per-segment counts joined with ',' — the parity digest. */
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
        /* Every segment but the last must sit inside the pinned bounds. */
        if (i + 1 < ext->segment_count) {
            CHECK(ext->counts[i] >= SEGMENT_MIN_COUNT && ext->counts[i] <= SEGMENT_MAX_COUNT,
                  "segment %zu holds %zu elements, outside [%d, %d]", i, ext->counts[i],
                  SEGMENT_MIN_COUNT, SEGMENT_MAX_COUNT);
        }
    }
    snprintf(out, outlen, "%016" PRIx64, east_beast2_fnv1a64((const uint8_t *)joined, at));
    *segment_count = ext->segment_count;
    free(joined);
    east_beast2_splice_extents_free(ext);
    return true;
}

/* The 50,000-entry `Dict<String, Integer>` both sides cut. */
static void test_dict_parity(void)
{
    EastType *type = east_dict_type(&east_string_type, &east_integer_type);
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

    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE, 0);
    CHECK(blob != NULL, "paged encode failed: %s", east_builtin_get_error());
    if (blob) {
        char digest[32];
        size_t segments = 0;
        if (counts_digest(blob->data, blob->len, digest, sizeof(digest), &segments)) {
            CHECK(strcmp(digest, DICT_COUNTS_DIGEST) == 0,
                  "Dict segmentation diverges from TypeScript: %zu segments, digest %s "
                  "(expected %s)",
                  segments, digest, DICT_COUNTS_DIGEST);
        }
        byte_buffer_free(blob);
    }

    east_value_release(dict);
    east_type_release(type);
}

/* The 50,000-element `Set<String>` both sides cut. */
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

    ByteBuffer *blob = east_beast2_encode_paged(set, type, EAST_BEAST2_CODEC_DEFLATE, 0);
    CHECK(blob != NULL, "paged encode failed: %s", east_builtin_get_error());
    if (blob) {
        char digest[32];
        size_t segments = 0;
        if (counts_digest(blob->data, blob->len, digest, sizeof(digest), &segments)) {
            CHECK(strcmp(digest, SET_COUNTS_DIGEST) == 0,
                  "Set segmentation diverges from TypeScript: %zu segments, digest %s "
                  "(expected %s)",
                  segments, digest, SET_COUNTS_DIGEST);
        }
        byte_buffer_free(blob);
    }

    east_value_release(set);
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
        blobs[pass] = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE, 0);
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
    for (int i = 0; i < SEGMENT_MIN_COUNT - 1; i++) {
        char buf[16];
        snprintf(buf, sizeof(buf), "k%07d", i);
        EastValue *k = east_string(buf);
        EastValue *v = east_integer(i);
        east_dict_set(dict, k, v);
        east_value_release(k);
        east_value_release(v);
    }

    ByteBuffer *blob = east_beast2_encode_paged(dict, type, EAST_BEAST2_CODEC_DEFLATE, 0);
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

int main(void)
{
    test_hash_vectors();
    test_dict_parity();
    test_set_parity();
    test_insertion_order_independence();
    test_short_collection();

    if (failures > 0) {
        fprintf(stderr, "%d check(s) failed\n", failures);
        return 1;
    }
    printf("beast2 boundary: all checks passed\n");
    return 0;
}
