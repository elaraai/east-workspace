/*
 * CLI merge gate (issue #770).
 *
 * Spawns the built `east-c` binary over checked-in sorted Set/Dict blobs
 * (tests/fixtures, written by the TS paged writer through
 * tests/generate_fixtures.mjs) and pins the blob merge:
 *
 *   1. dict merge    — `merge --merge concat -i a -i b -i c`: keys shared
 *                      across the inputs fold in input order, and the output
 *                      is byte-identical to `run --emit dict` over the folded
 *                      sequence emitted ascending; the -v account;
 *   2. set union     — `merge --union` over the Set twins: the distinct
 *                      elements' bytes; the -v account;
 *   3. duplicate     — a shared key without a fold: exit 1, the canonical
 *                      duplicate-key message, no index in the output;
 *   4. refusals      — an input of another type, an Array input, a fold of
 *                      the wrong signature, --merge on a Set, --union on a
 *                      Dict, an input whose keys descend: exit 1 with the
 *                      message naming the input;
 *   5. empty inputs  — an empty input among others contributes nothing; a
 *                      lone empty input yields the empty collection, indexed;
 *   6. key ranges    — `--range` over bounds inside segments, open on one
 *                      side, open on both (the whole merge's bytes), and
 *                      holding nothing; the fold and the union over a range
 *                      are byte-identical to `run --emit` over the range's
 *                      entries; bounds of another key type are refused;
 *   7. not a blob    — an empty file or a file without the magic, as an
 *                      input or as the range, is refused in the reader's
 *                      own words (the sentence east-node and east-py give
 *                      for the same bytes); a missing file cannot be opened;
 *                      a blob without the paging index is refused too.
 *
 * Runs in the ASan tree too: every case scans the child's stderr for a
 * sanitizer report.
 */
#include <east/east.h>
#include <east/type_of_type.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef _WIN32
#include <sys/wait.h>
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

static uint8_t *read_file(const char *path, size_t *out_len)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc(len > 0 ? (size_t)len : 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    *out_len = rd;
    return buf;
}

/* A whole file as a NUL-terminated string, or NULL when it cannot be read. */
static char *read_text(const char *path)
{
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    if (!data) return NULL;
    uint8_t *text = realloc(data, len + 1);
    if (!text) {
        free(data);
        return NULL;
    }
    text[len] = '\0';
    return (char *)text;
}

/* Runs one CLI invocation with stderr captured to `err_path`; returns the
 * child's exit code (-1 on spawn failure) and fails the gate if the child's
 * stderr carries a sanitizer report. */
static int run_cli(const char *cmdline, const char *err_path)
{
    char full[4096];
#ifdef _WIN32
    snprintf(full, sizeof(full), "\"%s 2> \"%s\"\"", cmdline, err_path);
#else
    snprintf(full, sizeof(full), "%s 2> \"%s\"", cmdline, err_path);
#endif
    int rc = system(full);
#ifndef _WIN32
    rc = rc == -1 ? -1 : WEXITSTATUS(rc);
#endif
    char *err = read_text(err_path);
    if (err) {
        CHECK(strstr(err, "AddressSanitizer") == NULL && strstr(err, "LeakSanitizer") == NULL,
              "sanitizer report in CLI stderr:\n%s", err);
        free(err);
    }
    return rc;
}

static void check_stderr_contains(const char *err_path, const char *needle)
{
    char *err = read_text(err_path);
    CHECK(err != NULL, "cannot read %s", err_path);
    if (!err) return;
    CHECK(strstr(err, needle) != NULL, "stderr missing \"%s\"; got:\n%s", needle, err);
    free(err);
}

static bool same_bytes(const char *path_a, const char *path_b)
{
    size_t len_a = 0, len_b = 0;
    uint8_t *a = read_file(path_a, &len_a);
    uint8_t *b = read_file(path_b, &len_b);
    bool same = a && b && len_a == len_b && memcmp(a, b, len_a) == 0;
    free(a);
    free(b);
    return same;
}

/* The element count of an indexed blob of `type`, or SIZE_MAX when it
 * carries no index. */
static size_t indexed_count(const char *path, EastType *type)
{
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    if (!data) return SIZE_MAX;
    Beast2Pages *pages = east_beast2_pages_new(data, len, type);
    size_t count = pages ? east_beast2_pages_element_count(pages) : SIZE_MAX;
    if (pages) east_beast2_pages_free(pages);
    free(east_builtin_get_error());
    free(data);
    return count;
}

static EastType *dict_type(void)
{
    return east_dict_type(&east_integer_type, &east_string_type);
}

static void test_dict_merge(const char *bin, const char *fixtures)
{
    char cmd[4096];
    snprintf(
        cmd, sizeof(cmd),
        "\"%s\" run \"%s/merge_expected_dict.beast2\" --emit dict -o merge_out_expected.beast2",
        bin, fixtures);
    int rc = run_cli(cmd, "merge_err_expected.txt");
    CHECK(rc == 0, "dict merge: the expected control exited %d", rc);

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" -i \"%s/merge_in_a.beast2\" "
             "-i \"%s/merge_in_b.beast2\" -i \"%s/merge_in_c.beast2\" -o merge_out_dict.beast2 -v",
             bin, fixtures, fixtures, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_dict.txt");
    CHECK(rc == 0, "dict merge: expected exit 0, got %d", rc);
    if (rc != 0) return;
    CHECK(same_bytes("merge_out_expected.beast2", "merge_out_dict.beast2"),
          "dict merge: not byte-identical to `run --emit dict` over the folded sequence");
    check_stderr_contains("merge_err_dict.txt", "merge: 3 input(s), 31 entries, 13 fold(s)");

    size_t len = 0;
    uint8_t *data = read_file("merge_out_dict.beast2", &len);
    EastValue *dict = data ? east_beast2_decode_full(data, len, dict_type()) : NULL;
    CHECK(dict != NULL && dict->data.dict.len == 31, "dict merge: decode failed or wrong size");
    if (dict) {
        EastValue *key = east_integer(15);
        EastValue *v = east_dict_get(dict, key); /* borrowed */
        CHECK(v != NULL && strcmp(v->data.string.data, "a15b15c15") == 0,
              "dict merge: key 15 folded to %s", v ? v->data.string.data : "?");
        east_value_release(key);
        key = east_integer(40);
        v = east_dict_get(dict, key);
        CHECK(v != NULL && strcmp(v->data.string.data, "c40") == 0, "dict merge: key 40 wrong");
        east_value_release(key);
        east_value_release(dict);
    }
    free(data);
}

static void test_set_union(const char *bin, const char *fixtures)
{
    char cmd[4096];
    snprintf(
        cmd, sizeof(cmd),
        "\"%s\" run \"%s/merge_expected_set.beast2\" --emit set -o merge_out_set_expected.beast2",
        bin, fixtures);
    int rc = run_cli(cmd, "merge_err_set_expected.txt");
    CHECK(rc == 0, "set union: the expected control exited %d", rc);

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --union -i \"%s/merge_set_a.beast2\" -i \"%s/merge_set_b.beast2\" "
             "-i \"%s/merge_set_c.beast2\" -o merge_out_set.beast2 -v",
             bin, fixtures, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_set.txt");
    CHECK(rc == 0, "set union: expected exit 0, got %d", rc);
    if (rc != 0) return;
    CHECK(same_bytes("merge_out_set_expected.beast2", "merge_out_set.beast2"),
          "set union: not byte-identical to `run --emit set` over the distinct elements");
    check_stderr_contains("merge_err_set.txt", "merge: 3 input(s), 31 entries, 13 fold(s)");
    CHECK(indexed_count("merge_out_set.beast2", east_set_type(&east_integer_type)) == 31,
          "set union: expected 31 indexed elements");
}

static void test_duplicate(const char *bin, const char *fixtures)
{
    char cmd[4096];
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i \"%s/merge_in_a.beast2\" -i \"%s/merge_in_b.beast2\" -o "
             "merge_out_duplicate.beast2",
             bin, fixtures, fixtures);
    int rc = run_cli(cmd, "merge_err_duplicate.txt");
    CHECK(rc == 1, "duplicate: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_duplicate.txt",
                          "beast2 v5: duplicate Dict key emitted: 10 — Dict keys must be unique");
    CHECK(indexed_count("merge_out_duplicate.beast2", dict_type()) == SIZE_MAX,
          "duplicate: the aborted output must carry no index");
}

static void test_refusals(const char *bin, const char *fixtures)
{
    char cmd[4096];
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" -i \"%s/merge_in_a.beast2\" "
             "-i \"%s/merge_mismatch.beast2\" -o merge_out_mismatch.beast2",
             bin, fixtures, fixtures, fixtures);
    int rc = run_cli(cmd, "merge_err_mismatch.txt");
    CHECK(rc == 1, "mismatch: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_mismatch.txt", "merge: input 1 (");
    check_stderr_contains("merge_err_mismatch.txt", ") has type ");
    check_stderr_contains("merge_err_mismatch.txt", ", expected ");
    check_stderr_contains("merge_err_mismatch.txt", " (input 0)");

    snprintf(cmd, sizeof(cmd), "\"%s\" merge -i \"%s/events.beast2\" -o merge_out_array.beast2",
             bin, fixtures);
    rc = run_cli(cmd, "merge_err_array.txt");
    CHECK(rc == 1, "array: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_array.txt",
                          "merge: inputs must be Set or Dict blobs, got Array");

    /* emit_fold.beast2 is (Array<Integer>, emit) -> Null: not a fold. */
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_fold.beast2\" -i \"%s/merge_in_a.beast2\" -o "
             "merge_out_badfold.beast2",
             bin, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_badfold.txt");
    CHECK(rc == 1, "bad fold: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_badfold.txt",
                          "--merge: expected a function (K, V, V) -> V matching the inputs "
                          "(K = .Integer, V = .String), got ");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" -i \"%s/merge_set_a.beast2\" "
             "-o merge_out_mergeset.beast2",
             bin, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_mergeset.txt");
    CHECK(rc == 1, "--merge on a Set: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_mergeset.txt", "--merge applies to Dict inputs only");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --union -i \"%s/merge_in_a.beast2\" -o merge_out_uniondict.beast2", bin,
             fixtures);
    rc = run_cli(cmd, "merge_err_uniondict.txt");
    CHECK(rc == 1, "--union on a Dict: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_uniondict.txt", "--union applies to Set inputs only");

    /* paged_corrupt.beast2 splices a high key range before a low one: the
     * reader's canonical-order error, prefixed with the input — the same
     * sentence east-node and east-py give. */
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i \"%s/paged_corrupt.beast2\" -o merge_out_descending.beast2", bin,
             fixtures);
    rc = run_cli(cmd, "merge_err_descending.txt");
    CHECK(rc == 1, "descending: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_descending.txt", "merge: input 0 (");
    check_stderr_contains(
        "merge_err_descending.txt",
        "paged_corrupt.beast2): beast2 v5: Dict keys are not strictly ascending in "
        "East order — the wire must hold the canonical value (corrupt or "
        "pre-contract blob)");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" --union -i "
             "\"%s/merge_in_a.beast2\" -o merge_out_both.beast2",
             bin, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_both.txt");
    CHECK(rc == 1, "both folds: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_both.txt", "--merge and --union are two folds");

    /* The merged blob is a beast2 stream, exactly as `run --emit` writes one:
     * the same rule, in the same words, on east-c, east-node and east-py. */
    snprintf(cmd, sizeof(cmd), "\"%s\" merge -i \"%s/merge_in_a.beast2\" -o merge_out.bin", bin,
             fixtures);
    rc = run_cli(cmd, "merge_err_ext.txt");
    CHECK(rc == 1, "non-beast2 output: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_ext.txt", "merge requires a .beast2 output file (-o)");

    snprintf(cmd, sizeof(cmd), "\"%s\" merge -o merge_out_none.beast2", bin);
    rc = run_cli(cmd, "merge_err_noinput.txt");
    CHECK(rc == 1, "no input: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_noinput.txt", "merge requires at least one -i input");

    snprintf(cmd, sizeof(cmd), "\"%s\" merge -i \"%s/merge_in_a.beast2\"", bin, fixtures);
    rc = run_cli(cmd, "merge_err_nooutput.txt");
    CHECK(rc == 1, "no output: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nooutput.txt", "merge requires -o FILE");
}

static void test_empty_inputs(const char *bin, const char *fixtures)
{
    char cmd[4096];
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" -i \"%s/merge_empty.beast2\" "
             "-i \"%s/merge_in_a.beast2\" -o merge_out_with_empty.beast2",
             bin, fixtures, fixtures, fixtures);
    int rc = run_cli(cmd, "merge_err_with_empty.txt");
    CHECK(rc == 0, "empty among others: expected exit 0, got %d", rc);
    snprintf(cmd, sizeof(cmd), "\"%s\" merge -i \"%s/merge_in_a.beast2\" -o merge_out_alone.beast2",
             bin, fixtures);
    rc = run_cli(cmd, "merge_err_alone.txt");
    CHECK(rc == 0, "lone input: expected exit 0, got %d", rc);
    CHECK(same_bytes("merge_out_with_empty.beast2", "merge_out_alone.beast2"),
          "empty among others: an empty input must contribute nothing");
    CHECK(indexed_count("merge_out_alone.beast2", dict_type()) == 20,
          "lone input: expected 20 indexed entries");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i \"%s/merge_empty.beast2\" -o merge_out_empty.beast2", bin, fixtures);
    rc = run_cli(cmd, "merge_err_empty.txt");
    CHECK(rc == 0, "lone empty input: expected exit 0, got %d", rc);
    CHECK(indexed_count("merge_out_empty.beast2", dict_type()) == 0,
          "lone empty input: expected the empty collection, indexed");
}

/* A merge of the three Dict inputs under the concatenating fold over the
 * range fixture `range`, into `out`; the child's exit code. */
static int merge_dict_range(const char *bin, const char *fixtures, const char *range,
                            const char *out, const char *err_path, bool verbose)
{
    char cmd[4096];
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" --range \"%s/%s\" "
             "-i \"%s/merge_in_a.beast2\" -i \"%s/merge_in_b.beast2\" -i \"%s/merge_in_c.beast2\" "
             "-o %s%s",
             bin, fixtures, fixtures, range, fixtures, fixtures, fixtures, out,
             verbose ? " -v" : "");
    return run_cli(cmd, err_path);
}

/* The value of `key` in the Dict blob at `path`, as a malloc'd string, or
 * NULL when absent or undecodable. */
static char *dict_value(const char *path, int64_t key)
{
    size_t len = 0;
    uint8_t *data = read_file(path, &len);
    EastValue *dict = data ? east_beast2_decode_full(data, len, dict_type()) : NULL;
    char *out = NULL;
    if (dict) {
        EastValue *k = east_integer(key);
        EastValue *v = east_dict_get(dict, k); /* borrowed */
        if (v) out = strdup(v->data.string.data);
        east_value_release(k);
        east_value_release(dict);
    }
    free(data);
    return out;
}

static void test_ranges(const char *bin, const char *fixtures)
{
    char cmd[4096];
    /* [7, 22): 7 is the last key of a's second segment, 22 the first of b's
     * fourth — the fold's entries in the range, byte-identical to the
     * control that emits them ascending. */
    snprintf(cmd, sizeof(cmd),
             "\"%s\" run \"%s/merge_expected_dict_7_22.beast2\" --emit dict -o "
             "merge_out_range_expected.beast2",
             bin, fixtures);
    int rc = run_cli(cmd, "merge_err_range_expected.txt");
    CHECK(rc == 0, "range [7, 22): the expected control exited %d", rc);
    rc = merge_dict_range(bin, fixtures, "merge_range_7_22.beast2", "merge_out_range_7_22.beast2",
                          "merge_err_range_7_22.txt", true);
    CHECK(rc == 0, "range [7, 22): expected exit 0, got %d", rc);
    if (rc == 0) {
        CHECK(same_bytes("merge_out_range_expected.beast2", "merge_out_range_7_22.beast2"),
              "range [7, 22): not byte-identical to `run --emit dict` over the range's entries");
        check_stderr_contains("merge_err_range_7_22.txt",
                              "merge: 3 input(s), 15 entries, 11 fold(s)");
        char *v = dict_value("merge_out_range_7_22.beast2", 15);
        CHECK(v && strcmp(v, "a15b15c15") == 0, "range [7, 22): key 15 folded to %s", v ? v : "?");
        free(v);
        CHECK(dict_value("merge_out_range_7_22.beast2", 6) == NULL,
              "range [7, 22): key 6 must be absent");
        CHECK(dict_value("merge_out_range_7_22.beast2", 22) == NULL,
              "range [7, 22): key 22 must be absent");
    }

    /* The same range over the Set twins under --union. */
    snprintf(cmd, sizeof(cmd),
             "\"%s\" run \"%s/merge_expected_set_7_22.beast2\" --emit set -o "
             "merge_out_range_set_expected.beast2",
             bin, fixtures);
    rc = run_cli(cmd, "merge_err_range_set_expected.txt");
    CHECK(rc == 0, "range [7, 22) union: the expected control exited %d", rc);
    snprintf(
        cmd, sizeof(cmd),
        "\"%s\" merge --union --range \"%s/merge_range_7_22.beast2\" -i \"%s/merge_set_a.beast2\" "
        "-i \"%s/merge_set_b.beast2\" -i \"%s/merge_set_c.beast2\" -o merge_out_range_set.beast2 "
        "-v",
        bin, fixtures, fixtures, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_range_set.txt");
    CHECK(rc == 0, "range [7, 22) union: expected exit 0, got %d", rc);
    if (rc == 0) {
        CHECK(same_bytes("merge_out_range_set_expected.beast2", "merge_out_range_set.beast2"),
              "range [7, 22) union: not byte-identical to `run --emit set` over the range's "
              "elements");
        check_stderr_contains("merge_err_range_set.txt",
                              "merge: 3 input(s), 15 entries, 11 fold(s)");
    }

    /* Open on both sides: the whole merge's bytes. */
    rc = merge_dict_range(bin, fixtures, "merge_range_open.beast2", "merge_out_range_open.beast2",
                          "merge_err_range_open.txt", false);
    CHECK(rc == 0, "open range: expected exit 0, got %d", rc);
    CHECK(rc != 0 || same_bytes("merge_out_dict.beast2", "merge_out_range_open.beast2"),
          "open range: must write the whole merge's bytes");

    /* Open on one side: (-inf, 12) and [25, +inf). */
    rc = merge_dict_range(bin, fixtures, "merge_range_to_12.beast2", "merge_out_range_to_12.beast2",
                          "merge_err_range_to_12.txt", true);
    CHECK(rc == 0, "range (-inf, 12): expected exit 0, got %d", rc);
    if (rc == 0) {
        check_stderr_contains("merge_err_range_to_12.txt",
                              "merge: 3 input(s), 12 entries, 3 fold(s)");
        char *v = dict_value("merge_out_range_to_12.beast2", 5);
        CHECK(v && strcmp(v, "a5c5") == 0, "range (-inf, 12): key 5 folded to %s", v ? v : "?");
        free(v);
        v = dict_value("merge_out_range_to_12.beast2", 11);
        CHECK(v && strcmp(v, "a11b11") == 0, "range (-inf, 12): key 11 folded to %s", v ? v : "?");
        free(v);
        CHECK(dict_value("merge_out_range_to_12.beast2", 12) == NULL,
              "range (-inf, 12): key 12 must be absent");
    }
    rc = merge_dict_range(bin, fixtures, "merge_range_from_25.beast2",
                          "merge_out_range_from_25.beast2", "merge_err_range_from_25.txt", true);
    CHECK(rc == 0, "range [25, +inf): expected exit 0, got %d", rc);
    if (rc == 0) {
        check_stderr_contains("merge_err_range_from_25.txt",
                              "merge: 3 input(s), 6 entries, 1 fold(s)");
        char *v = dict_value("merge_out_range_from_25.beast2", 25);
        CHECK(v && strcmp(v, "b25c25") == 0, "range [25, +inf): key 25 folded to %s", v ? v : "?");
        free(v);
        v = dict_value("merge_out_range_from_25.beast2", 40);
        CHECK(v && strcmp(v, "c40") == 0, "range [25, +inf): key 40 is %s", v ? v : "?");
        free(v);
        CHECK(dict_value("merge_out_range_from_25.beast2", 24) == NULL,
              "range [25, +inf): key 24 must be absent");
    }

    /* [30, 39) holds nothing: the empty collection, indexed. */
    rc = merge_dict_range(bin, fixtures, "merge_range_30_39.beast2", "merge_out_range_30_39.beast2",
                          "merge_err_range_30_39.txt", true);
    CHECK(rc == 0, "range [30, 39): expected exit 0, got %d", rc);
    if (rc == 0) {
        check_stderr_contains("merge_err_range_30_39.txt",
                              "merge: 3 input(s), 0 entries, 0 fold(s)");
        CHECK(indexed_count("merge_out_range_30_39.beast2", dict_type()) == 0,
              "range [30, 39): expected the empty collection, indexed");
    }

    /* Bounds over another key type, and a range file that does not exist. */
    rc = merge_dict_range(bin, fixtures, "merge_range_mismatch.beast2",
                          "merge_out_range_mismatch.beast2", "merge_err_range_mismatch.txt", false);
    CHECK(rc == 1, "range mismatch: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_range_mismatch.txt", "merge: --range (");
    check_stderr_contains("merge_err_range_mismatch.txt", "merge_range_mismatch.beast2) has type ");
    check_stderr_contains("merge_err_range_mismatch.txt", ", expected ");
    check_stderr_contains("merge_err_range_mismatch.txt", " (bounds over the inputs' key type)");
    rc = merge_dict_range(bin, fixtures, "merge_range_missing.beast2",
                          "merge_out_range_missing.beast2", "merge_err_range_missing.txt", false);
    CHECK(rc == 1, "range missing: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_range_missing.txt",
                          "merge_range_missing.beast2): cannot open the file");
}

/* Writes `len` bytes of `text` to `path`. */
static void write_file(const char *path, const char *text, size_t len)
{
    FILE *f = fopen(path, "wb");
    CHECK(f != NULL, "cannot write %s", path);
    if (!f) return;
    if (len > 0) fwrite(text, 1, len, f);
    fclose(f);
}

static void test_not_a_blob(const char *bin, const char *fixtures)
{
    write_file("merge_empty_file.beast2", "", 0);
    write_file("merge_text.beast2", "not a blob", 10);
    char cmd[4096];

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i merge_empty_file.beast2 -o merge_out_nb_empty.beast2", bin);
    int rc = run_cli(cmd, "merge_err_nb_empty.txt");
    CHECK(rc == 1, "empty input: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_empty.txt",
                          "merge: input 0 (merge_empty_file.beast2): Data too short for Beast2 "
                          "format: 0 bytes");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i \"%s/merge_in_a.beast2\" -i merge_text.beast2 -o "
             "merge_out_nb_text.beast2",
             bin, fixtures);
    rc = run_cli(cmd, "merge_err_nb_text.txt");
    CHECK(rc == 1, "text input: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_text.txt",
                          "merge: input 1 (merge_text.beast2): Invalid Beast2 magic at offset 0: "
                          "expected 0x89, got 0x6e");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge -i merge_missing_file.beast2 -o merge_out_nb_missing.beast2", bin);
    rc = run_cli(cmd, "merge_err_nb_missing.txt");
    CHECK(rc == 1, "missing input: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_missing.txt",
                          "merge: input 0 (merge_missing_file.beast2): cannot open the file");

    /* A blob without the paging index — a whole-value encode, not what a
     * runner writes — is refused in the reader's words, as east-node and
     * east-py refuse it. */
    EastValue *whole = east_dict_new(&east_integer_type, &east_string_type);
    ByteBuffer *bytes = east_beast2_encode_full(whole, dict_type());
    CHECK(bytes != NULL, "cannot encode the whole-value blob");
    if (bytes) {
        write_file("merge_whole.beast2", (const char *)bytes->data, bytes->len);
        byte_buffer_free(bytes);
    }
    east_value_release(whole);
    snprintf(cmd, sizeof(cmd), "\"%s\" merge -i merge_whole.beast2 -o merge_out_nb_whole.beast2",
             bin);
    rc = run_cli(cmd, "merge_err_nb_whole.txt");
    CHECK(rc == 1, "whole-value input: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_whole.txt",
                          "merge: input 0 (merge_whole.beast2): beast2 v5: blob carries no index — "
                          "ranged reads need one (write with the index enabled, the default)");

    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" --range merge_empty_file.beast2 "
             "-i \"%s/merge_in_a.beast2\" -o merge_out_nb_range_empty.beast2",
             bin, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_nb_range_empty.txt");
    CHECK(rc == 1, "empty range: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_range_empty.txt",
                          "merge: --range (merge_empty_file.beast2): Data too short for Beast2 "
                          "format: 0 bytes");
    snprintf(cmd, sizeof(cmd),
             "\"%s\" merge --merge \"%s/emit_merge_concat.beast2\" --range merge_text.beast2 "
             "-i \"%s/merge_in_a.beast2\" -o merge_out_nb_range_text.beast2",
             bin, fixtures, fixtures);
    rc = run_cli(cmd, "merge_err_nb_range_text.txt");
    CHECK(rc == 1, "text range: expected exit 1, got %d", rc);
    check_stderr_contains("merge_err_nb_range_text.txt",
                          "merge: --range (merge_text.beast2): Invalid Beast2 magic at offset 0: "
                          "expected 0x89, got 0x6e");
}

int main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "usage: %s <east-c-binary> <fixtures-dir>\n", argv[0]);
        return 2;
    }
    east_type_of_type_init();

    test_dict_merge(argv[1], argv[2]);
    test_set_union(argv[1], argv[2]);
    test_duplicate(argv[1], argv[2]);
    test_refusals(argv[1], argv[2]);
    test_empty_inputs(argv[1], argv[2]);
    test_ranges(argv[1], argv[2]);
    test_not_a_blob(argv[1], argv[2]);

    if (failures > 0) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("cli merge gate: all checks passed\n");
    return 0;
}
