/*
 * CLI exec gate: the runner protocol's conformance corpus.
 *
 * TypeScript writes the corpus beside the compliance IR
 * (east/test/runner_corpus.spec.ts): each case a directory — unit.beast2
 * beside the files it names, under relative paths — and a case.beast2 naming
 * what executing it must come to: the outcome, every file the unit writes
 * besides its result with its bytes, and paths it must not write. This gate
 * copies each case into a scratch directory, runs `east-c exec` on it — with
 * every collection input opened lazily when the case asks — and holds the
 * exit status, the result's outcome and every output byte to the corpus, so
 * east-c writes what east-node and east-py write for every unit.
 *
 * Skips (exit 77) unless `make test-export` has produced the corpus. Run under
 * ASan/LSan the spawned CLI is itself instrumented, and its stderr is scanned
 * for sanitizer reports. The cases run in a fresh directory under the working
 * directory, removed when every case passes and kept for a look otherwise.
 *
 * usage: test_cli_exec <east-c-binary> [<corpus-dir>]
 */
#include <east/compat.h>
#include <east/east.h>
#include <east/type_of_type.h>

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifndef _WIN32
#include <dirent.h>
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
    uint8_t *buf = malloc(len > 0 ? (size_t)len + 1 : 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[rd] = '\0';
    *out_len = rd;
    return buf;
}

static bool file_exists(const char *path)
{
    struct stat st;
    return stat(path, &st) == 0;
}

/* Removes the directory `path` and everything in it. */
static void remove_tree(const char *path)
{
    DIR *d = opendir(path);
    if (d) {
        struct dirent *entry;
        while ((entry = readdir(d)) != NULL) {
            if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
            char child[4096];
            snprintf(child, sizeof(child), "%s/%s", path, entry->d_name);
            struct stat st;
            if (stat(child, &st) == 0 && S_ISDIR(st.st_mode))
                remove_tree(child);
            else
                unlink(child);
        }
        closedir(d);
    }
    rmdir(path);
}

/* Copies the directory `from` to `to`, subdirectories included. */
static bool copy_tree(const char *from, const char *to)
{
    if (east_mkdir(to) != 0 && errno != EEXIST) return false;
    DIR *d = opendir(from);
    if (!d) return false;
    bool ok = true;
    struct dirent *entry;
    while (ok && (entry = readdir(d)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
        char src[4096], dst[4096];
        snprintf(src, sizeof(src), "%s/%s", from, entry->d_name);
        snprintf(dst, sizeof(dst), "%s/%s", to, entry->d_name);
        struct stat st;
        if (stat(src, &st) != 0) {
            ok = false;
        } else if (S_ISDIR(st.st_mode)) {
            ok = copy_tree(src, dst);
        } else {
            size_t len = 0;
            uint8_t *bytes = read_file(src, &len);
            FILE *f = bytes ? fopen(dst, "wb") : NULL;
            ok = f && fwrite(bytes, 1, len, f) == len;
            if (f) ok = fclose(f) == 0 && ok;
            free(bytes);
        }
    }
    closedir(d);
    return ok;
}

/* Runs `exec` on a unit with stderr captured to `err_path`; returns the exit
 * status (-1 when the spawn failed) and fails the gate on a sanitizer report
 * in the child's stderr. */
static int run_exec(const char *bin, const char *unit, const char *err_path)
{
    char full[20000];
#ifdef _WIN32
    /* cmd.exe strips a leading quote unless the whole line is re-quoted. */
    snprintf(full, sizeof(full), "\"\"%s\" exec \"%s\" 2> \"%s\"\"", bin, unit, err_path);
#else
    snprintf(full, sizeof(full), "\"%s\" exec \"%s\" 2> \"%s\"", bin, unit, err_path);
#endif
    int rc = system(full);
#ifndef _WIN32
    rc = rc == -1 ? -1 : WEXITSTATUS(rc);
#endif
    size_t len = 0;
    uint8_t *err = read_file(err_path, &len);
    if (err) {
        CHECK(strstr((const char *)err, "AddressSanitizer") == NULL &&
                  strstr((const char *)err, "LeakSanitizer") == NULL,
              "sanitizer report in CLI stderr:\n%s", (const char *)err);
        free(err);
    }
    return rc;
}

/* A case's record, as TypeScript's RunnerCaseType declares it. */
static EastType *case_type(void)
{
    const char *output_names[2] = {"path", "bytes"};
    EastType *output_types[2] = {&east_string_type, &east_blob_type};
    const char *names[5] = {"name", "lazy", "outcome", "outputs", "absent"};
    EastType *types[5] = {&east_string_type, &east_boolean_type,
                          east_unit_result_type()->data.struct_.fields[0].type,
                          east_array_type(east_struct_type(output_names, output_types, 2)),
                          east_array_type(&east_string_type)};
    return east_struct_type(names, types, 5);
}

/* Decodes the beast2 file at `path` as `type`. */
static EastValue *load(const char *path, EastType *type)
{
    size_t len = 0;
    uint8_t *bytes = read_file(path, &len);
    if (!bytes) return NULL;
    EastValue *value = east_beast2_decode_full(bytes, len, type);
    free(bytes);
    return value;
}

static void test_case(const char *bin, const char *corpus, const char *scratch, const char *name)
{
    /* A path under `dir` has room for `dir` itself and a name after it. */
    char case_dir[4096], dir[4096], path[8192];
    snprintf(case_dir, sizeof(case_dir), "%s/%s", corpus, name);
    snprintf(dir, sizeof(dir), "%s/%s", scratch, name);
    snprintf(path, sizeof(path), "%s/case.beast2", case_dir);
    EastValue *expected = load(path, case_type());
    CHECK(expected != NULL, "%s: case.beast2 does not decode", name);
    if (!expected) {
        free(east_builtin_get_error());
        return;
    }
    CHECK(copy_tree(case_dir, dir), "%s: cannot copy the case to %s", name, dir);

    bool lazy = east_struct_get_field_idx(expected, 1)->data.boolean;
    EastValue *outcome = east_struct_get_field_idx(expected, 2);
    bool ok = strcmp(east_variant_case_name(outcome), "ok") == 0;
    char unit[8192], err[8192];
    snprintf(unit, sizeof(unit), "%s/unit.beast2", dir);
    snprintf(err, sizeof(err), "%s.stderr.txt", dir);
    /* A lazy case opens every collection input as a paged value. */
    if (lazy) setenv("EAST_LAZY_INPUT_BYTES", "1", 1);
    int rc = run_exec(bin, unit, err);
    if (lazy) unsetenv("EAST_LAZY_INPUT_BYTES");
    CHECK(rc == (ok ? 0 : 1), "%s: exit %d, expected %d", name, rc, ok ? 0 : 1);

    snprintf(path, sizeof(path), "%s/result.beast2", dir);
    EastValue *result = load(path, east_unit_result_type());
    CHECK(result != NULL, "%s: no result", name);
    if (result) {
        EastValue *actual = east_struct_get_field_idx(result, 0);
        if (!east_value_equal(actual, outcome)) {
            char *got =
                east_print_value(actual, east_unit_result_type()->data.struct_.fields[0].type);
            char *want =
                east_print_value(outcome, east_unit_result_type()->data.struct_.fields[0].type);
            CHECK(false, "%s: the outcome\n  %s\nexpected\n  %s", name, got ? got : "?",
                  want ? want : "?");
            free(got);
            free(want);
        }
        CHECK(east_struct_get_field_idx(result, 1)->data.integer > 0, "%s: no peak measured", name);
        east_value_release(result);
    }
    free(east_builtin_get_error());

    EastValue *outputs = east_struct_get_field_idx(expected, 3);
    for (size_t i = 0; i < outputs->data.array.len; i++) {
        EastValue *output = outputs->data.array.items[i];
        EastValue *rel = east_struct_get_field_idx(output, 0);
        EastValue *bytes = east_struct_get_field_idx(output, 1);
        snprintf(path, sizeof(path), "%s/%s", dir, rel->data.string.data);
        size_t len = 0;
        uint8_t *written = read_file(path, &len);
        CHECK(written != NULL, "%s: %s is not written", name, rel->data.string.data);
        if (written) {
            CHECK(len == bytes->data.blob.len && memcmp(written, bytes->data.blob.data, len) == 0,
                  "%s: %s differs (%zu bytes, expected %zu)", name, rel->data.string.data, len,
                  bytes->data.blob.len);
            free(written);
        }
    }
    EastValue *absent = east_struct_get_field_idx(expected, 4);
    for (size_t i = 0; i < absent->data.array.len; i++) {
        const char *rel = absent->data.array.items[i]->data.string.data;
        snprintf(path, sizeof(path), "%s/%s", dir, rel);
        CHECK(!file_exists(path), "%s: %s is written", name, rel);
    }
    east_value_release(expected);
}

int main(int argc, char **argv)
{
    if (argc < 2 || argc > 3) {
        fprintf(stderr, "usage: %s <east-c-binary> [<corpus-dir>]\n", argv[0]);
        return 2;
    }
    const char *corpus = argc > 2 ? argv[2] : "/tmp/east-test-ir/runner_corpus";
    char index[4096];
    snprintf(index, sizeof(index), "%s/index.beast2", corpus);
    if (!file_exists(index)) {
        printf("cli exec gate: skipped (no runner corpus at %s — run `make test-export`)\n",
               corpus);
        return 77;
    }
    east_type_of_type_init();
    /* A unit refuses an output directory that holds anything, so every run
     * starts from fresh copies. */
    char scratch[] = "cli_exec_XXXXXX";
    if (!mkdtemp(scratch)) {
        fprintf(stderr, "cannot create a scratch directory\n");
        return 2;
    }
    EastValue *names = load(index, east_array_type(&east_string_type));
    if (!names) {
        fprintf(stderr, "%s does not decode\n", index);
        return 1;
    }
    for (size_t i = 0; i < names->data.array.len; i++)
        test_case(argv[1], corpus, scratch, names->data.array.items[i]->data.string.data);
    size_t count = names->data.array.len;
    east_value_release(names);
    if (failures > 0) {
        fprintf(stderr, "%d failure(s); the cases ran in %s\n", failures, scratch);
        return 1;
    }
    remove_tree(scratch);
    printf("cli exec gate: all %zu corpus cases pass\n", count);
    return 0;
}
