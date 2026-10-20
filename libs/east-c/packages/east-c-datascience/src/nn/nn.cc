/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* nn_init, nn_run and nn_train on the C runtime (docs/neural-networks.md §5):
 * the East boundary of the libtorch interpreter, and the caches that keep a
 * network's plan and its prepared weights between calls. */
#include "nn_entry.h"
#include "plan.h"
#include "torch_interp.h"

#include "../value_util.h"

#include <ATen/CPUGeneratorImpl.h>
#include <caffe2/serialize/in_memory_adapter.h>
#include <caffe2/serialize/inline_container.h>
#include <torch/version.h>

#include <algorithm>
#include <cstring>
#include <list>
#include <mutex>
#include <set>

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
    case DType::Float64: {
        std::vector<double> xs = vector_floats(data, fn);
        n = (int64_t)xs.size();
        t = torch::from_blob(xs.data(), {n}, torch::kFloat64).clone();
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
    case DType::Float:
    case DType::Float64: {
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

/* The weights as f32 CPU tensors. */
Tensors weights_of_dict(EastValue *dict, const char *fn)
{
    Tensors out;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        std::string name(as_string(east_dict_key_at(dict, k), fn));
        out[name] = tensor_of_struct(east_dict_val_at(dict, k), DType::Float, fn, name);
    }
    return out;
}

/* A weights value's identity, in O(weights) rather than O(elements) (#1357,
 * R24): each weight's name, shape and the address and length of its data
 * vector. A Vector is immutable, so the same vector at the same address holds
 * the same elements; the cache retains every vector it keys on, so no address
 * is reused while its entry lives. Two weights values built from the same
 * vectors (a dict copied, a frozen input read again) share one entry. */
std::string weights_identity(EastValue *dict, const char *fn, std::vector<EastValue *> *vectors)
{
    std::string key;
    for (size_t k = 0, n = east_dict_len(dict); k < n; k++) {
        EastValue *s = east_dict_val_at(dict, k);
        EastValue *shape = field(s, "shape", fn), *data = field(s, "data", fn);
        key += as_string(east_dict_key_at(dict, k), fn);
        key += '[';
        for (size_t i = 0, m = length(shape, fn); i < m; i++) {
            if (i) key += ',';
            key += std::to_string(as_integer(at(shape, i), fn));
        }
        key += "]@" + std::to_string((uintptr_t)data) + ";";
        if (vectors) vectors->push_back(data);
    }
    return key;
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
    std::vector<EastValue *>
        vectors; /* retained: their addresses stay theirs while the entry lives */
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
    std::vector<EastValue *> vectors;
    std::string key =
        plan_key + "|" + device.str() + "|" + weights_identity(weights_dict, fn, &vectors);
    std::lock_guard<std::mutex> lock(g_cache_mutex);
    for (auto it = g_weights.begin(); it != g_weights.end(); ++it)
        if (it->key == key) {
            g_weights.splice(g_weights.begin(), g_weights, it);
            return g_weights.front().weights;
        }
    Tensors weights = weights_of_dict(weights_dict, fn);
    auto prepared =
        std::make_shared<const Tensors>(nn::prepare_weights(plan, weights, device, fn, false));
    for (EastValue *v : vectors)
        east_value_retain(v);
    g_weights.push_front({key, prepared, std::move(vectors)});
    while (g_weights.size() > WEIGHT_CACHE) {
        for (EastValue *v : g_weights.back().vectors)
            east_value_release(v);
        g_weights.pop_back();
    }
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
    Clock::time_point t0 = now();
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
    double build_time =
        seconds_since(t0); /* the plan, the weights, the batch: to the forward pass */
    Tensors values;
    {
        torch::NoGradGuard no_grad;
        nn::Interpreter interpreter(fn, device, training, (uint64_t)seed);
        values = interpreter.run(*plan, *prepared, inputs, operands);
    }
    Clock::time_point t2 = now();
    EastType *value_type = unwrap(output_type)->data.dict.value;
    EastValue *d = dict(output_type, fn);
    for (size_t k = 0; k < names.size(); k++)
        dict_put(d, string(names[k]), value_of_tensor(values.at(operands[k]), value_type, fn));
    note_bridge(fn, build_time, seconds_since(t2));
    return eval_ok(d);
}

nn::TrainConfig train_config(EastValue *config, const char *fn)
{
    nn::TrainConfig c;
    c.loss = std::string(as_string(field(config, "loss", fn), fn));
    if (EastValue *v = some_value(field(config, "validation", fn), fn)) {
        c.validation = std::string(as_string(field(v, "value", fn), fn));
        if (EastValue *w = some_value(field(v, "weight", fn), fn))
            c.validation_weight = std::string(as_string(w, fn));
    }
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
        c.per_epoch = std::string(case_of(field(payload(schedule), "unit", fn), fn)) == "epoch";
    }
    if (EastValue *v = some_value(field(config, "clip_norm", fn), fn))
        c.clip_norm = as_float(v, fn);
    if (EastValue *v = some_value(field(config, "ema", fn), fn)) {
        c.ema_decay = as_float(field(v, "decay", fn), fn);
        c.ema_warmup = as_boolean(field(v, "warmup", fn), fn);
    }
    c.shuffle = as_boolean(field(config, "shuffle", fn), fn);
    c.epochs = as_integer(field(config, "epochs", fn), fn);
    if (EastValue *v = some_value(field(config, "patience", fn), fn))
        c.patience = as_integer(v, fn);
    c.bf16 = std::string(case_of(field(config, "precision", fn), fn)) == "bf16";
    c.seed = as_integer(field(config, "seed", fn), fn);
    c.device = device_of(field(config, "device", fn), fn);
    EastValue *recompute = field(config, "recompute", fn);
    for (size_t k = 0, n = east_set_len(recompute); k < n; k++)
        c.recompute.insert(std::string(as_string(east_set_at(recompute, k), fn)));
    if (EastValue *v = some_value(field(config, "progress", fn), fn))
        c.progress = as_integer(v, fn);
    return c;
}

EvalResult nn_train(EastValue **args, size_t, EastType **, size_t, EastType *output_type)
{
    const char *fn = "nn_train";
    Clock::time_point t0 = now();
    nn::TrainConfig config = train_config(args[4], fn);
    std::string key;
    std::shared_ptr<const Plan> plan = plan_for(args[0], fn, key);
    Tensors weights = weights_of_dict(args[1], fn);
    std::vector<Tensors> batches, validation;
    for (size_t k = 0, n = length(args[2], fn); k < n; k++)
        batches.push_back(batch_of_dict(at(args[2], k), fn, torch::kCPU));
    for (size_t k = 0, n = length(args[3], fn); k < n; k++)
        validation.push_back(batch_of_dict(at(args[3], k), fn, torch::kCPU));
    double build_time = seconds_since(t0); /* the plan, the weights and the batches, decoded */
    nn::TrainResult result = nn::train(*plan, weights, batches, validation, config, fn);
    Clock::time_point t2 = now();

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
    note_bridge(fn, build_time, seconds_since(t2));
    return eval_ok(r.build());
}

// ---- torch state dicts (spec §5) ---------------------------------------------

/* The byte length of a pickle opcode's argument at `at`, for the opcodes a
 * torch.save state dict uses; -1 for any other. */
long pickle_arg_len(const unsigned char *p, size_t n, size_t at)
{
    switch (p[at]) {
    case 0x80: /* PROTO */
    case 'q':  /* BINPUT */
    case 'h':  /* BINGET */
    case 'K':  /* BININT1 */
        return 1;
    case 'M': /* BININT2 */
        return 2;
    case 'r': /* LONG_BINPUT */
    case 'j': /* LONG_BINGET */
    case 'J': /* BININT */
        return 4;
    case 'G': /* BINFLOAT */
        return 8;
    case 'c': { /* GLOBAL: two newline-terminated names */
        size_t i = at + 1;
        for (int newlines = 0; newlines < 2; i++) {
            if (i >= n) return -1;
            if (p[i] == '\n') newlines++;
        }
        return (long)(i - at - 1);
    }
    case 'X': { /* BINUNICODE */
        if (at + 5 > n) return -1;
        uint32_t len = (uint32_t)p[at + 1] | ((uint32_t)p[at + 2] << 8) |
                       ((uint32_t)p[at + 3] << 16) | ((uint32_t)p[at + 4] << 24);
        return 4 + (long)len;
    }
    case 0x8d: { /* BINUNICODE8 */
        if (at + 9 > n) return -1;
        uint64_t len = 0;
        for (int k = 7; k >= 0; k--)
            len = (len << 8) | p[at + 1 + k];
        return 8 + (long)len;
    }
    case 0x8a: /* LONG1 */
        return at + 1 < n ? 1 + (long)p[at + 1] : -1;
    case ')':
    case 'R':
    case 'b':
    case '(':
    case 't':
    case 0x85:
    case 0x86:
    case 0x87:
    case '}':
    case ']':
    case 'd':
    case 'l':
    case 's':
    case 'u':
    case 'a':
    case 'e':
    case 'Q':
    case 'N':
    case 0x88:
    case 0x89:
    case 0x81:
    case '.':
        return 0;
    default:
        return -1;
    }
}

/* A python state dict is an OrderedDict, which libtorch's unpickler drops to
 * None at the top level (it keeps the class only for a tensor's backward
 * hooks, and takes BUILD for a global's call). torch.save's pickle of one
 * starts, after its protocol, with `GLOBAL collections OrderedDict`, a memo
 * put, `EMPTY_TUPLE`, `REDUCE` and a memo put, then the items, then the
 * `_metadata` state BUILD sets on it. Rewritten here: the global and its memo
 * put stay (the tensors' backward hooks fetch the memo), the call becomes
 * `EMPTY_DICT` with the second memo put, the items follow, and the stream
 * ends with `TUPLE2` and `STOP` — the leftover global and the dict as one
 * pair, which the unpickler answers and the caller unwraps — the state BUILD
 * dropped. The archive is read record by record and written again with the
 * patched pickle (a pickle has no byte offsets, so its length may change);
 * any other archive passes through untouched. */
std::vector<char> normalise_state_dict_archive(const std::vector<char> &bytes)
{
    using caffe2::serialize::PyTorchStreamReader;
    using caffe2::serialize::PyTorchStreamWriter;
    PyTorchStreamReader reader(
        std::make_shared<caffe2::serialize::MemoryReadAdapter>(bytes.data(), (off_t)bytes.size()));
    if (!reader.hasRecord("data.pkl")) return bytes;
    auto [pkl_ptr, pkl_size] = reader.getRecord("data.pkl");
    const unsigned char *pkl = static_cast<const unsigned char *>(pkl_ptr.get());
    static const std::string global = "c"
                                      "collections\nOrderedDict\n";
    size_t head = 2; /* PROTO n */
    if (pkl_size < head + global.size() + 6 || pkl[0] != 0x80) return bytes;
    if (std::string(reinterpret_cast<const char *>(pkl) + head, global.size()) != global)
        return bytes;
    size_t at = head + global.size();
    auto put_len = [&](size_t i) -> size_t {
        return i < pkl_size && pkl[i] == 'q' ? 2 : i < pkl_size && pkl[i] == 'r' ? 5 : 0;
    };
    size_t put1 = put_len(at);
    if (!put1 || at + put1 + 2 > pkl_size || pkl[at + put1] != ')' || pkl[at + put1 + 1] != 'R')
        return bytes;
    size_t put2_at = at + put1 + 2, put2 = put_len(put2_at);
    if (!put2) return bytes;
    /* The items end at the first EMPTY_DICT outside any MARK (the state the
     * BUILD sets), or at STOP. */
    size_t pos = put2_at + put2, cut = 0;
    int depth = 0;
    while (pos < pkl_size) {
        unsigned char op = pkl[pos];
        long arg = pickle_arg_len(pkl, pkl_size, pos);
        if (arg < 0) return bytes;
        if (depth == 0 && (op == '}' || op == '.')) {
            cut = pos;
            break;
        }
        if (op == '(') depth++;
        if (op == 't' || op == 'u' || op == 'e' || op == 'd' || op == 'l') depth--;
        pos += 1 + (size_t)arg;
    }
    if (!cut) return bytes;
    std::vector<char> patched;
    patched.insert(patched.end(), pkl, pkl + at + put1); /* PROTO, the global, its memo put */
    patched.push_back('}');                              /* EMPTY_DICT */
    patched.insert(patched.end(), pkl + put2_at, pkl + put2_at + put2);
    patched.insert(patched.end(), pkl + put2_at + put2, pkl + cut);
    patched.push_back((char)0x86); /* TUPLE2: the global's id and the dict */
    patched.push_back('.');
    std::vector<char> out;
    PyTorchStreamWriter writer([&out](const void *data, size_t n) {
        const char *p = static_cast<const char *>(data);
        out.insert(out.end(), p, p + n);
        return n;
    });
    for (const std::string &name : reader.getAllRecords()) {
        if (name == "data.pkl") {
            writer.writeRecord(name, patched.data(), patched.size());
        } else {
            auto [ptr, size] = reader.getRecord(name);
            writer.writeRecord(name, ptr.get(), size);
        }
    }
    writer.writeEndOfFile();
    return out;
}

/* `names` as weight name → torch name. */
std::map<std::string, std::string> torch_names(EastValue *names, const char *fn)
{
    std::map<std::string, std::string> out;
    for (size_t k = 0, n = east_dict_len(names); k < n; k++)
        out[std::string(as_string(east_dict_key_at(names, k), fn))] =
            std::string(as_string(east_dict_val_at(names, k), fn));
    return out;
}

EvalResult nn_import_torch(EastValue **args, size_t, EastType **, size_t, EastType *output_type)
{
    const char *fn = "nn_import_torch";
    std::string_view bytes = blob_bytes(args[0], fn);
    torch::IValue loaded;
    try {
        loaded = torch::pickle_load(
            normalise_state_dict_archive(std::vector<char>(bytes.begin(), bytes.end())));
    } catch (const c10::Error &e) {
        std::string m = e.what_without_backtrace();
        throw Error(msg(fn, "the blob is not a torch state dict: " + m.substr(0, m.find('\n'))));
    } catch (const std::exception &e) {
        throw Error(msg(fn, std::string("the blob is not a torch state dict: ") + e.what()));
    }
    if (loaded.isTuple() && loaded.toTupleRef().elements().size() == 2 &&
        loaded.toTupleRef().elements()[1].isGenericDict())
        loaded = loaded.toTupleRef().elements()[1]; /* a normalised OrderedDict (above) */
    if (!loaded.isGenericDict())
        throw Error(msg(fn, "the blob holds a " + loaded.tagKind() + ", not a state dict"));
    std::map<std::string, std::vector<std::string> > by_torch_name;
    for (const auto &kv : torch_names(args[1], fn))
        by_torch_name[kv.second].push_back(kv.first);
    EastType *struct_type = unwrap(output_type)->data.dict.value;
    std::map<std::string, EastValue *> weights;
    std::set<std::string> present;
    for (const auto &entry : loaded.toGenericDict()) {
        if (!entry.key().isString()) throw Error(msg(fn, "the state dict has a non-string key"));
        std::string torch_name = entry.key().toStringRef();
        present.insert(torch_name);
        if (!entry.value().isTensor())
            throw Error(msg(fn, "the state dict's '" + torch_name + "' is not a tensor"));
        Tensor t = entry.value().toTensor();
        if (!t.is_floating_point())
            throw Error(msg(fn, "the state dict's '" + torch_name + "' is " +
                                    std::string(c10::toString(t.scalar_type())) +
                                    ", not a float tensor"));
        auto it = by_torch_name.find(torch_name);
        std::vector<std::string> targets =
            it != by_torch_name.end() ? it->second : std::vector<std::string>{torch_name};
        for (const std::string &weight : targets)
            weights[weight] = struct_of_tensor(t.to(torch::kCPU).contiguous(), struct_type, fn);
    }
    for (const auto &kv : by_torch_name)
        if (!present.count(kv.first))
            throw Error(msg(fn, "the state dict has no '" + kv.first + "' (named for '" +
                                    kv.second[0] + "')"));
    EastValue *d = dict(output_type, fn);
    for (const auto &kv : weights)
        dict_put(d, string(kv.first), kv.second);
    return eval_ok(d);
}

EvalResult nn_export_torch(EastValue **args, size_t, EastType **, size_t, EastType *)
{
    const char *fn = "nn_export_torch";
    std::map<std::string, std::string> mapping = torch_names(args[1], fn);
    c10::Dict<torch::IValue, torch::IValue> state(c10::StringType::get(), c10::TensorType::get());
    std::set<std::string> used;
    for (size_t k = 0, n = east_dict_len(args[0]); k < n; k++) {
        std::string weight(as_string(east_dict_key_at(args[0], k), fn));
        auto it = mapping.find(weight);
        std::string torch_name = it != mapping.end() ? it->second : weight;
        if (!used.insert(torch_name).second)
            throw Error(msg(fn, "two weights are named '" + torch_name + "' for torch"));
        state.insert(torch_name,
                     tensor_of_struct(east_dict_val_at(args[0], k), DType::Float, fn, weight));
    }
    std::vector<char> bytes = torch::pickle_save(torch::IValue(state));
    return eval_ok(blob(bytes.data(), bytes.size()));
}

/* The libtorch this library runs on, for `east-c version`. */
const char *torch_text()
{
    static const std::string text = [] {
        std::string s = "libtorch " TORCH_VERSION;
        if (!at::hasCUDA()) return s + " (CPU build)";
        int64_t n = torch::cuda::is_available() ? (int64_t)torch::cuda::device_count() : 0;
        return s + " (CUDA build, " + std::to_string(n) + " device" + (n == 1 ? "" : "s") + ")";
    }();
    return text.c_str();
}

} // namespace

} // namespace east_ds

/* The table libeast-c-datascience's stubs forward to (nn_entry.h). */
extern "C" const EastNnEntry *east_nn_entry(void)
{
    static const EastNnEntry entry = {
        EAST_NN_ENTRY_ABI,
        east_ds::platform_call_typed<east_ds::nn_init>,
        east_ds::platform_call_typed<east_ds::nn_run>,
        east_ds::platform_call_typed<east_ds::nn_train>,
        east_ds::platform_call_typed<east_ds::nn_import_torch>,
        east_ds::platform_call_typed<east_ds::nn_export_torch>,
        east_ds::torch_text,
    };
    return &entry;
}
