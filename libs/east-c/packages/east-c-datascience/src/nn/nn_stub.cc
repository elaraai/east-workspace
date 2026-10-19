/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The neural-network family's registration in libeast-c-datascience: three
 * stubs that open libeast-c-nn (nn_entry.h) on the first call and forward to
 * it. Without libtorch the library does not open, and each call fails naming
 * the fetch — the rest of the package is unaffected. */
#include "nn_entry.h"

#include <east/eval_result.h>

#include <mutex>
#include <string>

#ifndef _WIN32
#include <dlfcn.h>
#endif

namespace east_ds
{

namespace
{

#ifdef __APPLE__
const char *NN_LIBRARY = "libeast-c-nn.dylib";
#else
const char *NN_LIBRARY = "libeast-c-nn.so";
#endif
const char *FETCH = "east-c-datascience fetch-libtorch";

std::once_flag g_once;
const EastNnEntry *g_entry = nullptr;
std::string g_error; /* why the library did not open, for each nn_* call */
std::string g_state; /* for `east-c version` */

/* The directory this library was opened from. */
std::string library_dir()
{
#ifndef _WIN32
    Dl_info info;
    if (dladdr(reinterpret_cast<void *>(&east_datascience_register_all), &info) && info.dli_fname) {
        std::string path(info.dli_fname);
        size_t slash = path.rfind('/');
        if (slash != std::string::npos) return path.substr(0, slash);
    }
#endif
    return ".";
}

void load()
{
#ifdef _WIN32
    g_error = "the neural-network family is not available on Windows";
    g_state = "neural networks: not available on Windows";
#else
    std::string path = library_dir() + "/" + NN_LIBRARY;
    void *lib = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!lib) {
        const char *reason = dlerror();
        std::string why = reason ? reason : "dlopen failed";
        g_error = "the neural-network family did not load (" + why +
                  "). libtorch is installed beside east-c-datascience by `" + FETCH + "`";
        g_state = "neural networks: libtorch not installed (run `" + std::string(FETCH) + "`; " +
                  why + ")";
        return;
    }
    auto entry_fn = reinterpret_cast<const EastNnEntry *(*)(void)>(dlsym(lib, "east_nn_entry"));
    const EastNnEntry *entry = entry_fn ? entry_fn() : nullptr;
    if (!entry || entry->abi != EAST_NN_ENTRY_ABI) {
        g_error = path + " is not this east-c-datascience's neural-network library";
        g_state = "neural networks: " + g_error;
        dlclose(lib);
        return;
    }
    g_entry = entry;
    g_state = entry->torch();
#endif
}

const EastNnEntry *entry()
{
    std::call_once(g_once, load);
    return g_entry;
}

EvalResult forward(const char *fn, PlatformFn EastNnEntry::*member, EastValue **args,
                   size_t num_args, EastType **input_types, size_t num_input_types,
                   EastType *output_type)
{
    const EastNnEntry *e = entry();
    if (!e) return eval_error((std::string(fn) + ": " + g_error).c_str());
    return (e->*member)(args, num_args, input_types, num_input_types, output_type);
}

EvalResult nn_init_stub(EastValue **args, size_t num_args, EastType **input_types,
                        size_t num_input_types, EastType *output_type)
{
    return forward("nn_init", &EastNnEntry::nn_init, args, num_args, input_types, num_input_types,
                   output_type);
}

EvalResult nn_run_stub(EastValue **args, size_t num_args, EastType **input_types,
                       size_t num_input_types, EastType *output_type)
{
    return forward("nn_run", &EastNnEntry::nn_run, args, num_args, input_types, num_input_types,
                   output_type);
}

EvalResult nn_train_stub(EastValue **args, size_t num_args, EastType **input_types,
                         size_t num_input_types, EastType *output_type)
{
    return forward("nn_train", &EastNnEntry::nn_train, args, num_args, input_types, num_input_types,
                   output_type);
}

} // namespace

void register_nn(PlatformRegistry *reg)
{
    platform_registry_add(reg, "nn_init", nn_init_stub, false);
    platform_registry_add(reg, "nn_run", nn_run_stub, false);
    platform_registry_add(reg, "nn_train", nn_train_stub, false);
}

const std::string &nn_state()
{
    entry();
    return g_state;
}

} // namespace east_ds
