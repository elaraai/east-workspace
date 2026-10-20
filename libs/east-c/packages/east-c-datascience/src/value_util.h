/*
 * Reading East values and building results from C++.
 *
 * A platform function body throws `Error` for anything it refuses — a field
 * it cannot find, a variable name the model never declared — and
 * `platform_call` turns it into the East error the evaluator raises, so the
 * bodies read straight down with no error plumbing. Results are built in the
 * type the IR declares for the call (`output_type`), field by field through
 * `StructBuilder`, so every variant, dict and array carries its declared type
 * and nothing here hand-builds a type.
 */
#ifndef EAST_DATASCIENCE_VALUE_UTIL_H
#define EAST_DATASCIENCE_VALUE_UTIL_H

#include <east/eval_result.h>
#include <east/platform.h>
#include <east/types.h>
#include <east/values.h>

#include <chrono>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace east_ds
{

/* What a platform function refuses: its message becomes the East error. */
class Error : public std::runtime_error
{
  public:
    using std::runtime_error::runtime_error;
};

/* A body: the arguments, how many, and the output type the call declares. */
using Body = EvalResult (*)(EastValue **args, size_t num_args, EastType *output_type);

/* The registered entry point of a body: runs it, and answers what it throws as
 * the East error. */
template <Body body>
EvalResult platform_call(EastValue **args, size_t num_args, EastType **input_types,
                         size_t num_input_types, EastType *output_type)
{
    (void)input_types;
    (void)num_input_types;
    try {
        return body(args, num_args, output_type);
    } catch (const std::exception &e) {
        return eval_error(e.what());
    } catch (...) {
        return eval_error("platform function failed");
    }
}

/* As platform_call, for a body that also reads its declared input types. */
using BodyTyped = EvalResult (*)(EastValue **args, size_t num_args, EastType **input_types,
                                 size_t num_input_types, EastType *output_type);

template <BodyTyped body>
EvalResult platform_call_typed(EastValue **args, size_t num_args, EastType **input_types,
                               size_t num_input_types, EastType *output_type)
{
    try {
        return body(args, num_args, input_types, num_input_types, output_type);
    } catch (const std::exception &e) {
        return eval_error(e.what());
    } catch (...) {
        return eval_error("platform function failed");
    }
}

/* A type with its Recursive wrappers taken off. */
inline EastType *unwrap(EastType *t)
{
    while (t && t->kind == EAST_TYPE_RECURSIVE)
        t = t->data.recursive.node;
    return t;
}

inline std::string msg(const char *fn, const std::string &what)
{
    return std::string(fn) + ": " + what;
}

/* ---- reading ---------------------------------------------------------- */

inline EastValue *field(EastValue *s, const char *name, const char *fn)
{
    EastValue *v = east_struct_get_field(s, name);
    if (!v) throw Error(msg(fn, std::string("expected a struct with a field '") + name + "'"));
    return v;
}

inline int64_t as_integer(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_INTEGER) throw Error(msg(fn, "expected an Integer"));
    return v->data.integer;
}

inline double as_float(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_FLOAT) throw Error(msg(fn, "expected a Float"));
    return v->data.float64;
}

inline bool as_boolean(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_BOOLEAN) throw Error(msg(fn, "expected a Boolean"));
    return v->data.boolean;
}

inline std::string_view as_string(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_STRING) throw Error(msg(fn, "expected a String"));
    return std::string_view(v->data.string.data, v->data.string.len);
}

inline size_t length(EastValue *arr, const char *fn)
{
    if (!arr || arr->kind != EAST_VAL_ARRAY) throw Error(msg(fn, "expected an Array"));
    return east_array_len(arr);
}

inline EastValue *at(EastValue *arr, size_t i)
{
    return east_array_get(arr, i);
}

/* The case of a variant. */
inline const char *case_of(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_VARIANT) throw Error(msg(fn, "expected a Variant"));
    return east_variant_case_name(v);
}

inline bool is_case(EastValue *v, const char *tag, const char *fn)
{
    return std::strcmp(case_of(v, fn), tag) == 0;
}

/* A variant's payload. */
inline EastValue *payload(EastValue *v)
{
    return v->data.variant.value;
}

/* An Option's value, or nullptr for `none`. */
inline EastValue *some_value(EastValue *opt, const char *fn)
{
    return is_case(opt, "some", fn) ? payload(opt) : nullptr;
}

/* The elements of an Array<Integer>. */
inline std::vector<int64_t> integers(EastValue *arr, const char *fn)
{
    size_t n = length(arr, fn);
    std::vector<int64_t> out(n);
    for (size_t i = 0; i < n; i++)
        out[i] = as_integer(at(arr, i), fn);
    return out;
}

/* The elements of an Array<String>. */
inline std::vector<std::string> strings(EastValue *arr, const char *fn)
{
    size_t n = length(arr, fn);
    std::vector<std::string> out;
    out.reserve(n);
    for (size_t i = 0; i < n; i++)
        out.emplace_back(as_string(at(arr, i), fn));
    return out;
}

/* ---- types ------------------------------------------------------------ */

/* The type of a struct type's field. */
inline EastType *field_type(EastType *st, const char *name, const char *fn)
{
    st = unwrap(st);
    if (!st || st->kind != EAST_TYPE_STRUCT)
        throw Error(msg(fn, std::string("the declared output is not a struct with a field '") +
                                name + "'"));
    for (size_t i = 0; i < st->data.struct_.num_fields; i++)
        if (std::strcmp(st->data.struct_.fields[i].name, name) == 0)
            return st->data.struct_.fields[i].type;
    throw Error(msg(fn, std::string("the declared output has no field '") + name + "'"));
}

/* An array type's element type. */
inline EastType *element_type(EastType *t, const char *fn)
{
    t = unwrap(t);
    if (!t ||
        (t->kind != EAST_TYPE_ARRAY && t->kind != EAST_TYPE_SET && t->kind != EAST_TYPE_VECTOR))
        throw Error(msg(fn, "the declared type is not a collection"));
    return t->data.element;
}

/* ---- building --------------------------------------------------------- */

/* A struct of the declared type, one field at a time, in any order; `build`
 * emits the fields in the type's order and takes the values' references. */
class StructBuilder
{
  public:
    StructBuilder(EastType *type, const char *fn) : type_(unwrap(type)), fn_(fn)
    {
        if (!type_ || type_->kind != EAST_TYPE_STRUCT)
            throw Error(msg(fn, "the declared output is not a struct"));
        values_.assign(type_->data.struct_.num_fields, nullptr);
    }
    ~StructBuilder()
    {
        for (EastValue *v : values_)
            if (v) east_value_release(v);
    }
    StructBuilder(const StructBuilder &) = delete;
    StructBuilder &operator=(const StructBuilder &) = delete;

    /* Sets a field, taking the value's reference. */
    StructBuilder &set(const char *name, EastValue *owned)
    {
        for (size_t i = 0; i < type_->data.struct_.num_fields; i++) {
            if (std::strcmp(type_->data.struct_.fields[i].name, name) == 0) {
                if (values_[i]) east_value_release(values_[i]);
                values_[i] = owned;
                return *this;
            }
        }
        if (owned) east_value_release(owned);
        throw Error(msg(fn_, std::string("the declared output has no field '") + name + "'"));
    }

    /* The struct; every field must have been set. */
    EastValue *build()
    {
        std::vector<const char *> names(type_->data.struct_.num_fields);
        for (size_t i = 0; i < names.size(); i++) {
            names[i] = type_->data.struct_.fields[i].name;
            if (!values_[i])
                throw Error(
                    msg(fn_, std::string("the result's field '") + names[i] + "' was not set"));
        }
        EastValue *s = east_struct_new_owned(names.data(), values_.data(), names.size(), type_);
        if (!s) throw Error(msg(fn_, "out of memory"));
        values_.assign(values_.size(), nullptr);
        return s;
    }

  private:
    EastType *type_;
    const char *fn_;
    std::vector<EastValue *> values_;
};

/* A variant of `type` with case `tag`, taking the payload's reference (nullptr
 * for a nullary case). */
inline EastValue *variant(EastType *type, const char *tag, EastValue *owned_payload = nullptr)
{
    EastValue *p = owned_payload ? owned_payload : east_null();
    EastValue *v = east_variant_new(tag, p, unwrap(type));
    if (owned_payload) east_value_release(owned_payload);
    if (!v) throw Error("out of memory");
    return v;
}

inline EastValue *some(EastType *option_type, EastValue *owned)
{
    return variant(option_type, "some", owned);
}

inline EastValue *none(EastType *option_type)
{
    return variant(option_type, "none");
}

inline EastValue *string(std::string_view s)
{
    EastValue *v = east_string_len(s.data(), s.size());
    if (!v) throw Error("out of memory");
    return v;
}

/* An empty dict of the declared dict type. */
inline EastValue *dict(EastType *dict_type, const char *fn)
{
    EastType *t = unwrap(dict_type);
    if (!t || t->kind != EAST_TYPE_DICT) throw Error(msg(fn, "the declared type is not a Dict"));
    EastValue *d = east_dict_new(t->data.dict.key, t->data.dict.value);
    if (!d) throw Error("out of memory");
    return d;
}

/* Sets a dict entry, taking both references. */
inline void dict_put(EastValue *d, EastValue *owned_key, EastValue *owned_value)
{
    east_dict_set(d, owned_key, owned_value);
    east_value_release(owned_key);
    east_value_release(owned_value);
}

/* An empty array of the declared array type. */
inline EastValue *array(EastType *array_type, const char *fn, size_t capacity = 0)
{
    EastValue *a = east_array_new_with_capacity(element_type(array_type, fn), capacity);
    if (!a) throw Error("out of memory");
    return a;
}

/* Appends to an array, taking the reference. */
inline void push(EastValue *arr, EastValue *owned)
{
    east_array_push(arr, owned);
    east_value_release(owned);
}

/* An Array<Integer> of the declared type. */
inline EastValue *integer_array(EastType *array_type, const std::vector<int64_t> &xs,
                                const char *fn)
{
    EastValue *a = array(array_type, fn, xs.size());
    for (int64_t x : xs)
        push(a, east_integer(x));
    return a;
}

/* The payload type of a variant type's case. */
inline EastType *case_type(EastType *variant_type, const char *tag, const char *fn)
{
    EastType *vt = unwrap(variant_type);
    if (!vt || vt->kind != EAST_TYPE_VARIANT)
        throw Error(
            msg(fn, std::string("the declared output is not a variant with a case '") + tag + "'"));
    size_t idx = east_variant_type_case_idx(vt, tag);
    if (idx == SIZE_MAX)
        throw Error(msg(fn, std::string("the declared output has no case '") + tag + "'"));
    return vt->data.variant.cases[idx].type;
}

/* ---- tensors ---------------------------------------------------------- */

/* The elements of a Vector<Float>. */
inline std::vector<double> vector_floats(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_VECTOR || !v->data.vector.elem_type ||
        unwrap(v->data.vector.elem_type)->kind != EAST_TYPE_FLOAT)
        throw Error(msg(fn, "expected a Vector<Float>"));
    const double *d = static_cast<const double *>(v->data.vector.data);
    return std::vector<double>(d, d + v->data.vector.len);
}

/* The elements of a Vector<Integer>. */
inline std::vector<int64_t> vector_integers(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_VECTOR || !v->data.vector.elem_type ||
        unwrap(v->data.vector.elem_type)->kind != EAST_TYPE_INTEGER)
        throw Error(msg(fn, "expected a Vector<Integer>"));
    const int64_t *d = static_cast<const int64_t *>(v->data.vector.data);
    return std::vector<int64_t>(d, d + v->data.vector.len);
}

/* The elements of a Vector<Boolean>. */
inline std::vector<bool> vector_booleans(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_VECTOR || !v->data.vector.elem_type ||
        unwrap(v->data.vector.elem_type)->kind != EAST_TYPE_BOOLEAN)
        throw Error(msg(fn, "expected a Vector<Boolean>"));
    const bool *d = static_cast<const bool *>(v->data.vector.data);
    return std::vector<bool>(d, d + v->data.vector.len);
}

/* A Matrix<Float>'s shape and row-major elements. */
struct Matrix {
    size_t rows = 0, cols = 0;
    std::vector<double> data;
};

inline Matrix matrix_floats(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_MATRIX || !v->data.matrix.elem_type ||
        unwrap(v->data.matrix.elem_type)->kind != EAST_TYPE_FLOAT)
        throw Error(msg(fn, "expected a Matrix<Float>"));
    Matrix m;
    m.rows = v->data.matrix.rows;
    m.cols = v->data.matrix.cols;
    const double *d = static_cast<const double *>(v->data.matrix.data);
    m.data.assign(d, d + m.rows * m.cols);
    return m;
}

/* The bytes of a Blob. */
inline std::string_view blob_bytes(EastValue *v, const char *fn)
{
    if (!v || v->kind != EAST_VAL_BLOB) throw Error(msg(fn, "expected a Blob"));
    return std::string_view(reinterpret_cast<const char *>(v->data.blob.data), v->data.blob.len);
}

inline EastValue *blob(const void *data, size_t len)
{
    EastValue *v = east_blob(static_cast<const uint8_t *>(data), len);
    if (!v) throw Error("out of memory");
    return v;
}

inline EastValue *integer_vector(const std::vector<int64_t> &xs)
{
    EastValue *v = east_vector_new_uninit(&east_integer_type, xs.size());
    if (!v) throw Error("out of memory");
    if (!xs.empty()) std::memcpy(v->data.vector.data, xs.data(), xs.size() * sizeof(int64_t));
    return v;
}

inline EastValue *boolean_vector(const std::vector<uint8_t> &xs)
{
    EastValue *v = east_vector_new(&east_boolean_type, xs.size());
    bool *data = static_cast<bool *>(v->data.vector.data);
    for (size_t k = 0; k < xs.size(); k++)
        data[k] = xs[k] != 0;
    return v;
}

inline EastValue *float_vector(const std::vector<double> &xs)
{
    EastValue *v = east_vector_new_uninit(&east_float_type, xs.size());
    if (!v) throw Error("out of memory");
    if (!xs.empty()) std::memcpy(v->data.vector.data, xs.data(), xs.size() * sizeof(double));
    return v;
}

/* A Matrix<Float> from row-major elements. */
inline EastValue *float_matrix(size_t rows, size_t cols, const std::vector<double> &data)
{
    EastValue *v = east_matrix_new_uninit(&east_float_type, rows, cols);
    if (!v) throw Error("out of memory");
    if (!data.empty()) std::memcpy(v->data.matrix.data, data.data(), rows * cols * sizeof(double));
    return v;
}

/* A Float as python prints it: the shortest round-tripping digits, with a
 * `.0` on a whole number — what east-py-datascience's messages hold. */
inline std::string python_float(double x)
{
    char buf[64];
    east_fmt_double(buf, sizeof(buf), x);
    std::string s(buf);
    if (s.find_first_of(".eEn") == std::string::npos && s != "Infinity" && s != "-Infinity")
        s += ".0";
    return s;
}

/* ---- time ------------------------------------------------------------- */

using Clock = std::chrono::steady_clock;

/* east-c's profiler, two of its entry points (east/compiler.h, which this C++
 * cannot include: its IR header is C alone). The runtime the binary exports
 * provides them when the library is opened. */
extern "C" {
bool east_profile_enabled(void);
void east_profile_platform_note(const char *name, uint64_t convert_in_ns, uint64_t convert_out_ns,
                                uint64_t crossings);
}

/* What a call spent outside the native library (#1357, R30): its build (the
 * arguments into the library's structures, `build_s`) and its write-back (the
 * result into East values, `writeback_s`), reported to east-c's profiler as
 * the bridge line under the function's own entry — what east-py's bridge
 * reports for its python functions — when the profiler is on. Off, nothing. */
inline void note_bridge(const char *fn, double build_s, double writeback_s)
{
    if (!east_profile_enabled()) return;
    east_profile_platform_note(fn, (uint64_t)(build_s > 0 ? build_s * 1e9 : 0),
                               (uint64_t)(writeback_s > 0 ? writeback_s * 1e9 : 0), 0);
}

inline Clock::time_point now()
{
    return Clock::now();
}

/* Seconds since `start`, as a result's `wall_time`. */
inline double seconds_since(Clock::time_point start)
{
    return std::chrono::duration<double>(now() - start).count();
}

} // namespace east_ds

#endif
