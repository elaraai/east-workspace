/*
 * Regression gate for issue #83: east_type_to_value must memoize the
 * type->value conversion so that two struct fields referencing the SAME
 * interned EastType* share the SAME EastValue* sub-tree. The beast2 value
 * encoder dedups by pointer identity, so without the memo the shared
 * sub-type's value is emitted twice and the type-of-type encoding bloats
 * (302 bytes instead of the TS-canonical 293).
 *
 * This mirrors the TS reference's persistent toEastTypeValueCache
 * (libs/east/src/type_of_type.ts:119). The companion east-py fix lands the
 * same parallel on the Python runtime.
 *
 * The type under test is Struct{a: T, b: T} where
 *   T = Variant{none: Null, some: Vector(Integer)}
 * so the two fields point at the same interned variant. We encode the
 * type-of-type with east_beast2_encode_full and assert the bytes are exactly
 * the 293-byte TS-canonical encoding (CANON_HEX below — produced by the TS
 * reference implementation). Run under ASan/LSan for the leak oracle on the
 * new memo retain/release balance.
 */
#include <east/east.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* TS-canonical 293-byte beast2-full encoding of Struct{a: T, b: T} as an
 * EastTypeType value (T = Variant{none: Null, some: Vector(Integer)}). */
static const char *CANON_HEX =
    "89456173740d0a04f201000c120b0a00090206696e7075747301066f757470757400000902036b"
    "65790005"
    "76616c7565000209020269640505696e6e65720008020372656605077772617070657206010902"
    "046e616d65"
    "080474797065000a090813054172726179000d4173796e6346756e6374696f6e0204426c6f6203"
    "07426f6f6c"
    "65616e03084461746554696d650304446963740405466c6f6174030846756e6374696f6e020749"
    "6e74656765"
    "7203064d617472697800054e6576657203044e756c6c0309526563757273697665070352656600"
    "03536574"
    "0006537472696e6703065374727563740a0756617269616e740a06566563746f72000f04016101"
    "62046e6f6e"
    "6504736f6d6501001402090a0902001101011101080a0902020b0312081000";

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
               "(type-of-type encodes to the 293-byte TS-canonical form, issue #83)\n");
        return 0;
    }
    printf("GATE FAIL: %d check(s) failed\n", failures);
    return 1;
}
