/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* nn_init and nn_run on the C runtime (docs/neural-networks.md §5): the East
 * boundary of the interpreter, and the caches that keep a network's plan and
 * its prepared weights between calls. nn_train stays in torch. */
#include "interp.h"
#include "plan.h"

#include "../value_util.h"

#include <algorithm>
#include <cstring>
#include <list>
#include <mutex>

namespace east_ds
{

namespace
{

using nn::DType;
using nn::Plan;
using nn::Tensor;
using nn::TensorPtr;

// ---- East ↔ tensors ---------------------------------------------------------

TensorPtr tensor_of_struct(EastValue *s, DType dtype, const char *fn, const std::string &what)
{
    auto t = std::make_shared<Tensor>();
    t->dtype = dtype;
    t->shape = integers(field(s, "shape", fn), fn);
    for (int64_t d : t->shape)
        if (d < 0)
            throw Error(msg(fn, "'" + what + "' has a negative dimension in its shape " +
                                    nn::shape_text(t->shape)));
    EastValue *data = field(s, "data", fn);
    size_t n;
    switch (dtype) {
    case DType::Float:
        t->f = vector_floats(data, fn);
        n = t->f.size();
        break;
    case DType::Integer:
        t->i = vector_integers(data, fn);
        n = t->i.size();
        break;
    default: {
        std::vector<bool> bits = vector_booleans(data, fn);
        t->b.assign(bits.size(), 0);
        for (size_t k = 0; k < bits.size(); k++)
            t->b[k] = bits[k] ? 1 : 0;
        n = t->b.size();
    }
    }
    int64_t count = nn::numel_of(t->shape);
    if ((int64_t)n != count)
        throw Error(msg(fn, "'" + what + "' has " + std::to_string(n) + " elements but its shape " +
                                nn::shape_text(t->shape) + " holds " + std::to_string(count)));
    return t;
}

TensorPtr tensor_of_value(EastValue *v, const char *fn, const std::string &name)
{
    return tensor_of_struct(payload(v), nn::dtype_of_name(case_of(v, fn)), fn, name);
}

EastValue *struct_of_tensor(const Tensor &t, EastType *struct_type, const char *fn)
{
    StructBuilder b(struct_type, fn);
    b.set("shape", integer_array(field_type(struct_type, "shape", fn), t.shape, fn));
    switch (t.dtype) {
    case DType::Float:
        b.set("data", float_vector(t.f));
        break;
    case DType::Integer:
        b.set("data", integer_vector(t.i));
        break;
    case DType::Boolean:
        b.set("data", boolean_vector(t.b));
        break;
    }
    return b.build();
}

EastValue *value_of_tensor(const Tensor &t, EastType *value_type, const char *fn)
{
    const char *tag = nn::dtype_name(t.dtype);
    return variant(value_type, tag, struct_of_tensor(t, case_type(value_type, tag, fn), fn));
}

std::map<std::string, TensorPtr> weights_of_dict(EastValue *dict, const char *fn)
{
    std::map<std::string, TensorPtr> out;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        std::string name(as_string(east_dict_key_at(dict, k), fn));
        out[name] = tensor_of_struct(east_dict_val_at(dict, k), DType::Float, fn, name);
    }
    return out;
}

std::map<std::string, TensorPtr> batch_of_dict(EastValue *dict, const char *fn)
{
    std::map<std::string, TensorPtr> out;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        std::string name(as_string(east_dict_key_at(dict, k), fn));
        out[name] = tensor_of_value(east_dict_val_at(dict, k), fn, name);
    }
    return out;
}

// ---- caches -----------------------------------------------------------------

uint64_t fnv(uint64_t h, const void *data, size_t len)
{
    const unsigned char *p = static_cast<const unsigned char *>(data);
    for (size_t k = 0; k < len; k++) {
        h ^= p[k];
        h *= 1099511628211ULL;
    }
    return h;
}

std::string weights_key(const std::map<std::string, TensorPtr> &weights)
{
    uint64_t h = 1469598103934665603ULL;
    for (const auto &kv : weights) {
        h = fnv(h, kv.first.data(), kv.first.size());
        h = fnv(h, kv.second->shape.data(), kv.second->shape.size() * sizeof(int64_t));
        h = fnv(h, kv.second->f.data(), kv.second->f.size() * sizeof(double));
    }
    return std::to_string(h);
}

/* A structural hash of an East value (what the plan cache keys a network by):
 * two 64-bit FNV-1a runs over its kinds, names, cases and scalars. */
uint64_t hash_value(EastValue *v, uint64_t h, const char *fn)
{
    if (!v) return fnv(h, "-", 1);
    int kind = (int)v->kind;
    h = fnv(h, &kind, sizeof kind);
    switch (v->kind) {
    case EAST_VAL_NULL:
        return h;
    case EAST_VAL_BOOLEAN: {
        unsigned char b = as_boolean(v, fn) ? 1 : 0;
        return fnv(h, &b, 1);
    }
    case EAST_VAL_INTEGER: {
        int64_t i = as_integer(v, fn);
        return fnv(h, &i, sizeof i);
    }
    case EAST_VAL_FLOAT: {
        double d = as_float(v, fn);
        return fnv(h, &d, sizeof d);
    }
    case EAST_VAL_STRING: {
        std::string_view s = as_string(v, fn);
        h = fnv(h, s.data(), s.size());
        return fnv(h, "", 1);
    }
    case EAST_VAL_ARRAY: {
        size_t n = length(v, fn);
        h = fnv(h, &n, sizeof n);
        for (size_t k = 0; k < n; k++)
            h = hash_value(at(v, k), h, fn);
        return h;
    }
    case EAST_VAL_DICT: {
        size_t n = east_dict_len(v);
        h = fnv(h, &n, sizeof n);
        for (size_t k = 0; k < n; k++) {
            h = hash_value(east_dict_key_at(v, k), h, fn);
            h = hash_value(east_dict_val_at(v, k), h, fn);
        }
        return h;
    }
    case EAST_VAL_STRUCT: {
        size_t n = v->data.struct_.num_fields;
        h = fnv(h, &n, sizeof n);
        for (size_t k = 0; k < n; k++) {
            const char *name = east_struct_field_name(v, k);
            if (name) h = fnv(h, name, std::strlen(name));
            h = hash_value(east_struct_get_field_idx(v, k), h, fn);
        }
        return h;
    }
    case EAST_VAL_VARIANT: {
        const char *tag = case_of(v, fn);
        h = fnv(h, tag, std::strlen(tag));
        return hash_value(payload(v), h, fn);
    }
    case EAST_VAL_VECTOR: {
        size_t n = v->data.vector.len;
        h = fnv(h, &n, sizeof n);
        EastType *elem = unwrap(v->data.vector.elem_type);
        size_t width = elem && elem->kind == EAST_TYPE_BOOLEAN ? sizeof(bool) : 8;
        return fnv(h, v->data.vector.data, n * width);
    }
    default:
        throw Error(msg(fn, "cannot key the network: an unexpected value kind"));
    }
}

std::string value_key(EastValue *v, const char *fn)
{
    return std::to_string(hash_value(v, 1469598103934665603ULL, fn)) + ":" +
           std::to_string(hash_value(v, 0x9E3779B97F4A7C15ULL, fn));
}

struct PlanEntry {
    std::string key;
    std::shared_ptr<const Plan> plan;
};
struct WeightEntry {
    std::string key;
    std::shared_ptr<const std::map<std::string, TensorPtr> > weights;
};

std::mutex g_cache_mutex;
std::list<PlanEntry> g_plans;
std::list<WeightEntry> g_weights;
const size_t PLAN_CACHE = 16, WEIGHT_CACHE = 8;

std::shared_ptr<const Plan> plan_for(EastValue *net, EastType *net_type, const char *fn,
                                     std::string &key)
{
    (void)net_type;
    key = value_key(net, fn);
    std::lock_guard<std::mutex> lock(g_cache_mutex);
    for (auto it = g_plans.begin(); it != g_plans.end(); ++it)
        if (it->key == key) {
            g_plans.splice(g_plans.begin(), g_plans, it);
            return g_plans.front().plan;
        }
    std::shared_ptr<const Plan> plan = nn::build_plan(net, fn);
    g_plans.push_front({key, plan});
    while (g_plans.size() > PLAN_CACHE)
        g_plans.pop_back();
    return plan;
}

std::shared_ptr<const std::map<std::string, TensorPtr> >
prepared_for(const Plan &plan, const std::string &plan_key, EastValue *weights_dict, const char *fn)
{
    std::map<std::string, TensorPtr> weights = weights_of_dict(weights_dict, fn);
    std::string key = plan_key + "|" + weights_key(weights);
    std::lock_guard<std::mutex> lock(g_cache_mutex);
    for (auto it = g_weights.begin(); it != g_weights.end(); ++it)
        if (it->key == key) {
            g_weights.splice(g_weights.begin(), g_weights, it);
            return g_weights.front().weights;
        }
    auto prepared = std::make_shared<const std::map<std::string, TensorPtr> >(
        nn::prepare_weights(plan, weights, fn));
    g_weights.push_front({key, prepared});
    while (g_weights.size() > WEIGHT_CACHE)
        g_weights.pop_back();
    return prepared;
}

// ---- platform functions -----------------------------------------------------

EvalResult nn_init(EastValue **args, size_t, EastType **input_types, size_t, EastType *output_type)
{
    const char *fn = "nn_init";
    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], input_types[0], fn, key);
    std::map<std::string, nn::ParamSpec> specs;
    nn::collect_weights(*plan, fn, "", specs);
    nn::Rng rng((uint64_t)as_integer(args[1], fn));
    EastType *struct_type = unwrap(output_type)->data.dict.value;
    EastValue *d = dict(output_type, fn);
    for (const auto &kv : specs) {
        Tensor t = nn::init_tensor(kv.second, rng, fn);
        dict_put(d, string(kv.first), struct_of_tensor(t, struct_type, fn));
    }
    return eval_ok(d);
}

EvalResult nn_run(EastValue **args, size_t, EastType **input_types, size_t, EastType *output_type)
{
    const char *fn = "nn_run";
    EastValue *config = args[4];
    std::string device = case_of(field(config, "device", fn), fn);
    if (device == "cuda")
        throw Error(msg(fn, "CUDA is not available in this build: the C runtime runs on the CPU"));
    int64_t seed = as_integer(field(config, "seed", fn), fn);
    bool training = as_boolean(field(config, "training", fn), fn);

    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], input_types[0], fn, key);
    std::vector<std::string> names = strings(args[3], fn);
    std::vector<std::string> operands;
    for (const std::string &name : names) {
        const std::string *operand = plan->output(name);
        if (!operand) throw Error(msg(fn, "unknown output '" + name + "'"));
        operands.push_back(*operand);
    }
    auto prepared = prepared_for(*plan, key, args[1], fn);
    std::map<std::string, TensorPtr> inputs = batch_of_dict(args[2], fn);
    nn::Interpreter interpreter(fn, training, (uint64_t)seed);
    std::map<std::string, TensorPtr> values = interpreter.run(*plan, *prepared, inputs, operands);
    EastType *value_type = unwrap(output_type)->data.dict.value;
    EastValue *d = dict(output_type, fn);
    for (size_t k = 0; k < names.size(); k++)
        dict_put(d, string(names[k]), value_of_tensor(*values.at(operands[k]), value_type, fn));
    return eval_ok(d);
}

} // namespace

void register_nn(PlatformRegistry *reg)
{
    platform_registry_add(reg, "nn_init", platform_call_typed<nn_init>, false);
    platform_registry_add(reg, "nn_run", platform_call_typed<nn_run>, false);
}

} // namespace east_ds
