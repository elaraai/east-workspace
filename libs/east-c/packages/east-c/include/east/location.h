#ifndef EAST_LOCATION_H
#define EAST_LOCATION_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>

/* Source location for error reporting / stack traces. Its own header, so an
 * EvalResult (eval_result.h) — what a platform function answers — names it
 * without the IR: the IR's headers are C, and east-c-datascience's platform
 * functions are C++. */
typedef struct {
    char *filename;
    int64_t line;
    int64_t column;
} EastLocation;

#ifdef __cplusplus
}
#endif

#endif
