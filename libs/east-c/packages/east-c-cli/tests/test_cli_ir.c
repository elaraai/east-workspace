/*
 * CLI `ir` toolbox gate (issue #627).
 *
 * Spawns the built `east-c` binary over the checked-in beast2 IR fixtures
 * and pins the toolbox's contract end to end:
 *
 *   1. normalize   — `ir normalize x.beast2 -o n.json` writes the JSON
 *                    wrapper; normalizing again is a fixed point
 *                    (`ir diff n.json n2.json` prints identical, exit 0);
 *   2. diff        — two different programs differ (exit 1, a path);
 *                    a program against itself is identical (exit 0);
 *                    --raw compares without normalizing;
 *   3. convert     — beast2 → json → beast2 keeps the IR AND its source
 *                    map: the re-encoded blob raw-diffs identical to the
 *                    original (loc_ids intact), and decodes with the same
 *                    number of source-map stacks.
 *
 * Every case scans the child's stderr for sanitizer reports (the ASan
 * tree's ctest pass runs this gate with an instrumented CLI).
 */
#include <east/east.h>
#include <east/ir_normalize.h>
#include <east/type_of_type.h>

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

static char *read_text(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)len + 1);
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[rd] = '\0';
    return buf;
}

static uint8_t *read_bin(const char *path, size_t *len_out)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc(len > 0 ? (size_t)len : 1);
    *len_out = fread(buf, 1, (size_t)len, f);
    fclose(f);
    return buf;
}

/* Run a CLI command line with stdout+stderr captured; returns the exit code. */
static int run(const char *cmd, const char *out_path)
{
    char full[4096];
#ifdef _WIN32
    /* cmd.exe strips a leading quote unless the whole line is re-quoted. */
    snprintf(full, sizeof(full), "\"%s > \"%s\" 2>&1\"", cmd, out_path);
#else
    snprintf(full, sizeof(full), "%s > \"%s\" 2>&1", cmd, out_path);
#endif
    int rc = system(full);
    char *out = read_text(out_path);
    if (out) {
        CHECK(strstr(out, "AddressSanitizer") == NULL && strstr(out, "LeakSanitizer") == NULL,
              "sanitizer report in child output:\n%s", out);
        free(out);
    }
#ifndef _WIN32
    if (rc != -1 && WIFEXITED(rc)) return WEXITSTATUS(rc);
#endif
    return rc;
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s <east-c binary> <fixtures dir>\n", argv[0]);
        return 2;
    }
    const char *cli = argv[1];
    const char *fixtures = argv[2];
    east_type_of_type_init();

    char a[1024], b[1024], cmd[4096];
    snprintf(a, sizeof(a), "%s/zero_param.beast2", fixtures);
    snprintf(b, sizeof(b), "%s/emit_producer.beast2", fixtures);

    /* 1. normalize writes a JSON wrapper; normalizing it again is a fixed point */
    snprintf(cmd, sizeof(cmd), "\"%s\" ir normalize \"%s\" -o cli_ir_n1.json", cli, a);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "normalize exit code");
    snprintf(cmd, sizeof(cmd), "\"%s\" ir normalize cli_ir_n1.json -o cli_ir_n2.json", cli);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "re-normalize exit code");
    snprintf(cmd, sizeof(cmd), "\"%s\" ir diff cli_ir_n1.json cli_ir_n2.json --raw", cli);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "normalize is not a fixed point");
    {
        char *out = read_text("cli_ir_out.txt");
        CHECK(out && strstr(out, "identical"), "diff output: %s", out ? out : "(none)");
        free(out);
    }
    {
        /* the wrapper decodes, with no source map, and all loc_ids zero */
        char *text = read_text("cli_ir_n1.json");
        CHECK(text != NULL, "normalized JSON missing");
        if (text) {
            EastValue *ir = NULL;
            EastSourceMap *sm = NULL;
            IRNode *node = east_json_decode_ir(text, &ir, &sm);
            CHECK(ir != NULL, "normalized JSON does not decode as IR");
            CHECK(sm == NULL, "normalized IR must carry no source map");
            CHECK(strstr(text, "\"loc_id\":\"0\"") != NULL &&
                      strstr(text, "\"loc_id\":\"1\"") == NULL,
                  "normalized loc_ids must all be 0");
            if (node) ir_node_release(node);
            if (ir) east_value_release(ir);
            east_source_map_release(sm);
            free(text);
        }
    }

    /* 2. diff: different programs differ; a program against itself is identical */
    snprintf(cmd, sizeof(cmd), "\"%s\" ir diff \"%s\" \"%s\"", cli, a, b);
    CHECK(run(cmd, "cli_ir_out.txt") == 1, "different programs must exit 1");
    {
        char *out = read_text("cli_ir_out.txt");
        CHECK(out && strstr(out, "differ at $"), "diff output: %s", out ? out : "(none)");
        free(out);
    }
    snprintf(cmd, sizeof(cmd), "\"%s\" ir diff \"%s\" \"%s\"", cli, a, a);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "a program must be identical to itself");

    /* 3. convert round trip keeps IR and source map */
    snprintf(cmd, sizeof(cmd), "\"%s\" ir convert \"%s\" -o cli_ir_c.json", cli, a);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "convert to json");
    snprintf(cmd, sizeof(cmd), "\"%s\" ir convert cli_ir_c.json -o cli_ir_c.beast2", cli);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "convert back to beast2");
    snprintf(cmd, sizeof(cmd), "\"%s\" ir diff \"%s\" cli_ir_c.beast2 --raw", cli, a);
    CHECK(run(cmd, "cli_ir_out.txt") == 0, "beast2 -> json -> beast2 must be raw-identical");
    {
        size_t la = 0, lb = 0;
        uint8_t *da = read_bin(a, &la);
        uint8_t *db = read_bin("cli_ir_c.beast2", &lb);
        EastValue *ia = NULL, *ib = NULL;
        EastSourceMap *sa = NULL, *sb = NULL;
        IRNode *na = da ? east_beast2_decode_ir(da, la, &ia, &sa) : NULL;
        IRNode *nb = db ? east_beast2_decode_ir(db, lb, &ib, &sb) : NULL;
        CHECK(ia && ib, "round-tripped blobs decode");
        size_t ca = sa ? sa->num_stacks : 0, cb = sb ? sb->num_stacks : 0;
        CHECK(ca == cb, "source map stacks: %zu vs %zu", ca, cb);
        CHECK(ca > 1, "the fixture carries a source map (%zu stacks)", ca);
        if (na) ir_node_release(na);
        if (nb) ir_node_release(nb);
        if (ia) east_value_release(ia);
        if (ib) east_value_release(ib);
        east_source_map_release(sa);
        east_source_map_release(sb);
        free(da);
        free(db);
    }

    remove("cli_ir_n1.json");
    remove("cli_ir_n2.json");
    remove("cli_ir_c.json");
    remove("cli_ir_c.beast2");
    remove("cli_ir_out.txt");
    east_type_registry_clear();
    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("test_cli_ir: OK\n");
    return 0;
}
