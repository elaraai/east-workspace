/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* nn_init, nn_run and nn_train on the C runtime (docs/neural-networks.md §5):
 * the East boundary of the libtorch interpreter, and the caches that keep a
 * network's plan and its prepared weights between calls. */
#include "plan.h"
#include "torch_interp.h"

#include "../value_util.h"

#include <ATen/CPUGeneratorImpl.h>

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
using nn::Tensors;
using torch::Tensor;

// ---- East ↔ tensors ---------------------------------------------------------

Tensor tensor_of_struct(EastValue *s, DType dtype, const char *fn, const std::string &what)
{
    std::vector<int64_t> shape = integers(field(s, "shape", fn), fn);
    for (int64_t d : shape)
        if (d < 0)
            throw Error(msg(fn, "'" + what + "' has a negative dimension in its shape " +
                                    nn::shape_text(shape)));
    EastValue *data = field(s, "data", fn);
    int64_t count = 1;
    for (int64_t d : shape)
        count *= d;
    Tensor t;
    int64_t n;
    switch (dtype) {
    case DType::Float: {
        std::vector<double> xs = vector_floats(data, fn);
        n = (int64_t)xs.size();
        t = torch::from_blob(xs.data(), {n}, torch::kFloat64).to(torch::kFloat32);
        break;
    }
    case DType::Integer: {
        std::vector<int64_t> xs = vector_integers(data, fn);
        n = (int64_t)xs.size();
        t = torch::from_blob(xs.data(), {n}, torch::kInt64).clone();
        break;
    }
    default: {
        std::vector<bool> bits = vector_booleans(data, fn);
        std::vector<uint8_t> bytes(bits.size());
        for (size_t k = 0; k < bits.size(); k++)
            bytes[k] = bits[k] ? 1 : 0;
        n = (int64_t)bytes.size();
        t = torch::from_blob(bytes.data(), {n}, torch::kBool).clone();
    }
    }
    if (n != count)
        throw Error(msg(fn, "'" + what + "' has " + std::to_string(n) + " elements but its shape " +
                                nn::shape_text(shape) + " holds " + std::to_string(count)));
    return t.reshape(shape);
}

Tensor tensor_of_value(EastValue *v, const char *fn, const std::string &name)
{
    return tensor_of_struct(payload(v), nn::dtype_of_name(case_of(v, fn)), fn, name);
}

EastValue *struct_of_tensor(const Tensor &tensor, EastType *struct_type, const char *fn)
{
    Tensor t = tensor.detach().to(torch::kCPU).contiguous();
    StructBuilder b(struct_type, fn);
    std::vector<int64_t> shape(t.sizes().begin(), t.sizes().end());
    b.set("shape", integer_array(field_type(struct_type, "shape", fn), shape, fn));
    size_t n = (size_t)t.numel();
    switch (nn::dtype_of_tensor(t)) {
    case DType::Float: {
        Tensor d = t.to(torch::kFloat64);
        b.set("data",
              float_vector(std::vector<double>(d.data_ptr<double>(), d.data_ptr<double>() + n)));
        break;
    }
    case DType::Integer: {
        Tensor i = t.to(torch::kInt64);
        b.set("data", integer_vector(
                          std::vector<int64_t>(i.data_ptr<int64_t>(), i.data_ptr<int64_t>() + n)));
        break;
    }
    case DType::Boolean: {
        std::vector<uint8_t> bytes(n);
        const bool *p = t.data_ptr<bool>();
        for (size_t k = 0; k < n; k++)
            bytes[k] = p[k] ? 1 : 0;
        b.set("data", boolean_vector(bytes));
        break;
    }
    }
    return b.build();
}

EastValue *value_of_tensor(const Tensor &t, EastType *value_type, const char *fn)
{
    const char *tag = nn::dtype_name(nn::dtype_of_tensor(t));
    return variant(value_type, tag, struct_of_tensor(t, case_type(value_type, tag, fn), fn));
}

uint64_t fnv(uint64_t h, const void *data, size_t len)
{
    const unsigned char *p = static_cast<const unsigned char *>(data);
    for (size_t k = 0; k < len; k++) {
        h ^= p[k];
        h *= 1099511628211ULL;
    }
    return h;
}

/* The weights as f32 CPU tensors, and a key over their names, shapes and bytes. */
Tensors weights_of_dict(EastValue *dict, const char *fn, std::string *key)
{
    Tensors out;
    uint64_t h = 1469598103934665603ULL;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        std::string name(as_string(east_dict_key_at(dict, k), fn));
        EastValue *s = east_dict_val_at(dict, k);
        std::vector<int64_t> shape = integers(field(s, "shape", fn), fn);
        std::vector<double> xs = vector_floats(field(s, "data", fn), fn);
        h = fnv(h, name.data(), name.size());
        h = fnv(h, shape.data(), shape.size() * sizeof(int64_t));
        h = fnv(h, xs.data(), xs.size() * sizeof(double));
        out[name] = tensor_of_struct(s, DType::Float, fn, name);
    }
    if (key) *key = std::to_string(h);
    return out;
}

Tensors batch_of_dict(EastValue *dict, const char *fn, torch::Device device)
{
    Tensors out;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        std::string name(as_string(east_dict_key_at(dict, k), fn));
        out[name] = tensor_of_value(east_dict_val_at(dict, k), fn, name).to(device);
    }
    return out;
}

torch::Device device_of(EastValue *tag_value, const char *fn)
{
    std::string tag = case_of(tag_value, fn);
    if (tag == "cpu") return torch::Device(torch::kCPU);
    if (tag == "cuda") {
        if (!torch::cuda::is_available())
            throw Error(msg(fn, "CUDA is not available: this east-c is linked against a CPU "
                                "libtorch, or no GPU is present"));
        return torch::Device(torch::kCUDA);
    }
    return torch::Device(torch::cuda::is_available() ? torch::kCUDA : torch::kCPU);
}

// ---- caches -----------------------------------------------------------------

/* A structural hash of an East value (what the plan cache keys a network by). */
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
    std::shared_ptr<const Tensors> weights;
};

std::mutex g_cache_mutex;
std::list<PlanEntry> g_plans;
std::list<WeightEntry> g_weights;
const size_t PLAN_CACHE = 16, WEIGHT_CACHE = 8;

std::shared_ptr<const Plan> plan_for(EastValue *net, const char *fn, std::string &key)
{
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

std::shared_ptr<const Tensors> prepared_for(const Plan &plan, const std::string &plan_key,
                                            EastValue *weights_dict, torch::Device device,
                                            const char *fn)
{
    std::string weights_key;
    Tensors weights = weights_of_dict(weights_dict, fn, &weights_key);
    std::string key = plan_key + "|" + weights_key + "|" + device.str();
    std::lock_guard<std::mutex> lock(g_cache_mutex);
    for (auto it = g_weights.begin(); it != g_weights.end(); ++it)
        if (it->key == key) {
            g_weights.splice(g_weights.begin(), g_weights, it);
            return g_weights.front().weights;
        }
    auto prepared =
        std::make_shared<const Tensors>(nn::prepare_weights(plan, weights, device, fn, false));
    g_weights.push_front({key, prepared});
    while (g_weights.size() > WEIGHT_CACHE)
        g_weights.pop_back();
    return prepared;
}

// ---- platform functions -----------------------------------------------------

EvalResult nn_init(EastValue **args, size_t, EastType **, size_t, EastType *output_type)
{
    const char *fn = "nn_init";
    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], fn, key);
    std::map<std::string, nn::ParamSpec> specs;
    nn::collect_weights(*plan, fn, "", specs);
    torch::Generator generator = at::detail::createCPUGenerator((uint64_t)as_integer(args[1], fn));
    EastType *struct_type = unwrap(output_type)->data.dict.value;
    EastValue *d = dict(output_type, fn);
    for (const auto &kv : specs)
        dict_put(d, string(kv.first),
                 struct_of_tensor(nn::init_tensor(kv.second, generator, fn), struct_type, fn));
    return eval_ok(d);
}

EvalResult nn_run(EastValue **args, size_t, EastType **, size_t, EastType *output_type)
{
    const char *fn = "nn_run";
    EastValue *config = args[4];
    torch::Device device = device_of(field(config, "device", fn), fn);
    int64_t seed = as_integer(field(config, "seed", fn), fn);
    bool training = as_boolean(field(config, "training", fn), fn);

    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], fn, key);
    std::vector<std::string> names = strings(args[3], fn), operands;
    for (const std::string &name : names) {
        const std::string *operand = plan->output(name);
        if (!operand) throw Error(msg(fn, "unknown output '" + name + "'"));
        operands.push_back(*operand);
    }
    auto prepared = prepared_for(*plan, key, args[1], device, fn);
    Tensors inputs = batch_of_dict(args[2], fn, device);
    Tensors values;
    {
        torch::NoGradGuard no_grad;
        nn::Interpreter interpreter(fn, device, training, (uint64_t)seed);
        values = interpreter.run(*plan, *prepared, inputs, operands);
    }
    EastType *value_type = unwrap(output_type)->data.dict.value;
    EastValue *d = dict(output_type, fn);
    for (size_t k = 0; k < names.size(); k++)
        dict_put(d, string(names[k]), value_of_tensor(values.at(operands[k]), value_type, fn));
    return eval_ok(d);
}

nn::TrainConfig train_config(EastValue *config, const char *fn)
{
    nn::TrainConfig c;
    c.loss = std::string(as_string(field(config, "loss", fn), fn));
    if (EastValue *v = some_value(field(config, "validation", fn), fn))
        c.validation = std::string(as_string(v, fn));
    EastValue *optimizer = field(config, "optimizer", fn);
    EastValue *adamw = payload(optimizer);
    c.lr = as_float(field(adamw, "lr", fn), fn);
    c.beta1 = as_float(field(adamw, "beta1", fn), fn);
    c.beta2 = as_float(field(adamw, "beta2", fn), fn);
    c.eps = as_float(field(adamw, "eps", fn), fn);
    c.weight_decay = as_float(field(adamw, "weight_decay", fn), fn);
    EastValue *schedule = field(config, "schedule", fn);
    c.schedule = case_of(schedule, fn);
    if (c.schedule != "constant") {
        c.warmup_steps = as_integer(field(payload(schedule), "warmup_steps", fn), fn);
        if (c.schedule == "warmup_cosine")
            c.min_lr = as_float(field(payload(schedule), "min_lr", fn), fn);
    }
    if (EastValue *v = some_value(field(config, "clip_norm", fn), fn))
        c.clip_norm = as_float(v, fn);
    if (EastValue *v = some_value(field(config, "ema_decay", fn), fn))
        c.ema_decay = as_float(v, fn);
    c.epochs = as_integer(field(config, "epochs", fn), fn);
    if (EastValue *v = some_value(field(config, "patience", fn), fn))
        c.patience = as_integer(v, fn);
    c.bf16 = std::string(case_of(field(config, "precision", fn), fn)) == "bf16";
    c.seed = (uint64_t)as_integer(field(config, "seed", fn), fn);
    c.device = device_of(field(config, "device", fn), fn);
    EastValue *recompute = field(config, "recompute", fn);
    for (size_t k = 0, n = east_set_len(recompute); k < n; k++)
        c.recompute.insert(std::string(as_string(east_set_at(recompute, k), fn)));
    return c;
}

EvalResult nn_train(EastValue **args, size_t, EastType **, size_t, EastType *output_type)
{
    const char *fn = "nn_train";
    nn::TrainConfig config = train_config(args[4], fn);
    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], fn, key);
    Tensors weights = weights_of_dict(args[1], fn, nullptr);
    std::vector<Tensors> batches, validation;
    for (size_t k = 0, n = length(args[2], fn); k < n; k++)
        batches.push_back(batch_of_dict(at(args[2], k), fn, config.device));
    for (size_t k = 0, n = length(args[3], fn); k < n; k++)
        validation.push_back(batch_of_dict(at(args[3], k), fn, config.device));
    nn::TrainResult result = nn::train(*plan, weights, batches, validation, config, fn);

    EastType *weights_type = field_type(output_type, "weights", fn);
    EastType *history_type = field_type(output_type, "history", fn);
    EastType *entry_type = element_type(history_type, fn);
    EastType *validation_type = field_type(entry_type, "validation", fn);
    StructBuilder r(output_type, fn);
    EastValue *w = dict(weights_type, fn);
    for (const auto &kv : result.weights)
        dict_put(w, string(kv.first),
                 struct_of_tensor(kv.second, unwrap(weights_type)->data.dict.value, fn));
    r.set("weights", w);
    EastValue *history = array(history_type, fn, result.history.size());
    for (const nn::HistoryEntry &h : result.history) {
        StructBuilder e(entry_type, fn);
        e.set("epoch", east_integer(h.epoch));
        e.set("loss", east_float(h.loss));
        e.set("validation", h.validation ? some(validation_type, east_float(*h.validation))
                                         : none(validation_type));
        e.set("learning_rate", east_float(h.learning_rate));
        push(history, e.build());
    }
    r.set("history", history);
    r.set("best_epoch", east_integer(result.best_epoch));
    return eval_ok(r.build());
}

} // namespace

void register_nn(PlatformRegistry *reg)
{
    platform_registry_add(reg, "nn_init", platform_call_typed<nn_init>, false);
    platform_registry_add(reg, "nn_run", platform_call_typed<nn_run>, false);
    platform_registry_add(reg, "nn_train", platform_call_typed<nn_train>, false);
}

} // namespace east_ds
