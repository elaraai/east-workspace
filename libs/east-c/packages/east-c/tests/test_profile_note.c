/*
 * Profiler bridge-note gate (#1357): a host that runs a platform function in
 * its own runtime (east-py's python functions) reports what each call spent
 * on the bridge — converting the arguments, converting the result, and the
 * element-level crossings its body made — and the profile adds it to the
 * platform function's entry and prints it under its line. A note while the
 * profiler is off is nothing.
 */
#include <east/compiler.h>
#include <east/compat.h>

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

int main(void)
{
    east_profile_reset();
    east_profile_enable(true);

    /* Two calls of one platform function, each reporting its bridge. */
    east_profile_platform_note("bridge_sum", 1000, 2000, 7);
    east_profile_platform_note("bridge_sum", 3000, 4000, 5);
    /* A clock reading, for a host that times its bridge with the profiler's. */
    uint64_t t0 = east_profile_now_ns();
    uint64_t t1 = east_profile_now_ns();
    CHECK(t1 >= t0, "the profiler's clock went backwards");

    size_t n = 0;
    EastProfileEntry *entries = east_profile_report(&n);
    CHECK(n == 1, "expected one entry, got %zu", n);
    if (n == 1) {
        CHECK(entries[0].platform, "the note's entry is a platform function");
        CHECK(entries[0].bridged, "the note marks its entry bridged");
        CHECK(entries[0].name && strcmp(entries[0].name, "bridge_sum") == 0, "named after it");
        CHECK(entries[0].convert_in_ns == 4000, "arguments: %llu",
              (unsigned long long)entries[0].convert_in_ns);
        CHECK(entries[0].convert_out_ns == 6000, "results: %llu",
              (unsigned long long)entries[0].convert_out_ns);
        CHECK(entries[0].crossings == 12, "crossings: %llu",
              (unsigned long long)entries[0].crossings);
        CHECK(entries[0].calls == 0, "a note is not a call");
    }
    free(entries);

    /* The report prints the bridge line under the function's. */
    FILE *out = tmpfile();
    CHECK(out != NULL, "tmpfile");
    if (out) {
        east_profile_print(out);
        fseek(out, 0, SEEK_END);
        long len = ftell(out);
        fseek(out, 0, SEEK_SET);
        char *text = calloc((size_t)len + 1, 1);
        size_t rd = fread(text, 1, (size_t)len, out);
        text[rd] = '\0';
        fclose(out);
        const char *line = strstr(text, "bridge_sum");
        CHECK(line != NULL, "the entry is printed: %s", text);
        const char *bridge = strstr(text, "bridge ");
        CHECK(bridge != NULL && bridge > line, "the bridge line follows its entry: %s", text);
        CHECK(strstr(text, "0.000004 s converting arguments") != NULL ||
                  strstr(text, "    0.000 s converting arguments") != NULL,
              "the conversions are printed: %s", text);
        CHECK(strstr(text, "12 element crossings") != NULL, "the crossings are printed: %s", text);
        free(text);
    }

    east_profile_enable(false);
    east_profile_reset();

    /* Off, a note is nothing. */
    east_profile_platform_note("other", 1, 1, 1);
    entries = east_profile_report(&n);
    CHECK(n == 0 && entries == NULL, "a note while the profiler is off made an entry");
    free(entries);

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("profile_note: ok\n");
    return 0;
}
