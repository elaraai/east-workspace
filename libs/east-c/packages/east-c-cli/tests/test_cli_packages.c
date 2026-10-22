/*
 * CLI package gate: east-c-datascience is a library the binary opens at run
 * time (src/package_loader.c), not part of the binary.
 *
 * A copy of the binary in a directory of its own, with EAST_C_PACKAGE_PATH
 * naming an empty directory, has no package: `version -p east-c-datascience`
 * reports it as not installed with how to install it (exit 0 — a report), and
 * `run <file> -p east-c-datascience` refuses with the same before reading the
 * file (exit 1). With the package built — its library passed as the third
 * argument — the build tree's binary opens it beside itself: `version` names
 * the package, its version, OR-Tools, XGBoost, the libtorch state and where it
 * was found; and the copied binary opens it from the directory
 * EAST_C_PACKAGE_PATH names.
 *
 * usage: test_cli_packages <east-c-binary> <scratch-dir> [<datascience-library>]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifdef _WIN32
#include <direct.h>
#define mkdir_p(p) _mkdir(p)
#define setenv_kv(k, v) _putenv_s(k, v)
#else
#include <sys/wait.h>
#include <unistd.h>
#define mkdir_p(p) mkdir(p, 0755)
#define setenv_kv(k, v) setenv(k, v, 1)
#endif

#ifndef EAST_RUNTIME_VERSION
#define EAST_RUNTIME_VERSION "unknown"
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

static char *read_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc(len > 0 ? (size_t)len + 1 : 1);
    if (!buf) {
        fclose(f);
        return NULL;
    }
    size_t rd = fread(buf, 1, (size_t)len, f);
    fclose(f);
    buf[rd] = '\0';
    return buf;
}

static int copy_file(const char *from, const char *to)
{
    FILE *in = fopen(from, "rb");
    if (!in) return -1;
    FILE *out = fopen(to, "wb");
    if (!out) {
        fclose(in);
        return -1;
    }
    char buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, in)) > 0)
        fwrite(buf, 1, n, out);
    fclose(in);
    fclose(out);
#ifndef _WIN32
    chmod(to, 0755);
#endif
    return 0;
}

/* Runs one CLI invocation with stdout and stderr captured; the exit code. */
static int run_cli(const char *cmdline, const char *out_path, const char *err_path)
{
    char full[8192];
#ifdef _WIN32
    snprintf(full, sizeof full, "\"%s > \"%s\" 2> \"%s\"\"", cmdline, out_path, err_path);
#else
    snprintf(full, sizeof full, "%s > \"%s\" 2> \"%s\"", cmdline, out_path, err_path);
#endif
    int rc = system(full);
#ifndef _WIN32
    rc = rc == -1 ? -1 : WEXITSTATUS(rc);
#endif
    return rc;
}

static const char *dir_of(const char *path, char *buf, size_t cap)
{
    snprintf(buf, cap, "%s", path);
    char *slash = strrchr(buf, '/');
#ifdef _WIN32
    char *back = strrchr(buf, '\\');
    if (!slash || (back && back > slash)) slash = back;
#endif
    if (slash)
        *slash = '\0';
    else
        snprintf(buf, cap, ".");
    return buf;
}

int main(int argc, char **argv)
{
    if (argc < 3 || argc > 4) {
        fprintf(stderr, "usage: %s <east-c-binary> <scratch-dir> [<datascience-library>]\n",
                argv[0]);
        return 2;
    }
    const char *binary = argv[1];
    const char *scratch = argv[2];
    const char *library = argc == 4 ? argv[3] : NULL;

    char bin_dir[4096], empty_dir[4096], copy[8192], out_path[4096], err_path[4096];
    snprintf(bin_dir, sizeof bin_dir, "%s/bin", scratch);
    snprintf(empty_dir, sizeof empty_dir, "%s/empty", scratch);
    mkdir_p(scratch);
    mkdir_p(bin_dir);
    mkdir_p(empty_dir);
#ifdef _WIN32
    snprintf(copy, sizeof copy, "%s/east-c.exe", bin_dir);
#else
    snprintf(copy, sizeof copy, "%s/east-c", bin_dir);
#endif
    snprintf(out_path, sizeof out_path, "%s/out.txt", scratch);
    snprintf(err_path, sizeof err_path, "%s/err.txt", scratch);
    if (copy_file(binary, copy) != 0) {
        fprintf(stderr, "cannot copy %s to %s\n", binary, copy);
        return 2;
    }

    char cmd[16384];
    char *out, *err;
    int rc;

    /* 1. No package where the copy looks: version reports it, exit 0. */
    setenv_kv("EAST_C_PACKAGE_PATH", empty_dir);
    snprintf(cmd, sizeof cmd, "\"%s\" version -p east-c-datascience", copy);
    rc = run_cli(cmd, out_path, err_path);
    out = read_file(out_path);
    CHECK(rc == 0, "version with the package missing exited %d", rc);
    CHECK(out && strstr(out, "east-c-datascience: east-c-datascience is not installed"),
          "version did not report the package as not installed:\n%s", out ? out : "(none)");
    CHECK(out && (strstr(out, "npm install @elaraai/east-c-datascience") ||
                  strstr(out, "make build EAST_C_DATASCIENCE=ON")),
          "the report does not say how to install it:\n%s", out ? out : "(none)");
    CHECK(out && strstr(out, "EAST_C_PACKAGE_PATH"),
          "the report does not name EAST_C_PACKAGE_PATH:\n%s", out ? out : "(none)");
    CHECK(out && strstr(out, empty_dir), "the report does not list the directory searched:\n%s",
          out ? out : "(none)");
    free(out);

    /* 2. run refuses before reading anything, exit 1, the same reason. */
    snprintf(cmd, sizeof cmd, "\"%s\" run \"%s/nothing.json\" -p east-c-datascience", copy,
             scratch);
    rc = run_cli(cmd, out_path, err_path);
    err = read_file(err_path);
    CHECK(rc == 1, "run with the package missing exited %d", rc);
    CHECK(err && strstr(err, "Error: east-c-datascience is not installed"),
          "run did not refuse naming the missing package:\n%s", err ? err : "(none)");
    CHECK(err && !strstr(err, "nothing.json"), "run read the file before the packages:\n%s",
          err ? err : "(none)");
    free(err);

    if (!library) {
        printf("cli_packages: %d failure(s) (no east-c-datascience build: its opening untested)\n",
               failures);
        return failures ? 1 : 0;
    }

    /* 3. The build tree's binary opens the library beside it. */
#ifdef _WIN32
    _putenv("EAST_C_PACKAGE_PATH=");
#else
    unsetenv("EAST_C_PACKAGE_PATH");
#endif
    snprintf(cmd, sizeof cmd, "\"%s\" version -p east-c-datascience", binary);
    rc = run_cli(cmd, out_path, err_path);
    out = read_file(out_path);
    err = read_file(err_path);
    CHECK(rc == 0, "version with the package built exited %d:\n%s", rc, err ? err : "");
    CHECK(out && strstr(out, "east-c-datascience " EAST_RUNTIME_VERSION " ("),
          "version did not name the package at the runtime's version:\n%s", out ? out : "(none)");
    CHECK(out && strstr(out, "platform functions; OR-Tools 9."),
          "version did not name OR-Tools:\n%s", out ? out : "(none)");
    CHECK(out && strstr(out, "XGBoost 3."), "version did not name XGBoost:\n%s",
          out ? out : "(none)");
    CHECK(out && strstr(out, "libtorch"), "version did not report the libtorch state:\n%s",
          out ? out : "(none)");
    char lib_dir[4096];
    dir_of(library, lib_dir, sizeof lib_dir);
    CHECK(out && strstr(out, lib_dir), "version did not say where the package was found:\n%s",
          out ? out : "(none)");
    free(out);
    free(err);

    /* 4. The copy opens it from the directory EAST_C_PACKAGE_PATH names. */
    setenv_kv("EAST_C_PACKAGE_PATH", lib_dir);
    snprintf(cmd, sizeof cmd, "\"%s\" version -p east-c-datascience", copy);
    rc = run_cli(cmd, out_path, err_path);
    out = read_file(out_path);
    CHECK(rc == 0, "version through EAST_C_PACKAGE_PATH exited %d", rc);
    CHECK(out && strstr(out, "platform functions; OR-Tools"),
          "the copy did not open the package through EAST_C_PACKAGE_PATH:\n%s",
          out ? out : "(none)");
    free(out);

    printf("cli_packages: %d failure(s)\n", failures);
    return failures ? 1 : 0;
}
