/*
 * A bound of a key range (#1616, D2) — see east/key_bound.h.
 */
#include "east/key_bound.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

bool east_key_bound_type_ok(EastType *key_type, EastType *bound_type)
{
    if (!key_type || !bound_type) return false;
    if (east_type_equal(key_type, bound_type)) return true;
    if (key_type->kind != EAST_TYPE_STRUCT || bound_type->kind != EAST_TYPE_STRUCT) return false;
    size_t given = bound_type->data.struct_.num_fields;
    if (given == 0 || given > key_type->data.struct_.num_fields) return false;
    for (size_t i = 0; i < given; i++) {
        const EastTypeField *of = &key_type->data.struct_.fields[i];
        const EastTypeField *field = &bound_type->data.struct_.fields[i];
        if (strcmp(field->name, of->name) != 0) return false;
        /* Only the last field a bound gives may be cut short. */
        bool fits = i == given - 1 ? east_key_bound_type_ok(of->type, field->type)
                                   : east_type_equal(of->type, field->type);
        if (!fits) return false;
    }
    return true;
}

/* A growing string. `failed` once memory could not be had: every later append
 * is then a no-op, and the caller hands back NULL. */
typedef struct {
    char *data;
    size_t len;
    size_t cap;
    bool failed;
} Words;

static void words_append(Words *w, const char *text)
{
    if (w->failed) return;
    size_t add = strlen(text);
    if (w->len + add + 1 > w->cap) {
        size_t cap = w->cap ? w->cap : 128;
        while (cap < w->len + add + 1)
            cap *= 2;
        char *data = realloc(w->data, cap);
        if (!data) {
            w->failed = true;
            return;
        }
        w->data = data;
        w->cap = cap;
    }
    memcpy(w->data + w->len, text, add + 1);
    w->len += add;
}

/* A key's leaves by name, in order, through nested structs: `press, day, job`,
 * `ik.on.hall, ik.on.press, ik.key, k`. `path` is the fields above `type`,
 * dotted, with its trailing dot. */
static void words_append_leaves(Words *w, const EastType *type, const char *path, bool *first)
{
    if (type->kind != EAST_TYPE_STRUCT) {
        if (!*first) words_append(w, ", ");
        *first = false;
        /* A leaf's path, without the dot that ends it. */
        size_t len = strlen(path);
        if (len > 0 && !w->failed) {
            char *leaf = malloc(len);
            if (!leaf) {
                w->failed = true;
                return;
            }
            memcpy(leaf, path, len - 1);
            leaf[len - 1] = '\0';
            words_append(w, leaf);
            free(leaf);
        }
        return;
    }
    for (size_t i = 0; i < type->data.struct_.num_fields; i++) {
        const EastTypeField *field = &type->data.struct_.fields[i];
        size_t len = strlen(path) + strlen(field->name) + 2;
        char *below = malloc(len);
        if (!below) {
            w->failed = true;
            return;
        }
        snprintf(below, len, "%s%s.", path, field->name);
        words_append_leaves(w, field->type, below, first);
        free(below);
    }
}

/* How a refusal names a bound. */
static const char *bound_words(EastKeyBoundName name)
{
    switch (name) {
    case EAST_KEY_BOUND_FROM:
        return "a range's `from`";
    case EAST_KEY_BOUND_TO:
        return "a range's `to`";
    case EAST_KEY_BOUND_PREFIX:
        break;
    }
    return "a prefix";
}

bool east_key_bound_accepts(EastKeyBoundName name, EastType *key_type, EastType *bound_type)
{
    if (!east_key_bound_type_ok(key_type, bound_type)) return false;
    return name != EAST_KEY_BOUND_PREFIX || key_type->kind == EAST_TYPE_STRUCT;
}

char *east_key_bound_refusal(EastKeyBoundName name, EastType *key_type, EastType *bound_type)
{
    if (!key_type || east_key_bound_accepts(name, key_type, bound_type)) return NULL;
    Words w = {0};
    if (key_type->kind != EAST_TYPE_STRUCT) {
        const char *kind = east_type_kind_name(key_type->kind);
        if (name == EAST_KEY_BOUND_PREFIX) {
            words_append(&w, "a prefix gives the first fields of a struct key, and this key is a ");
            words_append(&w, kind);
            words_append(&w, ": read one key with `get`, or the keys between two with `range`");
        } else {
            words_append(&w, bound_words(name));
            words_append(&w, " is not the key's type: a bound of a ");
            words_append(&w, kind);
            words_append(&w, " key is a ");
            words_append(&w, kind);
        }
    } else {
        words_append(&w, bound_words(name));
        /* The dash is U+2014, as TypeScript writes it. */
        words_append(&w, " is no leading part of the key: a bound gives the key's first fields in "
                         "order \xe2\x80\x94 ");
        bool first = true;
        words_append_leaves(&w, key_type, "", &first);
    }
    if (w.failed) {
        free(w.data);
        return NULL;
    }
    return w.data;
}

int east_key_bound_compare(EastValue *key, EastValue *bound, const EastType *bound_type)
{
    if (!bound_type || bound_type->kind != EAST_TYPE_STRUCT || !key || !bound ||
        key->kind != EAST_VAL_STRUCT || bound->kind != EAST_VAL_STRUCT)
        return east_value_compare(key, bound);
    /* The bound's fields are the key's first: the fewest of what the type says
     * and what each value holds, so neither value is read past its fields. */
    size_t given = bound_type->data.struct_.num_fields;
    if (given > bound->data.struct_.num_fields) given = bound->data.struct_.num_fields;
    if (given > key->data.struct_.num_fields) given = key->data.struct_.num_fields;
    for (size_t i = 0; i < given; i++) {
        EastValue *of = key->data.struct_.field_values[i];
        EastValue *field = bound->data.struct_.field_values[i];
        /* Each field whole by East's order, but the last, which may be cut short. */
        int order = i == given - 1
                        ? east_key_bound_compare(of, field, bound_type->data.struct_.fields[i].type)
                        : east_value_compare(of, field);
        if (order != 0) return order;
    }
    return 0;
}
