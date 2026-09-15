#include "east/env.h"
#include "east/arena.h"

#include <stdlib.h>
#include <string.h>

/* Callback passed to hashmap_free to release each stored EastValue. */
static void release_value_cb(void *v)
{
    if (v) east_value_release((EastValue *)v);
}

Environment *env_new(Environment *parent)
{
    return env_new_scoped(parent, NULL);
}

Environment *env_new_scoped(Environment *parent, IRScope *scope)
{
    size_t cells = scope ? scope->count : 0;
    Environment *env = east_calloc(1, sizeof(Environment) + cells * sizeof(EastValue *));
    if (!env) return NULL;
    env->scope = scope;
    if (scope) ir_scope_retain(scope);
    env->slots = cells > 0 ? (EastValue **)(env + 1) : NULL;
    env->overflow = NULL;
    env->parent = parent;
    if (parent) env_retain(parent);
    env->ref_count = 1;
    env->gc_gen = 0;
    return env;
}

void env_bind_slot(Environment *env, size_t slot, EastValue *value)
{
    EastValue *old = env->slots[slot];
    if (value) east_value_retain(value);
    env->slots[slot] = value;
    if (old) east_value_release(old);
}

/* The cell of `name` in this frame's scope, or SIZE_MAX. */
static inline size_t frame_slot(const Environment *env, const char *name)
{
    return env->scope ? ir_scope_find(env->scope, name) : SIZE_MAX;
}

/* Whether this one frame binds `name` right now: a bound cell, or an
 * overflow entry. */
static bool frame_has(const Environment *env, const char *name)
{
    size_t i = frame_slot(env, name);
    if (i != SIZE_MAX) return env->slots[i] != NULL;
    return env->overflow && hashmap_has(env->overflow, name);
}

static void overflow_set(Environment *env, const char *name, EastValue *value)
{
    if (!env->overflow) {
        env->overflow = hashmap_new();
        if (!env->overflow) return;
    }
    EastValue *old = (EastValue *)hashmap_get(env->overflow, name);
    if (value) east_value_retain(value);
    hashmap_set(env->overflow, name, value);
    if (old) east_value_release(old);
}

void env_set(Environment *env, const char *name, EastValue *value)
{
    if (!env || !name) return;
    size_t i = frame_slot(env, name);
    if (i != SIZE_MAX) {
        env_bind_slot(env, i, value);
        return;
    }
    overflow_set(env, name, value);
}

void env_update(Environment *env, const char *name, EastValue *value)
{
    if (!env || !name) return;

    /* Walk scope chain to find existing binding and update it. */
    for (Environment *cur = env; cur != NULL; cur = cur->parent) {
        if (frame_has(cur, name)) {
            env_set(cur, name, value);
            return;
        }
    }

    /* Fallback: create new binding in current scope. */
    env_set(env, name, value);
}

EastValue *env_get(Environment *env, const char *name)
{
    if (!env || !name) return NULL;

    for (Environment *cur = env; cur != NULL; cur = cur->parent) {
        size_t i = frame_slot(cur, name);
        if (i != SIZE_MAX && cur->slots[i]) return cur->slots[i];
        if (cur->overflow) {
            EastValue *val = (EastValue *)hashmap_get(cur->overflow, name);
            if (val) return val;
        }
    }
    return NULL;
}

bool env_has(Environment *env, const char *name)
{
    if (!env || !name) return false;

    for (Environment *cur = env; cur != NULL; cur = cur->parent) {
        if (frame_has(cur, name)) return true;
    }
    return false;
}

void env_visit(Environment *env, HashmapIterFn fn, void *ctx)
{
    if (!env || !fn) return;
    if (env->scope) {
        for (size_t i = 0; i < env->scope->count; i++) {
            if (env->slots[i]) fn(env->scope->names[i], env->slots[i], ctx);
        }
    }
    if (env->overflow) hashmap_iter(env->overflow, fn, ctx);
}

void env_retain(Environment *env)
{
    if (env) __atomic_add_fetch(&env->ref_count, 1, __ATOMIC_RELAXED);
}

void env_release(Environment *env)
{
    if (!env) return;
    if (__atomic_sub_fetch(&env->ref_count, 1, __ATOMIC_ACQ_REL) > 0) return;

    if (env->scope) {
        for (size_t i = 0; i < env->scope->count; i++) {
            if (env->slots[i]) east_value_release(env->slots[i]);
        }
    }
    /* Release all values stored in the overflow map, free keys, free map. */
    if (env->overflow) hashmap_free(env->overflow, release_value_cb);
    ir_scope_release(env->scope);

    /* Release the parent environment. */
    if (env->parent) env_release(env->parent);

    east_free(env);
}
