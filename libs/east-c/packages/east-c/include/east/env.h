#ifndef EAST_ENV_H
#define EAST_ENV_H

#include "hashmap.h"
#include "ir.h"
#include "values.h"
#include <stdbool.h>

/* One runtime frame. A frame created from an IRScope carries that scope's
 * cells in `slots` (index = the name's slot in the scope; NULL = not bound
 * yet), so a Variable resolved at IR construction reads its cell without
 * hashing. Names bound outside the scope — by the beast2 closure decoder,
 * the east-py bridge, or an unresolved Let — live in `overflow`, created on
 * first use. A frame with no scope (env_new) keeps everything in `overflow`,
 * which is the whole pre-resolution behaviour.
 *
 * A frame is held by the frames below it and by the closures made in it or
 * below it — and by the evaluator while it runs there. The cycle collector
 * (gc.c) counts those references as it counts them to values, so a frame
 * and a closure holding each other go together (#1010). */
typedef struct Environment {
    IRScope *scope;    /* retained; NULL for an unscoped frame */
    EastValue **slots; /* scope->count cells, allocated with the frame */
    Hashmap *overflow; /* name -> EastValue*, lazily created */
    struct Environment *parent;
    int ref_count;
    unsigned gc_index; /* its entry among the frames a collection gathers (gc.c) */
} Environment;

Environment *env_new(Environment *parent);
/* A frame for `scope` (retained), its cells unbound. */
Environment *env_new_scoped(Environment *parent, IRScope *scope);
/* Bind cell `slot` of a scoped frame (retains value, releases the old). */
void env_bind_slot(Environment *env, size_t slot, EastValue *value);
/* Unbind everything in a frame. A loop resets the iteration frame nothing
 * else holds (ref_count == 1) to reuse it instead of allocating one per pass
 * — a frame only escapes an iteration through a closure that captured it,
 * and that closure holds a reference — and the evaluator resets a frame only
 * closures bound in it still hold, so they go with it (compiler.c,
 * frame_collect). Each cell is emptied before its value is released. */
void env_reset(Environment *env);

/* By-name binding and lookup: a name in the frame's scope binds its cell,
 * any other name the overflow map. Lookups walk the parent chain. */
void env_set(Environment *env, const char *name, EastValue *value);
void env_update(Environment *env, const char *name, EastValue *value);
EastValue *env_get(Environment *env, const char *name);
bool env_has(Environment *env, const char *name);

/* Visit every value bound in this one frame (cells, then overflow). */
void env_visit(Environment *env, HashmapIterFn fn, void *ctx);

void env_retain(Environment *env);
void env_release(Environment *env);

/* How the cycle collector frees a frame of a garbage cycle: what env_release
 * does at the last reference, split in the two steps the collector takes over
 * the whole cycle — every frame and value of it emptied before any is freed.
 * The first releases what the frame holds (its cells, its overflow map, its
 * scope and its parent); the second frees the frame. The collector keeps the
 * frame's count pinned in between, so nothing a release does frees it early
 * or finds it half emptied. */
void env_release_contents(Environment *env);
void env_dealloc(Environment *env);

#endif
