/*
 * Regression gate for issue #83: east_type_to_value must memoize the
 * type->value conversion so that two struct fields referencing the SAME
 * interned EastType* share the SAME EastValue* sub-tree. The beast2 value
 * encoder dedups by pointer identity, so without the memo the shared
 * sub-type's value is emitted twice and the type-of-type encoding bloats
 * (65 bytes instead of the TS-canonical 51).
 *
 * This mirrors the TS reference's persistent toEastTypeValueCache
 * (libs/east/src/type_of_type.ts:119). The companion east-py fix lands the
 * same parallel on the Python runtime.
 *
 * The type under test is Struct{a: T, b: T} where
 *   T = Variant{none: Null, some: Vector(Integer)}
 * so the two fields point at the same interned variant. We encode the
 * type-of-type with east_beast2_encode_full and assert the bytes are exactly
 * the 51-byte TS-canonical encoding (CANON_HEX below — produced by the TS
 * reference implementation). Run under ASan/LSan for the leak oracle on the
 * new memo retain/release balance.
 *
 * The encoding is the v5 container (the encoder default since issue #416):
 * the type section is the well-known EastTypeValueType id, and the shared
 * sub-tree's arrays become REF backrefs rather than a second definition.
 */
#include <east/east.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* TS-canonical 51-byte beast2-full (v5 container) encoding of Struct{a: T, b: T}
 * as an EastTypeType value (T = Variant{none: Null, some: Vector(Integer)}). */
static const char *CANON_HEX =
    "89456173740d0a0501020947b0dde16f86410100001c1c1000020161110002046e6f6e650b0473"
    "6f6d65120800016211010100";

int main(void)
{
    int failures = 0;

    east_type_of_type_init();

    /* T = Variant{none: Null, some: Vector(Integer)} (interned). */
    EastType *vec = east_vector_type(&east_integer_type);
    const char *case_names[2] = {"none", "some"};
    EastType *case_types[2] = {&east_null_type, vec};
    EastType *t = east_variant_type(case_names, case_types, 2);

    /* Struct{a: T, b: T}: both fields reference the SAME interned T. */
    const char *field_names[2] = {"a", "b"};
    EastType *field_types[2] = {t, t};
    EastType *s = east_struct_type(field_names, field_types, 2);

    /* Sanity: the constructor interns, so the two field types are pointer-equal.
     * This is the precondition the memo relies on. */
    if (s->data.struct_.fields[0].type != s->data.struct_.fields[1].type) {
        printf("FAIL precondition: struct fields not pointer-interned\n");
        failures++;
    }

    EastValue *tv = east_type_to_value(s);
    if (!tv) {
        printf("FAIL: east_type_to_value returned NULL\n");
        failures++;
    } else {
        ByteBuffer *buf = east_beast2_encode_full(tv, east_type_type);
        if (!buf) {
            printf("FAIL: east_beast2_encode_full returned NULL\n");
            failures++;
        } else {
            size_t expected_len = strlen(CANON_HEX) / 2;
            if (buf->len != expected_len) {
                printf("FAIL: encoded length %zu != canonical %zu (memo missing?)\n", buf->len,
                       expected_len);
                failures++;
            }
            char *hex = malloc(buf->len * 2 + 1);
            for (size_t i = 0; i < buf->len; i++)
                sprintf(hex + 2 * i, "%02x", buf->data[i]);
            hex[buf->len * 2] = '\0';
            if (strcmp(hex, CANON_HEX) != 0) {
                printf("FAIL: bytes do not match TS-canonical encoding\n");
                printf("  got:      %s\n", hex);
                printf("  expected: %s\n", CANON_HEX);
                failures++;
            }
            free(hex);
            byte_buffer_free(buf);
        }
        east_value_release(tv);
    }

    east_type_registry_clear();

    if (failures == 0) {
        printf("GATE PASS: east_type_to_value memoizes shared interned sub-types "
               "(type-of-type encodes to the 51-byte TS-canonical form, issue #83)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
