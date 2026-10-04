/*
 * What the East text printer and parser share: the components of the path a
 * back-reference names a container by.
 *
 * A component is what the TypeScript printer writes for each step down from
 * the value printed: `[i]` for an array's element, `[` and the key's text and
 * `]` for a Dict's value, `[]` for a Ref's, and `.` and the name as the text
 * spells it for a struct's field or a variant's case. Every runtime writes the
 * same ones, so a back-reference one runtime prints, any other reads.
 */
#ifndef EAST_TEXT_H
#define EAST_TEXT_H

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

/* A component, and its length: a Dict key's text may hold a NUL. Its text is
 * allocated, and NULL when there was no memory for it. */
typedef struct {
    char *text;
    size_t len;
} EastPathComponent;

/* Two components are one when their texts are, byte for byte. */
static inline bool east_text_component_equal(const EastPathComponent *a, const EastPathComponent *b)
{
    return a->len == b->len && (a->len == 0 || memcmp(a->text, b->text, a->len) == 0);
}

/* A component holding a copy of `len` bytes of `text`. */
EastPathComponent east_text_component(const char *text, size_t len);

/* The component naming a struct's field or a variant's case: `.` and the
 * name, quoted in backticks - each `\` and backtick in it escaped - when it is
 * no plain identifier. */
EastPathComponent east_text_name_component(const char *name);

/* The component naming a Dict's value: `[`, the `len` bytes of its key's
 * text, `]`. */
EastPathComponent east_text_key_component(const char *key, size_t len);

#endif
