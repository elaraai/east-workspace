/*
 * Reference-counted source maps.
 *
 * A source map is shared by every closure that resolves loc_ids against it:
 * the closures a compiled program creates while the map is current, and the
 * closures a beast2 decode reconstructs from a blob's source-map section.
 * Those closures routinely outlive the compile or decode that produced the
 * map (a decoded function value is returned to the caller; the decode's
 * header is disposed on the way out), so the map cannot belong to the decode.
 * Each holder takes a reference and the last one frees it — the same model
 * EastValue/EastType use. Plain (non-atomic) counts: the runtime is driven
 * from one thread per arena (see east.h), and the holders themselves
 * (EastCompiledFn) are freed non-atomically.
 */

#include "east/type_of_type.h"

#include <stdlib.h>

EastSourceMap *east_source_map_new(void)
{
    EastSourceMap *sm = calloc(1, sizeof(EastSourceMap));
    if (!sm) return NULL;
    sm->ref_count = 1;
    return sm;
}

void east_source_map_retain(EastSourceMap *sm)
{
    if (!sm || sm->ref_count <= 0) return;
    sm->ref_count++;
}

void east_source_map_release(EastSourceMap *sm)
{
    if (!sm || sm->ref_count <= 0) return;
    if (--sm->ref_count > 0) return;
    east_source_map_free(sm);
    free(sm);
}
