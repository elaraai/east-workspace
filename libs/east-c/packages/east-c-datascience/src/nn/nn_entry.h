/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The seam between east-c-datascience and its libtorch-linked half.
 *
 * libeast-c-datascience registers nn_init, nn_run and nn_train as stubs
 * (nn_stub.cc); the first call opens libeast-c-nn beside it, which links
 * libtorch, and takes this table from it (nn.cc). So OR-Tools and XGBoost run
 * without libtorch installed, and the nn_* functions say how to fetch it. */
#ifndef EAST_DATASCIENCE_NN_ENTRY_H
#define EAST_DATASCIENCE_NN_ENTRY_H

#include <east/platform.h>
#include <east_datascience/east_datascience.h>

#define EAST_NN_ENTRY_ABI 2

typedef struct {
    int abi;
    PlatformFn nn_init;
    PlatformFn nn_run;
    PlatformFn nn_train;
    PlatformFn nn_import_torch;
    PlatformFn nn_export_torch;
    /* The libtorch this library runs on, as `east-c version` prints it. */
    const char *(*torch)(void);
} EastNnEntry;

#ifdef __cplusplus
extern "C" {
#endif
EAST_DS_API const EastNnEntry *east_nn_entry(void);
#ifdef __cplusplus
}
#endif

#endif
