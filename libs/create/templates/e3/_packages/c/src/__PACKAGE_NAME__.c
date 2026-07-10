/*
 * The __PACKAGE_NAME__ tool for __DISPLAY_NAME__ — a prebuilt native binary
 * captured into the e3 bundle via `environment: { tools: { files: [...] } }`.
 *
 * A custom-runner tool is invoked as `__PACKAGE_NAME__ <input> <output>`: it
 * reads the input dataset file and writes the output dataset file, both
 * BEAST2-encoded East values. This example is a PASSTHROUGH (it copies input to
 * output — valid when the task's input and output types match) so the scaffold
 * stays dependency-free and builds with a plain C compiler.
 *
 * For real native computation, embed the east-c runtime to decode the input,
 * compute, and encode the output BEAST2 value (see the docs on custom C
 * runners). A rebuild changes the captured binary's hash, so e3 re-runs only
 * the tasks wired to this tool.
 */
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <input> <output>\n", argv[0]);
        return 2;
    }
    FILE *in = fopen(argv[1], "rb");
    if (!in) { perror("open input"); return 1; }
    FILE *out = fopen(argv[2], "wb");
    if (!out) { perror("open output"); fclose(in); return 1; }

    unsigned char buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, in)) > 0) {
        if (fwrite(buf, 1, n, out) != n) { perror("write output"); fclose(in); fclose(out); return 1; }
    }
    fclose(in);
    fclose(out);
    return 0;
}
