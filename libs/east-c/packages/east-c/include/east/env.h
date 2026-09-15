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
 * which is the whole pre-resolution behaviour. */
typedef struct Environment {
    IRScope *scope;    /* retained; NULL for an unscoped frame */
    EastValue **slots; /* scope->count cells, allocated with the frame */
    Hashmap *overflow; /* name -> EastValue*, lazily created */
    struct Environment *parent;
    int ref_count;
    unsigned gc_gen; /* generation stamp for GC dedup */
} Environment;

Environment *env_new(Environment *parent);
/* A frame for `scope` (retained), its cells unbound. */
Environment *env_new_scoped(Environment *parent, IRScope *scope);
/* Bind cell `slot` of a scoped frame (retains value, releases the old). */
void env_bind_slot(Environment *env, size_t slot, EastValue *value);

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

#endif
