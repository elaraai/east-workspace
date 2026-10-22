/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* Opens east-c-datascience's shared library — see package_loader.h.
 *
 * Where it is looked for, in order:
 *   1. EAST_C_PACKAGE_PATH: directories (PATH-style) holding the library;
 *      when set, nothing else is searched. The npm launcher sets it to the
 *      installed @elaraai/east-c-datascience-<target> package's lib/.
 *   2. Beside the binary, the npm per-platform package of the same name:
 *      <bin dir>/../east-c-datascience-<target>/lib/ (a flat node_modules).
 *   3. The system directory, /usr/local/lib/east-c/east-c-datascience/lib/
 *      (what the Docker tier links the installed package to).
 *   4. The build tree: <bin dir>/../east-c-datascience/.
 */
#include "package_loader.h"

#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#include <limits.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif
#endif

#ifndef EAST_RUNTIME_VERSION
#define EAST_RUNTIME_VERSION "unknown"
#endif

/* The system-wide package directory (Unix). */
#ifndef EAST_C_PACKAGE_DIR
#define EAST_C_PACKAGE_DIR "/usr/local/lib/east-c"
#endif

/* This binary's platform, as the npm packages name it. */
#if defined(__linux__) && defined(__x86_64__)
#define EAST_C_TARGET "linux-x64"
#elif defined(__linux__) && defined(__aarch64__)
#define EAST_C_TARGET "linux-arm64"
#elif defined(__APPLE__) && defined(__aarch64__)
#define EAST_C_TARGET "darwin-arm64"
#elif defined(__APPLE__) && defined(__x86_64__)
#define EAST_C_TARGET "darwin-x64"
#elif defined(_WIN32)
#define EAST_C_TARGET "win32-x64"
#else
#define EAST_C_TARGET "unknown"
#endif

#ifdef _WIN32
#define LIB_PREFIX ""
#define LIB_SUFFIX ".dll"
#define PATH_LIST_SEP ';'
#elif defined(__APPLE__)
#define LIB_PREFIX "lib"
#define LIB_SUFFIX ".dylib"
#define PATH_LIST_SEP ':'
#else
#define LIB_PREFIX "lib"
#define LIB_SUFFIX ".so"
#define PATH_LIST_SEP ':'
#endif

#define MAX_CANDIDATES 16
#define PATH_CAP 4096

typedef struct {
    char paths[MAX_CANDIDATES][PATH_CAP];
    int count;
    bool from_env; /* EAST_C_PACKAGE_PATH named them, and nothing else is searched */
} Candidates;

static void add_candidate(Candidates *c, const char *fmt, ...)
{
    if (c->count >= MAX_CANDIDATES) return;
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(c->paths[c->count], PATH_CAP, fmt, ap);
    va_end(ap);
    if (n > 0 && n < PATH_CAP) c->count++;
}

/* The directory holding the running executable, symlinks resolved. */
static bool executable_dir(char *buf, size_t len)
{
#ifdef _WIN32
    DWORD n = GetModuleFileNameA(NULL, buf, (DWORD)len);
    if (n == 0 || n >= len) return false;
    for (char *p = buf; *p; p++)
        if (*p == '\\') *p = '/';
#elif defined(__APPLE__)
    char raw[PATH_MAX];
    uint32_t size = sizeof raw;
    if (_NSGetExecutablePath(raw, &size) != 0) return false;
    char real[PATH_MAX];
    if (!realpath(raw, real)) return false;
    if (strlen(real) >= len) return false;
    strcpy(buf, real);
#else
    ssize_t n = readlink("/proc/self/exe", buf, len - 1);
    if (n <= 0) return false;
    buf[n] = '\0';
#endif
    char *slash = strrchr(buf, '/');
    if (!slash) return false;
    *slash = '\0';
    return true;
}

static void candidates_for(const char *package, Candidates *c)
{
    memset(c, 0, sizeof *c);
    char libname[256];
    snprintf(libname, sizeof libname, "%s%s%s", LIB_PREFIX, package, LIB_SUFFIX);

    const char *env = getenv("EAST_C_PACKAGE_PATH");
    if (env && *env) {
        c->from_env = true;
        const char *p = env;
        while (*p) {
            const char *end = strchr(p, PATH_LIST_SEP);
            size_t n = end ? (size_t)(end - p) : strlen(p);
            if (n > 0 && n < PATH_CAP - 300) {
                char dir[PATH_CAP];
                memcpy(dir, p, n);
                dir[n] = '\0';
                add_candidate(c, "%s/%s", dir, libname);
            }
            p = end ? end + 1 : p + n;
        }
        return;
    }

    char exe[PATH_CAP];
    bool have_exe = executable_dir(exe, sizeof exe);
    if (have_exe) add_candidate(c, "%s/../%s-%s/lib/%s", exe, package, EAST_C_TARGET, libname);
#ifndef _WIN32
    add_candidate(c, "%s/%s/lib/%s", EAST_C_PACKAGE_DIR, package, libname);
#endif
    if (have_exe) add_candidate(c, "%s/../%s/%s", exe, package, libname);
}

static bool file_exists(const char *path)
{
    struct stat st;
    return stat(path, &st) == 0;
}

void east_package_search_paths(const char *package, char *buf, size_t len)
{
    Candidates c;
    candidates_for(package, &c);
    size_t used = 0;
    buf[0] = '\0';
    for (int i = 0; i < c.count && used + 4 < len; i++) {
        int n = snprintf(buf + used, len - used, "  %s\n", c.paths[i]);
        if (n < 0) break;
        used += (size_t)n < len - used ? (size_t)n : len - used - 1;
    }
}

static void *open_library(const char *path, char *err, size_t err_len)
{
#ifdef _WIN32
    HMODULE h = LoadLibraryA(path);
    if (!h) snprintf(err, err_len, "LoadLibrary failed with error %lu", GetLastError());
    return (void *)h;
#else
    void *h = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!h) {
        const char *reason = dlerror();
        snprintf(err, err_len, "%s", reason ? reason : "dlopen failed");
    }
    return h;
#endif
}

static void *library_symbol(void *lib, const char *name)
{
#ifdef _WIN32
    return (void *)GetProcAddress((HMODULE)lib, name);
#else
    return dlsym(lib, name);
#endif
}

static void close_library(void *lib)
{
#ifdef _WIN32
    FreeLibrary((HMODULE)lib);
#else
    dlclose(lib);
#endif
}

const EastDatasciencePackage *east_package_datascience(char *err, size_t err_len)
{
    static EastDatasciencePackage pkg;
    static char pkg_path[PATH_CAP];
    static char saved_err[8192];
    static int state = 0; /* 0 untried, 1 open, -1 failed */
    if (state == 1) return &pkg;
    if (state == -1) {
        snprintf(err, err_len, "%s", saved_err);
        return NULL;
    }
    state = -1;

    const char *package = "east-c-datascience";
    Candidates c;
    candidates_for(package, &c);
    const char *found = NULL;
    for (int i = 0; i < c.count; i++) {
        if (file_exists(c.paths[i])) {
            found = c.paths[i];
            break;
        }
    }
#ifndef _WIN32
    /* The path as the loader and the messages name it: no `..` from the
     * binary's directory, no symlink. */
    char real[PATH_MAX];
    if (found && realpath(found, real)) {
        snprintf(pkg_path, sizeof pkg_path, "%s", real);
        found = pkg_path;
    }
#endif
    if (!found) {
        char searched[2048];
        east_package_search_paths(package, searched, sizeof searched);
        if (strcmp(EAST_C_TARGET, "linux-x64") == 0) {
            snprintf(saved_err, sizeof saved_err,
                     "east-c-datascience is not installed. It is the npm package "
                     "@elaraai/east-c-datascience, added beside @elaraai/east-c-cli (npm install "
                     "@elaraai/east-c-datascience); or set EAST_C_PACKAGE_PATH to the directory "
                     "holding %s%s%s.%s Looked in:\n%s",
                     LIB_PREFIX, package, LIB_SUFFIX,
                     c.from_env ? " EAST_C_PACKAGE_PATH is set, so only it was searched." : "",
                     searched);
        } else {
            snprintf(saved_err, sizeof saved_err,
                     "east-c-datascience is not installed: it is published for linux-x64 only. "
                     "On " EAST_C_TARGET
                     ", build it (libs/east-c: make build EAST_C_DATASCIENCE=ON) and "
                     "set EAST_C_PACKAGE_PATH to the directory holding %s%s%s. Looked in:\n%s",
                     LIB_PREFIX, package, LIB_SUFFIX, searched);
        }
        snprintf(err, err_len, "%s", saved_err);
        return NULL;
    }

    char reason[1024];
    void *lib = open_library(found, reason, sizeof reason);
    if (!lib) {
        snprintf(saved_err, sizeof saved_err,
                 "east-c-datascience at %s did not load: %s. Its libraries (OR-Tools, XGBoost) "
                 "sit beside it in the installed package; a missing one means an incomplete "
                 "install, and a missing GLIBC or GLIBCXX version a system older than the "
                 "package's floor.",
                 found, reason);
        snprintf(err, err_len, "%s", saved_err);
        return NULL;
    }

    /* dlsym answers an object pointer; through uintptr_t is the conversion C
     * allows. */
    void (*register_all)(PlatformRegistry *) = (void (*)(PlatformRegistry *))(
        uintptr_t)library_symbol(lib, "east_datascience_register_all");
    const char *(*version)(void) =
        (const char *(*)(void))(uintptr_t)library_symbol(lib, "east_datascience_version");
    const char *(*ortools)(void) =
        (const char *(*)(void))(uintptr_t)library_symbol(lib, "east_datascience_ortools_version");
    const char *(*xgboost)(void) =
        (const char *(*)(void))(uintptr_t)library_symbol(lib, "east_datascience_xgboost_version");
    const char *(*nn_state)(void) =
        (const char *(*)(void))(uintptr_t)library_symbol(lib, "east_datascience_nn_state");
    if (!register_all || !version || !ortools || !xgboost || !nn_state) {
        snprintf(saved_err, sizeof saved_err,
                 "%s is not an east-c-datascience library: it lacks the package's entry points",
                 found);
        snprintf(err, err_len, "%s", saved_err);
        close_library(lib);
        return NULL;
    }
    if (strcmp(version(), EAST_RUNTIME_VERSION) != 0) {
        snprintf(saved_err, sizeof saved_err,
                 "east-c-datascience %s at %s does not match east-c %s: install the same version "
                 "of @elaraai/east-c-datascience and @elaraai/east-c-cli",
                 version(), found, EAST_RUNTIME_VERSION);
        snprintf(err, err_len, "%s", saved_err);
        close_library(lib);
        return NULL;
    }

    if (found != pkg_path) snprintf(pkg_path, sizeof pkg_path, "%s", found);
    pkg.register_all = register_all;
    pkg.version = version;
    pkg.ortools_version = ortools;
    pkg.xgboost_version = xgboost;
    pkg.nn_state = nn_state;
    pkg.path = pkg_path;
    state = 1;
    return &pkg;
}
