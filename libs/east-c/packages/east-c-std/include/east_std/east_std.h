#ifndef EAST_STD_H
#define EAST_STD_H

#include <east/platform.h>
#include <stddef.h>

// Individual module registration
void east_std_register_console(PlatformRegistry *reg);
void east_std_register_fs(PlatformRegistry *reg);
void east_std_register_path(PlatformRegistry *reg);
void east_std_register_crypto(PlatformRegistry *reg);
void east_std_register_time(PlatformRegistry *reg);
void east_std_register_random(PlatformRegistry *reg);
void east_std_register_fetch(PlatformRegistry *reg);
void east_std_register_parallel(PlatformRegistry *reg);
/* Generic factory for parallel_map. Exposed so other runtimes (e.g. east-py-std)
 * can bind directly to the C implementation rather than re-implementing fork-
 * based parallelism. The factory is registered as a generic platform fn with
 * type parameters [T, R] (input element type, output element type). */
PlatformFn east_std_parallel_map_factory(EastType **type_params, size_t num_type_params);
void east_std_register_test(PlatformRegistry *reg);

// Register all standard platform functions
void east_std_register_all(PlatformRegistry *reg);

#endif
