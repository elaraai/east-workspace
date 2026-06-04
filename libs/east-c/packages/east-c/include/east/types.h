#ifndef EAST_TYPES_H
#define EAST_TYPES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Cross-DLL export marker for extern DATA symbols (the type/value singletons
 * declared in this header, type_of_type.h, and values.h). On Windows a DLL's
 * exported data must be __declspec(dllimport) in consumers and dllexport in the
 * DLL; functions auto-export via the import library, so only data needs this.
 * Empty for the static library and on non-Windows. east-py's shared-east-c DLL
 * build defines EAST_C_DLL_EXPORTS (the object lib) / EAST_C_DLL_IMPORTS (the
 * extensions); the standalone static CLI defines neither. */
#if defined(_WIN32) && defined(EAST_C_DLL_EXPORTS)
#define EAST_DATA __declspec(dllexport)
#elif defined(_WIN32) && defined(EAST_C_DLL_IMPORTS)
#define EAST_DATA __declspec(dllimport)
#else
#define EAST_DATA
#endif

typedef enum {
    EAST_TYPE_NEVER,
    EAST_TYPE_NULL,
    EAST_TYPE_BOOLEAN,
    EAST_TYPE_INTEGER,
    EAST_TYPE_FLOAT,
    EAST_TYPE_STRING,
    EAST_TYPE_DATETIME,
    EAST_TYPE_BLOB,
    EAST_TYPE_ARRAY,
    EAST_TYPE_SET,
    EAST_TYPE_DICT,
    EAST_TYPE_STRUCT,
    EAST_TYPE_VARIANT,
    EAST_TYPE_REF,
    EAST_TYPE_VECTOR,
    EAST_TYPE_MATRIX,
    EAST_TYPE_FUNCTION,
    EAST_TYPE_ASYNC_FUNCTION,
    EAST_TYPE_RECURSIVE,
} EastTypeKind;

typedef struct EastType EastType;

typedef struct {
    char *name;
    EastType *type;
} EastTypeField;

// One slot of the VariantType tag_slots hash side-table. `name` aliases the
// corresponding cases[i].name (NOT owned); NULL means the slot is empty.
struct EastVariantCaseSlot {
    const char *name;
    uint32_t name_hash;
    size_t idx;
};

struct EastType {
    EastTypeKind kind;
    int ref_count;
    int64_t type_id; // stable interned ID (-1 = not interned)
    union {
        // Array, Set, Ref, Vector, Matrix: element type
        EastType *element;
        // Dict: key and value types
        struct {
            EastType *key;
            EastType *value;
        } dict;
        // Struct: named fields
        struct {
            EastTypeField *fields;
            size_t num_fields;
        } struct_;
        // Variant: named cases. Cases are sorted alphabetically by name (see
        // east_variant_type in types.c). `tag_slots` is an open-addressing
        // hash table keyed by case name, mapping name → index into `cases[]`.
        // Built once at intern time; callers look up via
        // east_variant_type_case_idx() for O(1) tag→idx resolution.
        struct {
            EastTypeField *cases;
            size_t num_cases;
            // Hash side-table for O(1) case-by-name lookup. Size is always a
            // power of two; tag_slots_mask = size - 1 for `& mask` indexing.
            // An empty slot has name == NULL. NULL when num_cases == 0.
            struct EastVariantCaseSlot *tag_slots;
            size_t tag_slots_mask;
        } variant;
        // Function, AsyncFunction: inputs and output
        struct {
            EastType **inputs;
            size_t num_inputs;
            EastType *output;
        } function;
        // Recursive: wrapper around inner type (node).
        // Self-references inside node point back to this wrapper.
        // Matches TypeScript RecursiveType({ type: "Recursive", node: ... })
        struct {
            EastType *node;
            int internal_refs; // number of back-references from inner tree
        } recursive;
    } data;
};

// Primitive type singletons (never freed)
extern EAST_DATA EastType east_never_type;
extern EAST_DATA EastType east_null_type;
extern EAST_DATA EastType east_boolean_type;
extern EAST_DATA EastType east_integer_type;
extern EAST_DATA EastType east_float_type;
extern EAST_DATA EastType east_string_type;
extern EAST_DATA EastType east_datetime_type;
extern EAST_DATA EastType east_blob_type;

// Constructors (return ref_count=1)
EastType *east_array_type(EastType *elem);
EastType *east_set_type(EastType *elem);
EastType *east_dict_type(EastType *key, EastType *val);
EastType *east_struct_type(const char **names, EastType **types, size_t count);
EastType *east_variant_type(const char **names, EastType **types, size_t count);

// Look up the index of `tag` in a VariantType's sorted case list.
// Returns SIZE_MAX if `type` is not a VariantType, `tag` is NULL, or `tag`
// is not a case of `type`. O(1) amortised via the type's internal hash.
size_t east_variant_type_case_idx(const EastType *type, const char *tag);
EastType *east_ref_type(EastType *inner);
EastType *east_vector_type(EastType *elem);
EastType *east_matrix_type(EastType *elem);
EastType *east_function_type(EastType **inputs, size_t num_inputs, EastType *output);
EastType *east_async_function_type(EastType **inputs, size_t num_inputs, EastType *output);

// Recursive type: wrapper with inner node.
// Usage: create wrapper first, then build inner type using wrapper as self-ref,
// then call east_recursive_type_set to close the cycle, then call
// east_recursive_type_finalize to adjust refcounts for cycle-aware cleanup.
EastType *east_recursive_type_new(void);
void east_recursive_type_set(EastType *rec, EastType *node);
// Must be called after east_recursive_type_set to enable automatic cycle breaking.
// Intern a finalized recursive type: if a structurally identical one exists,
// returns the canonical pointer. Otherwise registers as new canonical.
// Call after east_recursive_type_finalize at serialization boundaries.
EastType *east_recursive_type_intern(EastType *rec);

// Free the global type registry. Call at shutdown for clean leak reports.
void east_type_registry_clear(void);

// Counts internal back-references and adjusts refcount so only external refs are tracked.
void east_recursive_type_finalize(EastType *rec);

// Ref counting
void east_type_retain(EastType *t);
void east_type_release(EastType *t);

// Comparison
bool east_type_equal(EastType *a, EastType *b);

// Printing (writes to buffer, returns chars written)
int east_type_print(EastType *t, char *buf, size_t buf_size);

// Helpers
const char *east_type_kind_name(EastTypeKind kind);

#endif
