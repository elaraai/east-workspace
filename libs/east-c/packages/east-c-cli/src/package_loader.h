/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The platform packages the runner opens at run time.
 *
 * east-c-std is linked into the binary. east-c-datascience (OR-Tools, XGBoost
 * and the neural networks on libtorch) is a shared library the runner opens
 * when a program names the package — so one published binary serves every
 * project, and a project that needs the data-science families installs them
 * beside it (the npm package @elaraai/east-c-datascience, or a directory named
 * by EAST_C_PACKAGE_PATH). The library links none of east-c: it binds to the
 * runtime's own symbols, which the binary exports for it, so there is one
 * runtime in the process. See libs/east-c/docs/npm-runner-distribution.md.
 */
#ifndef EAST_CLI_PACKAGE_LOADER_H
#define EAST_CLI_PACKAGE_LOADER_H

#include <east/platform.h>

#include <stdbool.h>
#include <stddef.h>

/* The entry points of an opened east-c-datascience library
 * (packages/east-c-datascience/include/east_datascience/east_datascience.h). */
typedef struct {
    void (*register_all)(PlatformRegistry *reg);
    const char *(*version)(void);
    const char *(*ortools_version)(void);
    const char *(*xgboost_version)(void);
    const char *(*nn_state)(void);
    /* The library's path, as it was opened. */
    const char *path;
} EastDatasciencePackage;

/* The directories a package library is looked for in, in order, as text for a
 * message: one path per line. `buf` is filled up to `len`. */
void east_package_search_paths(const char *package, char *buf, size_t len);

/* Opens east-c-datascience, once per process, and answers its entry points.
 * NULL when it is not installed or cannot load, with the reason in `err`: how
 * to install it, or what the dynamic loader said. A library built for another
 * east-c version is refused. */
const EastDatasciencePackage *east_package_datascience(char *err, size_t err_len);

#endif
