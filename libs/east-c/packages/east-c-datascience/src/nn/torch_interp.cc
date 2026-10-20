/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
#include "torch_interp.h"

#include "../value_util.h"

#include <ATen/CPUGeneratorImpl.h>
#include <ATen/autocast_mode.h>

#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <map>
#include <mutex>
#include <set>

namespace east_ds::nn
{

namespace F = torch::nn::functional;
using torch::Tensor;

namespace
{

const double INF = std::numeric_limits<double>::infinity();
using Bad = std::function<Error(const std::string &)>;

std::string sizes_text(const Tensor &t)
{
    Shape s(t.sizes().begin(), t.sizes().end());
    return shape_text(s);
}

int64_t axis_of(const Tensor &t, int64_t axis, const Bad &bad)
{
    int64_t r = t.dim();
    if (axis < -r || axis >= r)
        throw bad("axis " + std::to_string(axis) + " is outside a rank of " + std::to_string(r));
    return axis < 0 ? axis + r : axis;
}

void check_index(const Tensor &index, int64_t n, const Bad &bad, const std::string &what)
{
    if (index.numel() == 0) return;
    int64_t lo = index.min().item<int64_t>(), hi = index.max().item<int64_t>();
    if (lo < 0 || hi >= n)
        throw bad(what + " " + std::to_string(lo < 0 ? lo : hi) + " is outside 0 .. " +
                  std::to_string(n - 1));
}

int64_t segments_count(const Tensor &size, const Bad &bad)
{
    if (size.dim() == 0) throw bad("size must have a first dimension: the number of segments");
    return size.size(0);
}

std::vector<int64_t> row_view(const Tensor &like)
{
    std::vector<int64_t> v(like.dim(), 1);
    if (!v.empty()) v[0] = -1;
    return v;
}

template <typename Fn> Tensor broadcasting(Fn fn, const Tensor &a, const Tensor &b, const Bad &bad)
{
    try {
        return fn(a, b);
    } catch (const c10::Error &) {
        throw bad("cannot broadcast " + sizes_text(a) + " with " + sizes_text(b));
    }
}

std::vector<int64_t> sizes_of(const Tensor &t)
{
    return std::vector<int64_t>(t.sizes().begin(), t.sizes().end());
}

/* How many (query, key) pairs a key_sets attention gathers at once (spec §4,
 * Attention): bounds the working memory of a pairwise pass to a few tens of
 * MB. The python interpreter's KEY_SET_CHUNK. */
const int64_t KEY_SET_CHUNK = 16384;

/* Attention within the groups of equal ids (in any order, across any leading
 * dimensions), each bucket of groups padded to the next power of two and run
 * through the fused kernel: what the dense mask answers, in memory
 * proportional to the allowed pairs (spec §4, Attention). The twin of the
 * python interpreter's _attention_segments. */
Tensor attention_segments(const Tensor &q, const Tensor &k, const Tensor &v, int64_t heads,
                          int64_t dh, const Tensor &ids, bool causal, double scale)
{
    int64_t t = q.size(-2), d = q.size(-1);
    Tensor qf = q.reshape({-1, d}), kf = k.reshape({-1, d}), vf = v.reshape({-1, d});
    int64_t n = qf.size(0);
    if (n == 0) return torch::zeros_like(q);
    auto i64 = torch::dtype(torch::kInt64).device(q.device());
    auto bool_opts = torch::dtype(torch::kBool).device(q.device());
    Tensor arange = torch::arange(n, i64);
    // one group per (leading index, id): the ids shifted to be non-negative
    // so a group key orders by the leading index first
    Tensor flat_ids = ids.reshape({-1});
    Tensor shifted = flat_ids - flat_ids.min();
    Tensor key = torch::floor_divide(arange, t) * (shifted.max().item<int64_t>() + 1) + shifted;
    Tensor group = std::get<1>(torch::_unique2(key, true, true, false));
    Tensor counts = torch::bincount(group);
    Tensor order = torch::argsort(group, /*stable=*/true, 0, false); // by group, in token order
    Tensor starts = torch::cumsum(counts, 0) - counts;
    Tensor group_in_order = group.index({order});
    Tensor pos = arange - starts.index({group_in_order});
    // each group's bucket: its length rounded up to a power of two
    std::map<int64_t, std::vector<int64_t> > buckets;
    Tensor counts_cpu = counts.to(torch::kCPU);
    std::set<int64_t> lengths(counts_cpu.data_ptr<int64_t>(),
                              counts_cpu.data_ptr<int64_t>() + counts_cpu.numel());
    for (int64_t length : lengths) {
        int64_t width = 1;
        while (width < length)
            width *= 2;
        buckets[width].push_back(length);
    }
    Tensor local_of_group = torch::full({counts.size(0)}, -1, i64);
    std::vector<Tensor> indices, rows;
    for (const auto &bucket : buckets) {
        int64_t width = bucket.first;
        Tensor in_bucket = torch::zeros_like(counts, torch::kBool);
        for (int64_t length : bucket.second)
            in_bucket |= counts.eq(length);
        Tensor groups = torch::nonzero(in_bucket).reshape({-1});
        int64_t gb = groups.size(0);
        local_of_group.fill_(-1);
        local_of_group.index_put_({groups}, torch::arange(gb, i64));
        Tensor local = local_of_group.index({group_in_order});
        Tensor sel = local >= 0;
        Tensor padded = torch::full({gb, width}, -1, i64);
        padded.index_put_({local.index({sel}), pos.index({sel})}, order.index({sel}));
        Tensor valid = padded >= 0;
        Tensor safe = padded.clamp_min(0);
        Tensor qp = qf.index({safe}).reshape({gb, width, heads, dh}).transpose(1, 2);
        Tensor kp = kf.index({safe}).reshape({gb, width, heads, dh}).transpose(1, 2);
        Tensor vp = vf.index({safe}).reshape({gb, width, heads, dh}).transpose(1, 2);
        Tensor attend = valid.unsqueeze(1).unsqueeze(2);
        if (causal)
            attend =
                attend & torch::ones({width, width}, bool_opts).tril().unsqueeze(0).unsqueeze(0);
        // a padded query attends everywhere (finite, then dropped) so no row is empty
        attend = attend | torch::logical_not(valid).unsqueeze(1).unsqueeze(3);
        Tensor out = at::scaled_dot_product_attention(qp, kp, vp, attend, 0.0, false, scale);
        rows.push_back(out.transpose(1, 2).reshape({gb, width, d}).index({valid}));
        indices.push_back(padded.index({valid}));
    }
    Tensor back = torch::argsort(torch::cat(indices));
    return torch::cat(rows).index({back}).reshape(q.sizes());
}

/* Attention over the listed (query, key) pairs: each pair scored by a gathered
 * dot product in chunks, the softmax by segment operations over the query, the
 * values summed by index — what the dense mask answers, in memory proportional
 * to the pairs (spec §4, Attention). The twin of _attention_key_sets. */
Tensor attention_key_sets(const Tensor &q, const Tensor &k, const Tensor &v, int64_t heads,
                          int64_t dh, const Tensor &ptr, const Tensor &keys, double scale)
{
    int64_t tq = q.size(0), d = q.size(1), tk = k.size(0), total = keys.size(0);
    Tensor out = torch::zeros({tq, heads, dh}, q.options());
    if (total == 0) return out.reshape({tq, d});
    auto i64 = torch::dtype(torch::kInt64).device(q.device());
    Tensor qi = torch::repeat_interleave(torch::arange(tq, i64),
                                         ptr.narrow(0, 1, tq) - ptr.narrow(0, 0, tq));
    Tensor qh = q.reshape({tq, heads, dh}), kh = k.reshape({tk, heads, dh}),
           vh = v.reshape({tk, heads, dh});
    Tensor scores = torch::empty({total, heads}, q.options());
    for (int64_t c = 0; c < total; c += KEY_SET_CHUNK) {
        int64_t len = std::min(KEY_SET_CHUNK, total - c);
        scores.narrow(0, c, len).copy_(
            (qh.index({qi.narrow(0, c, len)}) * kh.index({keys.narrow(0, c, len)})).sum(-1) *
            scale);
    }
    Tensor seg_max = torch::zeros({tq, heads}, q.options())
                         .scatter_reduce(0, qi.unsqueeze(-1).expand({-1, heads}), scores.detach(),
                                         "amax", /*include_self=*/false);
    Tensor probs;
    if (torch::GradMode::is_enabled()) {
        Tensor e = torch::exp(scores - seg_max.index({qi}));
        Tensor seg_sum = torch::zeros({tq, heads}, q.options()).index_add(0, qi, e);
        probs = e / seg_sum.index({qi});
    } else {
        // inference: the softmax in place, so two [pairs, heads] tensors live at most
        scores.sub_(seg_max.index({qi})).exp_();
        Tensor seg_sum = torch::zeros({tq, heads}, q.options()).index_add(0, qi, scores);
        probs = scores.div_(seg_sum.index({qi}));
    }
    for (int64_t c = 0; c < total; c += KEY_SET_CHUNK) {
        int64_t len = std::min(KEY_SET_CHUNK, total - c);
        Tensor weighted =
            probs.narrow(0, c, len).unsqueeze(-1) * vh.index({keys.narrow(0, c, len)});
        out = out.index_add(0, qi.narrow(0, c, len), weighted);
    }
    return out.reshape({tq, d});
}

} // namespace

DType dtype_of_tensor(const Tensor &t)
{
    if (t.scalar_type() == torch::kFloat64) return DType::Float64;
    if (t.is_floating_point()) return DType::Float;
    if (t.scalar_type() == torch::kBool) return DType::Boolean;
    return DType::Integer;
}

torch::ScalarType scalar_type_of(DType d)
{
    switch (d) {
    case DType::Float:
        return torch::kFloat32;
    case DType::Float64:
        return torch::kFloat64;
    case DType::Integer:
        return torch::kInt64;
    case DType::Boolean:
        return torch::kBool;
    }
    return torch::kFloat32;
}

Interpreter::Interpreter(std::string fn, torch::Device device, bool training, uint64_t seed,
                         std::set<std::string> recompute)
    : fn_(std::move(fn)), device_(device), training_(training),
      generator_(at::detail::createCPUGenerator(seed)), recompute_(std::move(recompute))
{
}

Tensor Interpreter::random(const std::vector<int64_t> &shape, bool normal)
{
    auto options = torch::dtype(torch::kFloat32);
    Tensor t =
        normal ? torch::randn(shape, generator_, options) : torch::rand(shape, generator_, options);
    return t.to(device_);
}

// ============================================================================
// Entry
// ============================================================================

Tensors Interpreter::run(const Plan &plan, const Tensors &weights, const Tensors &inputs,
                         const std::vector<std::string> &operands)
{
    weights_ = &weights;
    for (const auto &kv : plan.inputs) {
        auto it = inputs.find(kv.first);
        if (it == inputs.end()) throw Error(fn_ + ": the batch has no input '" + kv.first + "'");
        const Tensor &t = it->second;
        if (dtype_of_tensor(t) != kv.second.dtype)
            throw Error(fn_ + ": input '" + kv.first + "' is " + dtype_name(dtype_of_tensor(t)) +
                        " but the network declares " + dtype_name(kv.second.dtype));
        if (t.dim() != kv.second.rank)
            throw Error(fn_ + ": input '" + kv.first + "' has rank " + std::to_string(t.dim()) +
                        " but the network declares rank " + std::to_string(kv.second.rank));
    }
    return eval(plan, inputs, "", operands);
}

Tensors Interpreter::eval(const Plan &plan, const Tensors &bound, const std::string &prefix,
                          const std::vector<std::string> &operands)
{
    Env env;
    for (const auto &kv : bound)
        env[kv.first] = Value{false, kv.second, {}};
    for (const auto &kv : plan.params) {
        std::string full = prefix + kv.first;
        auto it = weights_->find(full);
        if (it == weights_->end())
            throw Error(fn_ + ": the weights have no parameter '" + full + "'");
        env[kv.first] = Value{false, it->second, {}};
    }
    std::map<std::string, std::set<std::string> > wanted;
    for (const Node *n : needed_nodes(plan, operands, &wanted))
        env[n->name] = node(plan, *n, env, prefix, wanted[n->name]);
    Tensors out;
    for (const std::string &operand : operands)
        out[operand] = get(env, operand);
    return out;
}

Tensor Interpreter::get(const Env &env, const std::string &operand)
{
    auto [head, sub] = split_operand(operand);
    const Value &v = env.at(head);
    if (v.many) {
        if (sub.empty()) {
            if (v.several.size() == 1) return v.several.begin()->second;
            throw Error(fn_ + ": '" + head + "' holds several tensors: name one as '" + head +
                        ".<name>'");
        }
        return v.several.at(sub);
    }
    return v.one;
}

// ============================================================================
// Nodes
// ============================================================================

Interpreter::Value Interpreter::node(const Plan &plan, const Node &nd, Env &env,
                                     const std::string &prefix, const std::set<std::string> &wanted)
{
    const std::string &op = nd.op;
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': " + op + ": " + what);
    };
    auto g = [&](const char *f) { return get(env, nd.s(f)); };
    auto opt = [&](const char *f) { return nd.has(f) ? get(env, nd.s(f)) : Tensor(); };
    auto one = [](Tensor t) {
        Value v;
        v.one = std::move(t);
        return v;
    };

    if (op == "call") return call(plan, nd, env, prefix, wanted);
    if (op == "loop") return loop(nd, env, prefix);

    // ---- indexing and layout
    if (op == "gather") {
        Tensor table = g("table"), index = g("index");
        if (table.dim() == 0) throw bad("table must have a first dimension");
        check_index(index, table.size(0), bad, "index");
        return one(table.index({index}));
    }
    if (op == "take_along") {
        Tensor x = g("x"), index = g("index");
        if (x.dim() == 0) throw bad("x must have an axis");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        if (index.dim() != x.dim())
            throw bad("index has rank " + std::to_string(index.dim()) + " but x has rank " +
                      std::to_string(x.dim()));
        for (int64_t k = 0; k < x.dim(); k++)
            if (k != axis && index.size(k) != x.size(k))
                throw bad("index is shaped " + sizes_text(index) + " but x is " + sizes_text(x) +
                          ": they differ off the axis");
        check_index(index, x.size(axis), bad, "index");
        return one(torch::gather(x, axis, index));
    }
    if (op == "mask_select") {
        Tensor x = g("x"), mask = g("mask");
        if (x.dim() < 1 || mask.dim() != 1 || mask.size(0) != x.size(0))
            throw bad("mask is a boolean vector with one entry per row of x");
        return one(x.index({mask}));
    }
    if (op == "mask_indices") {
        Tensor mask = g("mask");
        if (mask.dim() != 1) throw bad("mask is a boolean vector");
        return one(torch::nonzero(mask).reshape({-1}));
    }
    if (op == "repeat") {
        Tensor x = g("x"), counts = g("counts");
        if (x.dim() < 1 || counts.dim() != 1 || counts.size(0) != x.size(0))
            throw bad("counts is an integer vector with one entry per row of x");
        if (counts.numel() > 0 && (counts < 0).any().item<bool>())
            throw bad("counts must not be negative");
        return one(torch::repeat_interleave(x, counts, 0));
    }
    if (op == "range") {
        Tensor stop = g("stop");
        if (stop.dim() != 0) throw bad("stop must be an integer of rank 0");
        return one(torch::arange(nd.iv("start"), stop.item<int64_t>(), nd.iv("step"),
                                 torch::dtype(torch::kInt64).device(device_)));
    }
    if (op == "searchsorted") {
        Tensor sorted = g("sorted"), values = g("values");
        if (sorted.dim() != 1) throw bad("sorted is a vector");
        return one(torch::searchsorted(sorted, values, /*out_int32=*/false, nd.bv("right")));
    }
    if (op == "embedding_bag") {
        Tensor table = g("table"), index = g("index"), segments = g("segments"), size = g("size"),
               weights = opt("weights");
        if (table.dim() < 1 || index.dim() != 1 || segments.dim() != 1)
            throw bad("table has a first dimension, index and segments are vectors");
        if (index.size(0) != segments.size(0))
            throw bad("index has " + std::to_string(index.size(0)) + " entries but segments has " +
                      std::to_string(segments.size(0)));
        if (weights.defined() && (weights.dim() != 1 || weights.size(0) != index.size(0)))
            throw bad("weights must have " + std::to_string(index.size(0)) + " entries");
        int64_t n_seg = segments_count(size, bad);
        check_index(index, table.size(0), bad, "index");
        check_index(segments, n_seg, bad, "segments");
        Tensor rows = table.index({index});
        if (weights.defined()) rows = rows * weights.reshape(row_view(rows));
        std::vector<int64_t> shape = sizes_of(table);
        shape[0] = n_seg;
        return one(torch::zeros(shape, table.options()).index_add(0, segments, rows));
    }
    if (op == "segment_reduce") {
        Tensor x = g("x"), segments = g("segments"), size = g("size");
        const std::string &reduce = nd.s("reduce");
        if (x.dim() < 1 || segments.dim() != 1 || segments.size(0) != x.size(0))
            throw bad("segments is a vector with one id per row of x");
        int64_t n_seg = segments_count(size, bad);
        check_index(segments, n_seg, bad, "segments");
        std::vector<int64_t> shape = sizes_of(x);
        shape[0] = n_seg;
        Tensor out = torch::zeros(shape, x.options());
        if (reduce == "sum") return one(out.index_add(0, segments, x));
        if (reduce == "mean") {
            Tensor total = out.index_add(0, segments, x);
            Tensor counts = torch::bincount(segments, {}, n_seg).to(x.scalar_type()).clamp_min(1);
            return one(total / counts.reshape(row_view(x)));
        }
        Tensor idx = segments.reshape(row_view(x)).expand_as(x);
        return one(out.scatter_reduce(0, idx, x, reduce == "max" ? "amax" : "amin",
                                      /*include_self=*/false));
    }
    if (op == "segment_softmax" || op == "segment_log_softmax") {
        Tensor x = g("x"), segments = g("segments");
        if (x.dim() < 1 || segments.dim() != 1 || segments.size(0) != x.size(0))
            throw bad("segments is a vector with one id per row of x");
        if (x.size(0) == 0) return one(x);
        if ((segments < 0).any().item<bool>()) throw bad("a segment id is negative");
        int64_t n_seg = segments.max().item<int64_t>() + 1;
        std::vector<int64_t> shape = sizes_of(x);
        shape[0] = n_seg;
        Tensor idx = segments.reshape(row_view(x)).expand_as(x);
        Tensor seg_max =
            torch::zeros(shape, x.options()).scatter_reduce(0, idx, x.detach(), "amax", false);
        Tensor shifted = x - seg_max.index({segments});
        Tensor e = torch::exp(shifted);
        Tensor seg_sum = torch::zeros(shape, x.options()).index_add(0, segments, e);
        if (op == "segment_softmax") return one(e / seg_sum.index({segments}));
        return one(shifted - torch::log(seg_sum.index({segments})));
    }
    if (op == "scatter_add") {
        Tensor x = g("x"), index = g("index"), size = g("size");
        if (x.dim() < 1 || index.dim() != 1 || index.size(0) != x.size(0))
            throw bad("index is a vector with one entry per row of x");
        int64_t n_seg = segments_count(size, bad);
        check_index(index, n_seg, bad, "index");
        std::vector<int64_t> shape = sizes_of(x);
        shape[0] = n_seg;
        return one(torch::zeros(shape, x.options()).index_add(0, index, x));
    }
    if (op == "concat") {
        std::vector<Tensor> xs;
        for (const std::string &name : nd.list)
            xs.push_back(get(env, name));
        for (const Tensor &x : xs)
            if (x.dim() != xs[0].dim()) throw bad("inputs must have one rank");
        int64_t axis = axis_of(xs[0], nd.iv("axis"), bad);
        for (const Tensor &x : xs)
            for (int64_t k = 0; k < x.dim(); k++)
                if (k != axis && x.size(k) != xs[0].size(k))
                    throw bad("inputs must agree in every dimension but the axis");
        return one(torch::cat(xs, axis));
    }
    if (op == "split") {
        Tensor x = g("x");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        int64_t total = 0;
        for (int64_t s : nd.ints)
            total += s;
        if (total != x.size(axis))
            throw bad("sizes sum to " + std::to_string(total) + " but the axis has " +
                      std::to_string(x.size(axis)));
        return one(torch::split_with_sizes(x, nd.ints, axis)[nd.iv("part")]);
    }
    if (op == "slice") {
        Tensor x = g("x");
        int64_t axis = axis_of(x, nd.iv("axis"), bad), n = x.size(axis);
        int64_t start = nd.iv("start"), stop = nd.ival.count("stop") ? nd.iv("stop") : n;
        if (start < 0) start += n;
        if (stop < 0) stop += n;
        start = std::clamp<int64_t>(start, 0, n);
        stop = std::clamp<int64_t>(stop, start, n);
        return one(x.narrow(axis, start, stop - start));
    }
    if (op == "pad") {
        Tensor x = g("x");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        int64_t before = nd.iv("before"), after = nd.iv("after"), n = x.size(axis);
        if (nd.s("mode") == "zeros") {
            std::vector<int64_t> pads;
            for (int64_t k = 0; k < x.dim() - 1 - axis; k++)
                pads.insert(pads.end(), {0, 0});
            pads.insert(pads.end(), {before, after});
            if (x.scalar_type() == torch::kBool)
                return one(F::pad(x.to(torch::kUInt8), F::PadFuncOptions(pads)).to(torch::kBool));
            return one(F::pad(x, F::PadFuncOptions(pads)));
        }
        if (n == 0) throw bad("an empty axis cannot be replicated");
        Tensor idx =
            torch::arange(-before, n + after, torch::dtype(torch::kInt64).device(x.device()))
                .clamp(0, n - 1);
        return one(x.index_select(axis, idx));
    }
    if (op == "reshape") {
        Tensor x = g("x");
        try {
            return one(x.reshape(nd.ints));
        } catch (const c10::Error &) {
            throw bad("cannot reshape " + sizes_text(x) + " to " + shape_text(nd.ints));
        }
    }
    if (op == "permute") {
        Tensor x = g("x");
        if ((int64_t)nd.ints.size() != x.dim())
            throw bad("axes has " + std::to_string(nd.ints.size()) + " entries but the rank is " +
                      std::to_string(x.dim()));
        return one(x.permute(nd.ints));
    }
    if (op == "broadcast") {
        Tensor x = g("x"), like = g("like");
        try {
            return one(torch::broadcast_to(x, like.sizes()));
        } catch (const c10::Error &) {
            throw bad("cannot broadcast " + sizes_text(x) + " to " + sizes_text(like));
        }
    }
    if (op == "where") {
        Tensor c = g("cond"), a = g("a"), b = g("b");
        try {
            return one(torch::where(c, a, b));
        } catch (const c10::Error &) {
            throw bad("cannot broadcast " + sizes_text(c) + ", " + sizes_text(a) + " and " +
                      sizes_text(b));
        }
    }
    if (op == "constant") {
        const std::string &tag = nd.s("value");
        if (tag == "float")
            return one(torch::scalar_tensor(nd.fv("value"),
                                            torch::dtype(torch::kFloat32).device(device_)));
        if (tag == "float64")
            return one(torch::scalar_tensor(nd.fv("value"),
                                            torch::dtype(torch::kFloat64).device(device_)));
        if (tag == "integer")
            return one(
                torch::scalar_tensor(nd.iv("value"), torch::dtype(torch::kInt64).device(device_)));
        return one(
            torch::scalar_tensor(nd.bv("value"), torch::dtype(torch::kBool).device(device_)));
    }
    if (op == "cast") {
        Tensor x = g("x");
        DType target = dtype_of_name(nd.s("dtype"));
        if (target == DType::Boolean) return one(x.ne(0));
        if (target == DType::Integer && x.is_floating_point()) {
            if (!torch::isfinite(x).all().item<bool>())
                throw bad("cannot cast a non-finite float to integer");
            return one(x.trunc().to(torch::kInt64));
        }
        return one(x.to(scalar_type_of(target)));
    }

    // ---- dense
    if (op == "linear") {
        Tensor x = g("x"), w = g("weight"), b = opt("bias");
        if (x.dim() < 1 || w.dim() != 2)
            throw bad("x has a last dimension and weight is a matrix [out, in]");
        if (x.size(-1) != w.size(1))
            throw bad("x has " + std::to_string(x.size(-1)) + " columns but weight has " +
                      std::to_string(w.size(1)));
        if (b.defined() && (b.dim() != 1 || b.size(0) != w.size(0)))
            throw bad("bias must have " + std::to_string(w.size(0)) + " entries");
        return one(F::linear(x, w, b));
    }
    if (op == "einsum") {
        std::vector<Tensor> xs;
        for (const std::string &name : nd.list)
            xs.push_back(get(env, name));
        try {
            return one(torch::einsum(nd.s("subscripts"), xs));
        } catch (const c10::Error &e) {
            std::string m = e.what_without_backtrace();
            throw bad(m.substr(0, m.find('\n')));
        }
    }
    if (op == "conv1d") {
        Tensor x = g("x"), w = g("weight"), b = opt("bias");
        if (x.dim() != 3 || w.dim() != 3)
            throw bad("x is [N, C_in, L] and weight is [C_out, C_in/groups, K]");
        int64_t groups = nd.iv("groups"), stride = nd.iv("stride"), dilation = nd.iv("dilation");
        if (x.size(1) != w.size(1) * groups || w.size(0) % groups != 0)
            throw bad("x has " + std::to_string(x.size(1)) + " channels but weight takes " +
                      std::to_string(w.size(1)) + " × " + std::to_string(groups) + " groups");
        if (x.size(2) - dilation * (w.size(2) - 1) - 1 < 0)
            throw bad("the kernel does not fit a length of " + std::to_string(x.size(2)));
        return one(F::conv1d(
            x, w, F::Conv1dFuncOptions().bias(b).stride(stride).dilation(dilation).groups(groups)));
    }
    if (op == "avg_pool1d") {
        Tensor x = g("x");
        if (x.dim() != 3) throw bad("x is [N, C, L]");
        if (x.size(2) < nd.iv("kernel"))
            throw bad("the kernel does not fit a length of " + std::to_string(x.size(2)));
        return one(
            F::avg_pool1d(x, F::AvgPool1dFuncOptions(nd.iv("kernel")).stride(nd.iv("stride"))));
    }
    if (op == "upsample_nearest") {
        Tensor x = g("x");
        if (x.dim() < 1) throw bad("x has a last dimension");
        return one(x.repeat_interleave(nd.iv("scale"), -1));
    }
    if (op == "layer_norm") {
        Tensor x = g("x"), w = opt("weight"), b = opt("bias");
        if (x.dim() < 1) throw bad("x has a last dimension");
        int64_t d = x.size(-1);
        if (w.defined() && (w.dim() != 1 || w.size(0) != d))
            throw bad("weight must have " + std::to_string(d) + " entries");
        if (b.defined() && (b.dim() != 1 || b.size(0) != d))
            throw bad("bias must have " + std::to_string(d) + " entries");
        return one(
            F::layer_norm(x, F::LayerNormFuncOptions({d}).weight(w).bias(b).eps(nd.fv("eps"))));
    }
    if (op == "group_norm") {
        Tensor x = g("x"), w = opt("weight"), b = opt("bias");
        if (x.dim() < 2) throw bad("x is [N, C, ...]");
        int64_t groups = nd.iv("groups"), C = x.size(1);
        if (C % groups != 0)
            throw bad(std::to_string(C) + " channels are not a multiple of " +
                      std::to_string(groups) + " groups");
        if (w.defined() && (w.dim() != 1 || w.size(0) != C))
            throw bad("weight must have " + std::to_string(C) + " entries");
        if (b.defined() && (b.dim() != 1 || b.size(0) != C))
            throw bad("bias must have " + std::to_string(C) + " entries");
        return one(
            F::group_norm(x, F::GroupNormFuncOptions(groups).weight(w).bias(b).eps(nd.fv("eps"))));
    }

    // ---- element-wise
    if (op == "add" || op == "sub" || op == "mul" || op == "div" || op == "pow" || op == "eq" ||
        op == "ne" || op == "lt" || op == "le" || op == "gt" || op == "ge" || op == "logical_and" ||
        op == "logical_or") {
        Tensor a = g("a"), b = g("b");
        auto f = [&](const Tensor &x, const Tensor &y) -> Tensor {
            if (op == "add") return torch::add(x, y);
            if (op == "sub") return torch::sub(x, y);
            if (op == "mul") return torch::mul(x, y);
            if (op == "div") return torch::div(x, y);
            if (op == "pow") return torch::pow(x, y);
            if (op == "eq") return torch::eq(x, y);
            if (op == "ne") return torch::ne(x, y);
            if (op == "lt") return torch::lt(x, y);
            if (op == "le") return torch::le(x, y);
            if (op == "gt") return torch::gt(x, y);
            if (op == "ge") return torch::ge(x, y);
            if (op == "logical_and") return torch::logical_and(x, y);
            return torch::logical_or(x, y);
        };
        return one(broadcasting(f, a, b, bad));
    }
    if (op == "remainder") {
        Tensor a = g("a"), b = g("b");
        if (!a.is_floating_point() && b.numel() > 0 && b.eq(0).any().item<bool>())
            throw bad("integer division by zero");
        auto f = [](const Tensor &x, const Tensor &y) -> Tensor { return torch::remainder(x, y); };
        return one(broadcasting(f, a, b, bad));
    }
    {
        Tensor x = nd.has("x") ? get(env, nd.s("x")) : Tensor();
        if (op == "neg") return one(-x);
        if (op == "abs") return one(x.abs());
        if (op == "floor") return one(torch::floor(x));
        if (op == "ceil") return one(torch::ceil(x));
        if (op == "round") return one(torch::round(x));
        if (op == "exp") return one(torch::exp(x));
        if (op == "log") return one(torch::log(x));
        if (op == "log1p") return one(torch::log1p(x));
        if (op == "sqrt") return one(torch::sqrt(x));
        if (op == "softplus") return one(F::softplus(x));
        if (op == "sigmoid") return one(torch::sigmoid(x));
        if (op == "tanh") return one(torch::tanh(x));
        if (op == "relu") return one(F::relu(x));
        if (op == "gelu")
            return one(F::gelu(x, F::GELUFuncOptions().approximate(
                                      nd.s("approximate") == "tanh" ? "tanh" : "none")));
        if (op == "silu") return one(F::silu(x));
        if (op == "clamp") {
            std::optional<c10::Scalar> lo, hi;
            if (nd.fval.count("min")) lo = nd.fv("min");
            if (nd.fval.count("max")) hi = nd.fv("max");
            return one(torch::clamp(x, lo, hi));
        }
        if (op == "sin") return one(torch::sin(x));
        if (op == "cos") return one(torch::cos(x));
        if (op == "nan_to_num")
            return one(torch::nan_to_num(x, nd.fv("nan"), nd.fv("posinf"), nd.fv("neginf")));
        if (op == "is_nan") return one(torch::isnan(x));
        if (op == "normal_cdf") return one(torch::special_ndtr(x));
        if (op == "log_normal_cdf") return one(torch::special_log_ndtr(x));
        if (op == "normal_quantile") return one(torch::special_ndtri(x));
        if (op == "log1mexp")
            return one(torch::where(x > -std::log(2.0), torch::log(-torch::expm1(x)),
                                    torch::log1p(-torch::exp(x))));
        if (op == "logical_not") return one(torch::logical_not(x));
        if (op == "dropout") {
            if (!training_) return one(x);
            double p = nd.fv("p");
            Tensor keep = random(sizes_of(x), false) >= p;
            return one(x * keep.to(x.scalar_type()) / (1.0 - p));
        }
        if (op == "stop_gradient") return one(x.detach());
    }
    if (op == "random_normal" || op == "random_uniform")
        return one(random(sizes_of(g("like")), op == "random_normal"));

    // ---- along an axis
    if (op == "sum" || op == "mean" || op == "max" || op == "min" || op == "logsumexp" ||
        op == "softmax" || op == "log_softmax" || op == "cumsum" || op == "cummax" ||
        op == "cummin" || op == "argmax") {
        Tensor x = g("x");
        if (x.dim() == 0) throw bad("x must have an axis");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        if ((op == "max" || op == "min" || op == "argmax") && x.size(axis) == 0)
            throw bad("the axis is empty");
        if (op == "sum") return one(x.sum(axis));
        if (op == "mean") return one(x.size(axis) > 0 ? x.mean(axis) : x.sum(axis));
        if (op == "max") return one(x.amax(axis));
        if (op == "min") return one(x.amin(axis));
        if (op == "logsumexp") return one(torch::logsumexp(x, axis));
        if (op == "softmax") return one(torch::softmax(x, axis));
        if (op == "log_softmax") return one(torch::log_softmax(x, axis));
        if (op == "cumsum") return one(x.cumsum(axis));
        if (op == "cummax") return one(std::get<0>(x.cummax(axis)));
        if (op == "cummin") return one(std::get<0>(x.cummin(axis)));
        return one(x.argmax(axis));
    }

    // ---- attention
    if (op == "attention") return one(attention(nd, env));
    if (op == "rotary") {
        Tensor x = g("x"), positions = g("positions");
        int64_t heads = nd.iv("heads");
        if (x.dim() < 2) throw bad("x is [..., T, d]");
        int64_t d = x.size(-1);
        if (d % heads != 0)
            throw bad("d = " + std::to_string(d) +
                      " is not a multiple of heads = " + std::to_string(heads));
        int64_t dh = d / heads;
        if (dh % 2 != 0) throw bad("the head dimension " + std::to_string(dh) + " is odd");
        std::vector<int64_t> lead = sizes_of(x);
        lead.pop_back();
        if (sizes_of(positions) != lead) throw bad("positions must be shaped " + shape_text(lead));
        int64_t half = dh / 2;
        Tensor exponent = torch::arange(half, x.options()) * (-2.0 / (double)dh);
        Tensor inv = torch::pow(nd.fv("base"), exponent);
        Tensor angle = positions.to(x.scalar_type()).unsqueeze(-1) * inv;
        Tensor cos = angle.cos().unsqueeze(-2), sin = angle.sin().unsqueeze(-2);
        std::vector<int64_t> hshape = lead;
        hshape.insert(hshape.end(), {heads, dh});
        Tensor xh = x.reshape(hshape);
        if (nd.s("convention") == "interleaved") {
            std::vector<int64_t> pshape = lead;
            pshape.insert(pshape.end(), {heads, half, 2});
            Tensor pairs = xh.reshape(pshape);
            Tensor x1 = pairs.select(-1, 0), x2 = pairs.select(-1, 1);
            Tensor out = torch::stack({x1 * cos - x2 * sin, x2 * cos + x1 * sin}, -1);
            return one(out.reshape(x.sizes()));
        }
        Tensor x1 = xh.narrow(-1, 0, half), x2 = xh.narrow(-1, half, half);
        Tensor out = torch::cat({x1 * cos - x2 * sin, x2 * cos + x1 * sin}, -1);
        return one(out.reshape(x.sizes()));
    }
    throw bad("unknown operation");
}

Tensor Interpreter::attention(const Node &nd, Env &env)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': attention: " + what);
    };
    Tensor q = get(env, nd.s("q")), k = get(env, nd.s("k")), v = get(env, nd.s("v"));
    Tensor bias = nd.has("bias") ? get(env, nd.s("bias")) : Tensor();
    int64_t heads = nd.iv("heads");
    if (q.dim() < 2 || k.dim() != q.dim() || v.dim() != q.dim())
        throw bad("q, k and v have one rank of at least 2");
    int64_t d = q.size(-1);
    if (d % heads != 0)
        throw bad("d = " + std::to_string(d) +
                  " is not a multiple of heads = " + std::to_string(heads));
    if (k.size(-1) != d || v.size(-1) != d) throw bad("q, k and v share their last dimension");
    if (k.size(-2) != v.size(-2)) throw bad("k and v have the same number of keys");
    std::vector<int64_t> lead = sizes_of(q), klead = sizes_of(k), vlead = sizes_of(v);
    lead.resize(lead.size() - 2);
    klead.resize(klead.size() - 2);
    vlead.resize(vlead.size() - 2);
    if (lead != klead || lead != vlead) throw bad("q, k and v share their leading dimensions");
    int64_t dh = d / heads, tq = q.size(-2), tk = k.size(-2);
    double scale = nd.fval.count("scale") ? nd.fv("scale") : 1.0 / std::sqrt((double)dh);
    const std::string &mask = nd.s("mask");
    auto bool_opts = torch::dtype(torch::kBool).device(q.device());
    auto i64 = torch::dtype(torch::kInt64).device(q.device());

    // The mask's operands, checked as the specification states them.
    Tensor ids, ptr, keys;
    if (mask == "segments") {
        ids = get(env, nd.s("ids"));
        std::vector<int64_t> want = lead;
        want.push_back(tq);
        if (sizes_of(ids) != want || tq != tk)
            throw bad("the mask's ids must be shaped " + shape_text(want) + " with Tq = Tk");
    } else if (mask == "key_sets") {
        ptr = get(env, nd.s("ptr"));
        keys = get(env, nd.s("keys"));
        if (!lead.empty()) throw bad("a key_sets mask takes unbatched q, k and v");
        if (ptr.dim() != 1 || ptr.size(0) != tq + 1)
            throw bad("the mask's ptr must have " + std::to_string(tq + 1) + " entries");
        if (tq > 0 && (ptr[0].item<int64_t>() != 0 ||
                       (ptr.narrow(0, 1, tq) < ptr.narrow(0, 0, tq)).any().item<bool>()))
            throw bad("the mask's ptr must start at 0 and not decrease");
        int64_t total = tq > 0 ? ptr[tq].item<int64_t>() : 0;
        if (keys.dim() != 1 || keys.size(0) != total)
            throw bad("the mask's keys must have " + std::to_string(total) +
                      " entries, ptr's last");
        check_index(keys, tk, bad, "the mask's key");
        if (total > 1) {
            Tensor qi = torch::repeat_interleave(torch::arange(tq, i64),
                                                 ptr.narrow(0, 1, tq) - ptr.narrow(0, 0, tq));
            Tensor pairs = std::get<0>(torch::sort(qi * tk + keys));
            Tensor later = pairs.narrow(0, 1, total - 1);
            Tensor twice = later.eq(pairs.narrow(0, 0, total - 1));
            if (twice.any().item<bool>()) {
                int64_t p = later.index({twice})[0].item<int64_t>();
                throw bad("the mask lists key " + std::to_string(p % tk) + " twice for query " +
                          std::to_string(p / tk));
            }
        }
    }

    // The structured masks without a bias run in memory proportional to the
    // allowed pairs (spec §4, Attention); everything else through dense scores.
    if (mask == "segments" && !bias.defined())
        return attention_segments(q, k, v, heads, dh, ids, nd.bv("causal"), scale);
    if (mask == "key_sets" && !bias.defined())
        return attention_key_sets(q, k, v, heads, dh, ptr, keys, scale);

    Tensor allowed;
    if (mask == "causal") {
        if (tq != tk) throw bad("a causal mask needs Tq = Tk");
        allowed = torch::ones({tq, tk}, bool_opts).tril();
    } else if (mask == "segments") {
        allowed = ids.unsqueeze(-1).eq(ids.unsqueeze(-2));
        if (nd.bv("causal")) allowed = allowed & torch::ones({tq, tk}, bool_opts).tril();
    } else if (mask == "key_sets") {
        allowed = torch::zeros({tq, tk}, bool_opts);
        if (keys.size(0) > 0) {
            Tensor qi = torch::repeat_interleave(torch::arange(tq, i64),
                                                 ptr.narrow(0, 1, tq) - ptr.narrow(0, 0, tq));
            allowed.index_put_({qi, keys}, true);
        }
    }

    std::vector<int64_t> qshape = lead, kshape = lead;
    qshape.insert(qshape.end(), {tq, heads, dh});
    kshape.insert(kshape.end(), {tk, heads, dh});
    Tensor qh = q.reshape(qshape).transpose(-3, -2);
    Tensor kh = k.reshape(kshape).transpose(-3, -2);
    Tensor vh = v.reshape(kshape).transpose(-3, -2);
    Tensor scores = torch::matmul(qh, kh.transpose(-1, -2)) * scale;
    if (bias.defined()) {
        try {
            scores = scores + bias;
        } catch (const c10::Error &) {
            throw bad("cannot broadcast the bias " + sizes_text(bias) + " to " +
                      sizes_text(scores));
        }
    }
    Tensor any_allowed;
    if (allowed.defined()) {
        any_allowed = allowed.any(-1);
        Tensor blocked = torch::logical_not(allowed) & any_allowed.unsqueeze(-1);
        scores = scores.masked_fill(blocked.unsqueeze(-3), -INF);
    }
    Tensor out = torch::matmul(torch::softmax(scores, -1), vh);
    if (allowed.defined())
        out = out * any_allowed.unsqueeze(-2).unsqueeze(-1).to(out.scalar_type());
    return out.transpose(-3, -2).reshape(q.sizes());
}

Interpreter::Value Interpreter::call(const Plan &plan, const Node &nd, Env &env,
                                     const std::string &prefix, const std::set<std::string> &wanted)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': call: " + what);
    };
    const Plan *module = plan.find_module(nd.s("module"));
    Tensors bound;
    for (const auto &kv : nd.dict) {
        Tensor t = get(env, kv.second);
        const InputSpec &spec = module->inputs.at(kv.first);
        if (t.dim() != spec.rank)
            throw bad("input '" + kv.first + "' has rank " + std::to_string(t.dim()) +
                      " but the module declares rank " + std::to_string(spec.rank));
        bound[kv.first] = t;
    }
    std::vector<std::string> outputs;
    if (wanted.empty() || wanted.count(""))
        for (const auto &out : module->outputs)
            outputs.push_back(out.first);
    else
        for (const std::string &sub : wanted)
            outputs.push_back(sub);
    std::vector<std::string> operands;
    for (const std::string &out : outputs) {
        const std::string *operand = module->output(out);
        if (!operand) throw bad("the module has no output '" + out + "'");
        operands.push_back(*operand);
    }
    std::string sub_prefix = prefix + nd.s("prefix") + ".";
    if (training_ && recompute_.count(nd.s("module")) && torch::GradMode::is_enabled())
        return recomputed_call(*module, nd, bound, sub_prefix, outputs, operands);
    Tensors values = eval(*module, bound, sub_prefix, operands);
    Value result;
    result.many = true;
    for (size_t k = 0; k < outputs.size(); k++)
        result.several[outputs[k]] = values.at(operands[k]);
    return result;
}

/* A module's call as one autograd node: the forward runs it without a graph
 * and keeps its inputs and weights; the backward runs it again with a graph,
 * from the same generator state, and differentiates (torch.utils.checkpoint's
 * non-reentrant form, for one call). */
struct RecomputeFn : public torch::autograd::Function<RecomputeFn> {
    struct Closure {
        Interpreter *self;
        const Plan *module;
        std::string prefix;
        std::vector<std::string> input_names, weight_names, operands;
        Tensors bound_fixed; /* the inputs that take no gradient */
        torch::Tensor rng_state;
    };
    static std::mutex mutex;
    static std::map<int64_t, std::shared_ptr<Closure> > closures;
    static int64_t next_id;

    static torch::autograd::variable_list run(Closure &c,
                                              const torch::autograd::variable_list &inputs,
                                              const torch::autograd::variable_list &weights)
    {
        Tensors bound = c.bound_fixed;
        for (size_t k = 0; k < c.input_names.size(); k++)
            bound[c.input_names[k]] = inputs[k];
        Tensors substituted = *c.self->weights_;
        for (size_t k = 0; k < c.weight_names.size(); k++)
            substituted[c.weight_names[k]] = weights[k];
        const Tensors *saved = c.self->weights_;
        c.self->weights_ = &substituted;
        torch::Tensor state = c.self->generator_.get_state();
        c.self->generator_.set_state(c.rng_state);
        Tensors values;
        try {
            values = c.self->eval(*c.module, bound, c.prefix, c.operands);
        } catch (...) {
            c.self->weights_ = saved;
            c.self->generator_.set_state(state);
            throw;
        }
        c.self->weights_ = saved;
        c.self->generator_.set_state(state);
        torch::autograd::variable_list out;
        for (const std::string &operand : c.operands)
            out.push_back(values.at(operand));
        return out;
    }

    /* The tensors come as a TensorList: the only sequence the Function
     * machinery reads its differentiable inputs from. */
    static torch::autograd::variable_list forward(torch::autograd::AutogradContext *ctx, int64_t id,
                                                  int64_t n_inputs, at::TensorList tensors)
    {
        std::shared_ptr<Closure> c;
        {
            std::lock_guard<std::mutex> lock(mutex);
            c = closures.at(id);
        }
        c->rng_state = c->self->generator_.get_state();
        torch::autograd::variable_list inputs(tensors.begin(), tensors.begin() + n_inputs),
            weights(tensors.begin() + n_inputs, tensors.end());
        torch::autograd::variable_list out;
        {
            torch::NoGradGuard no_grad;
            out = run(*c, inputs, weights);
        }
        ctx->saved_data["id"] = id;
        ctx->saved_data["n_inputs"] = n_inputs;
        ctx->save_for_backward(torch::autograd::variable_list(tensors.begin(), tensors.end()));
        return out;
    }

    static torch::autograd::variable_list backward(torch::autograd::AutogradContext *ctx,
                                                   torch::autograd::variable_list grad_outputs)
    {
        int64_t id = ctx->saved_data["id"].toInt(), n_inputs = ctx->saved_data["n_inputs"].toInt();
        std::shared_ptr<Closure> c;
        {
            std::lock_guard<std::mutex> lock(mutex);
            c = closures.at(id);
            closures.erase(id);
        }
        torch::autograd::variable_list saved = ctx->get_saved_variables();
        torch::autograd::variable_list leaves, inputs, weights;
        for (size_t k = 0; k < saved.size(); k++) {
            torch::Tensor t = saved[k].detach();
            if (saved[k].requires_grad()) t.requires_grad_(true);
            leaves.push_back(t);
            ((int64_t)k < n_inputs ? inputs : weights).push_back(t);
        }
        torch::autograd::variable_list outputs;
        {
            torch::AutoGradMode grad(true);
            outputs = run(*c, inputs, weights);
        }
        torch::autograd::variable_list wanted, grads_in;
        for (size_t k = 0; k < outputs.size(); k++)
            if (outputs[k].requires_grad() && grad_outputs[k].defined()) {
                wanted.push_back(outputs[k]);
                grads_in.push_back(grad_outputs[k]);
            }
        torch::autograd::variable_list differentiable;
        std::vector<size_t> at;
        for (size_t k = 0; k < leaves.size(); k++)
            if (leaves[k].requires_grad()) {
                differentiable.push_back(leaves[k]);
                at.push_back(k);
            }
        torch::autograd::variable_list grads(leaves.size() + 2);
        if (!wanted.empty() && !differentiable.empty()) {
            torch::autograd::variable_list g = torch::autograd::grad(
                wanted, differentiable, grads_in, /*retain_graph=*/false, /*create_graph=*/false,
                /*allow_unused=*/true);
            for (size_t k = 0; k < at.size(); k++)
                grads[2 + at[k]] = g[k];
        }
        return grads;
    }
};
std::mutex RecomputeFn::mutex;
std::map<int64_t, std::shared_ptr<RecomputeFn::Closure> > RecomputeFn::closures;
int64_t RecomputeFn::next_id = 0;

Interpreter::Value Interpreter::recomputed_call(const Plan &module, const Node &nd,
                                                const Tensors &bound, const std::string &sub_prefix,
                                                const std::vector<std::string> &outputs,
                                                const std::vector<std::string> &operands)
{
    auto c = std::make_shared<RecomputeFn::Closure>();
    c->self = this;
    c->module = &module;
    c->prefix = sub_prefix;
    c->operands = operands;
    torch::autograd::variable_list tensors;
    for (const auto &kv : bound) {
        if (kv.second.requires_grad()) {
            c->input_names.push_back(kv.first);
            tensors.push_back(kv.second);
        } else {
            c->bound_fixed[kv.first] = kv.second;
        }
    }
    int64_t n_inputs = (int64_t)tensors.size();
    std::map<std::string, ParamSpec> specs;
    collect_weights(module, fn_, sub_prefix, specs);
    for (const auto &kv : specs) {
        auto it = weights_->find(kv.first);
        if (it == weights_->end())
            throw Error(fn_ + ": the weights have no parameter '" + kv.first + "'");
        c->weight_names.push_back(kv.first);
        tensors.push_back(it->second);
    }
    int64_t id;
    {
        std::lock_guard<std::mutex> lock(RecomputeFn::mutex);
        id = RecomputeFn::next_id++;
        RecomputeFn::closures[id] = c;
    }
    torch::autograd::variable_list out = RecomputeFn::apply(id, n_inputs, at::TensorList(tensors));
    Value result;
    result.many = true;
    for (size_t k = 0; k < outputs.size(); k++)
        result.several[outputs[k]] = out[k];
    return result;
}

Interpreter::Value Interpreter::loop(const Node &nd, Env &env, const std::string &prefix)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': loop: " + what);
    };
    const Plan &body = *nd.body;
    Tensors carried, fixed;
    for (const auto &kv : nd.dict)
        carried[kv.first] = get(env, kv.second);
    for (const auto &kv : nd.dict2)
        fixed[kv.first] = get(env, kv.second);
    for (const auto *m : {&carried, &fixed})
        for (const auto &kv : *m)
            if (kv.second.dim() != body.inputs.at(kv.first).rank)
                throw bad("input '" + kv.first + "' has rank " + std::to_string(kv.second.dim()) +
                          " but the body declares rank " +
                          std::to_string(body.inputs.at(kv.first).rank));
    bool until = nd.s("steps") == "until";
    const std::string *stop_operand = until ? body.output(nd.s("until_output")) : nullptr;
    std::vector<std::string> operands;
    for (const auto &kv : carried)
        operands.push_back(*body.output(kv.first));
    if (stop_operand &&
        std::find(operands.begin(), operands.end(), *stop_operand) == operands.end())
        operands.push_back(*stop_operand);
    int64_t limit = until ? nd.iv("max") : nd.iv("fixed");
    for (int64_t i = 0; i < limit; i++) {
        Tensors bound = fixed;
        for (const auto &kv : carried)
            bound[kv.first] = kv.second;
        if (nd.has("step"))
            bound[nd.s("step")] =
                torch::scalar_tensor(i, torch::dtype(torch::kInt64).device(device_));
        Tensors values = eval(body, bound, prefix, operands);
        for (auto &kv : carried) {
            Tensor t = values.at(*body.output(kv.first));
            if (t.dim() != body.inputs.at(kv.first).rank)
                throw bad("the body answers '" + kv.first + "' with rank " +
                          std::to_string(t.dim()) + " but declares rank " +
                          std::to_string(body.inputs.at(kv.first).rank));
            kv.second = t;
        }
        if (stop_operand) {
            Tensor stop = values.at(*stop_operand);
            if (stop.dim() != 0)
                throw bad("the stop output '" + nd.s("until_output") + "' must have rank 0");
            if (stop.item<bool>()) break;
        }
    }
    Value result;
    result.many = true;
    result.several = carried;
    return result;
}

// ============================================================================
// Preparation, initialisation, training
// ============================================================================

Tensors prepare_weights(const Plan &plan, const Tensors &weights, torch::Device device,
                        const std::string &fn, bool trainable)
{
    std::map<std::string, ParamSpec> specs;
    collect_weights(plan, fn, "", specs);
    Tensors prepared;
    for (const auto &kv : specs) {
        auto it = weights.find(kv.first);
        if (it == weights.end())
            throw Error(fn + ": the weights have no parameter '" + kv.first + "'");
        if (sizes_of(it->second) != kv.second.shape)
            throw Error(fn + ": parameter '" + kv.first + "' has shape " + sizes_text(it->second) +
                        " but the network declares " + shape_text(kv.second.shape));
        Tensor t = it->second.to(device, torch::kFloat32);
        if (trainable && kv.second.trainable) t = t.clone().detach().requires_grad_(true);
        prepared[kv.first] = t;
    }
    return prepared;
}

Tensor init_tensor(const ParamSpec &spec, torch::Generator &generator, const std::string &fn)
{
    const Shape &shape = spec.shape;
    int64_t fan_in = 1, fan_out = 1;
    if (shape.size() >= 2) {
        int64_t receptive = 1;
        for (size_t k = 2; k < shape.size(); k++)
            receptive *= shape[k];
        fan_in = shape[1] * receptive;
        fan_out = shape[0] * receptive;
    } else if (shape.size() == 1) {
        fan_in = fan_out = shape[0];
    }
    fan_in = std::max<int64_t>(fan_in, 1);
    fan_out = std::max<int64_t>(fan_out, 1);
    auto f64 = torch::dtype(torch::kFloat64);
    const std::string &kind = spec.init;
    auto uniform = [&](double bound) {
        return (torch::rand(shape, generator, f64) * 2.0 - 1.0) * bound;
    };
    auto normal = [&](double std) { return torch::randn(shape, generator, f64) * std; };
    if (kind == "zeros") return torch::zeros(shape, f64);
    if (kind == "ones") return torch::ones(shape, f64);
    if (kind == "constant") return torch::full(shape, spec.init_arg, f64);
    if (kind == "normal") return normal(spec.init_arg);
    if (kind == "uniform") return uniform(spec.init_arg);
    if (kind == "xavier_uniform") return uniform(std::sqrt(6.0 / (double)(fan_in + fan_out)));
    if (kind == "xavier_normal") return normal(std::sqrt(2.0 / (double)(fan_in + fan_out)));
    if (kind == "kaiming_uniform") return uniform(std::sqrt(6.0 / (double)fan_in));
    if (kind == "kaiming_normal") return normal(std::sqrt(2.0 / (double)fan_in));
    throw Error(fn + ": unknown initialisation '" + kind + "'");
}

namespace
{

/* The rate at `index` of `total` units of the schedule (steps, or epochs). */
double learning_rate(const TrainConfig &c, int64_t index, int64_t total)
{
    if (c.schedule == "constant") return c.lr;
    if (index < c.warmup_steps) return c.lr * (double)(index + 1) / (double)c.warmup_steps;
    if (c.schedule == "warmup_linear") return c.lr;
    int64_t span = std::max<int64_t>(total - c.warmup_steps, 1);
    double progress = std::min((double)(index - c.warmup_steps) / (double)span, 1.0);
    return c.min_lr + (c.lr - c.min_lr) * 0.5 * (1.0 + std::cos(M_PI * progress));
}

/* The average's decay after `steps_before` steps: min(d, (1 + s)/(10 + s)) warming up. */
double ema_decay(const TrainConfig &c, int64_t steps_before)
{
    double d = *c.ema_decay;
    if (c.ema_warmup)
        return std::min(d, (1.0 + (double)steps_before) / (10.0 + (double)steps_before));
    return d;
}

struct Autocast {
    Autocast(torch::Device device, bool on) : type_(device.type()), on_(on)
    {
        if (!on_) return;
        at::autocast::set_autocast_enabled(type_, true);
        at::autocast::set_autocast_dtype(type_, at::kBFloat16);
    }
    ~Autocast()
    {
        if (!on_) return;
        at::autocast::clear_cache();
        at::autocast::set_autocast_enabled(type_, false);
    }
    c10::DeviceType type_;
    bool on_;
};

double scalar_of(const Tensor &value, const std::string &what, const std::string &fn)
{
    if (value.dim() != 0)
        throw Error(fn + ": the " + what + " output must be a scalar, got rank " +
                    std::to_string(value.dim()));
    return value.detach().to(torch::kCPU).item<double>();
}

Tensors to_device(const Tensors &batch, torch::Device device)
{
    Tensors out;
    for (const auto &kv : batch)
        out[kv.first] = kv.second.to(device);
    return out;
}

/* Σ value / Σ weight over the validation batches in evaluation mode, the draws
 * from a generator seeded afresh with the seed, each batch moved to the device
 * as its turn comes (§5). */
double validate(const Plan &plan, const Tensors &weights, const std::vector<Tensors> &batches,
                const TrainConfig &c, const std::string &fn)
{
    torch::NoGradGuard no_grad;
    Interpreter evaluator(fn, c.device, false, (uint64_t)c.seed);
    const std::string &value_operand = *plan.output(*c.validation);
    const std::string *weight_operand =
        c.validation_weight ? plan.output(*c.validation_weight) : nullptr;
    std::vector<std::string> operands = {value_operand};
    if (weight_operand && *weight_operand != value_operand) operands.push_back(*weight_operand);
    double total_value = 0.0, total_weight = 0.0;
    for (const Tensors &batch : batches) {
        Tensors inputs = to_device(batch, c.device);
        Tensors values;
        {
            Autocast autocast(c.device, c.bf16);
            values = evaluator.run(plan, weights, inputs, operands);
        }
        total_value += scalar_of(values.at(value_operand), "validation", fn);
        total_weight +=
            weight_operand ? scalar_of(values.at(*weight_operand), "validation weight", fn) : 1.0;
    }
    if (total_weight == 0.0) throw Error(fn + ": the validation weights sum to 0");
    return total_value / total_weight;
}

} // namespace

std::vector<int64_t> shuffle_order(int64_t seed, int64_t epoch, int64_t n)
{
    const uint64_t gamma = 0x9E3779B97F4A7C15ULL;
    uint64_t state = (uint64_t)seed + (uint64_t)epoch * gamma;
    std::vector<int64_t> order(n);
    for (int64_t i = 0; i < n; i++)
        order[i] = i;
    for (int64_t i = n - 1; i > 0; i--) {
        state += gamma;
        uint64_t z = state;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        z ^= z >> 31;
        int64_t j = (int64_t)(z % (uint64_t)(i + 1));
        std::swap(order[i], order[j]);
    }
    return order;
}

TrainResult train(const Plan &plan, const Tensors &weights, const std::vector<Tensors> &batches,
                  const std::vector<Tensors> &validation, const TrainConfig &config,
                  const std::string &fn)
{
    const std::string *loss_operand = plan.output(config.loss);
    if (!loss_operand) throw Error(fn + ": unknown output '" + config.loss + "'");
    if (config.validation && !plan.output(*config.validation))
        throw Error(fn + ": unknown output '" + *config.validation + "'");
    if (config.validation_weight && !plan.output(*config.validation_weight))
        throw Error(fn + ": unknown output '" + *config.validation_weight + "'");
    if (batches.empty()) throw Error(fn + ": there are no batches");
    if (config.epochs < 1) throw Error(fn + ": epochs must be at least 1");
    if (config.progress && *config.progress < 1) throw Error(fn + ": progress must be at least 1");

    std::map<std::string, ParamSpec> specs;
    collect_weights(plan, fn, "", specs);
    Tensors params = prepare_weights(plan, weights, config.device, fn, true);
    std::vector<Tensor> trainable;
    // one parameter group per distinct decay multiplier, in sorted name order
    std::map<double, std::vector<Tensor> > by_decay;
    std::vector<double> decays;
    for (const auto &kv : specs)
        if (kv.second.trainable) {
            trainable.push_back(params.at(kv.first));
            if (!by_decay.count(kv.second.decay)) decays.push_back(kv.second.decay);
            by_decay[kv.second.decay].push_back(params.at(kv.first));
        }
    if (trainable.empty()) throw Error(fn + ": the network has no trainable parameters");
    std::vector<torch::optim::OptimizerParamGroup> groups;
    for (double decay : decays) {
        auto options = std::make_unique<torch::optim::AdamWOptions>(config.lr);
        options->betas(std::make_tuple(config.beta1, config.beta2))
            .eps(config.eps)
            .weight_decay(config.weight_decay * decay);
        groups.emplace_back(by_decay.at(decay), std::move(options));
    }
    torch::optim::AdamW optimizer(groups, torch::optim::AdamWOptions(config.lr)
                                              .betas(std::make_tuple(config.beta1, config.beta2))
                                              .eps(config.eps)
                                              .weight_decay(config.weight_decay));
    std::optional<Tensors> ema;
    if (config.ema_decay) {
        ema = Tensors();
        for (const auto &kv : params)
            (*ema)[kv.first] = kv.second.detach().clone();
    }
    int64_t n_batches = (int64_t)batches.size();
    int64_t total_steps = config.epochs * n_batches;
    Interpreter trainer(fn, config.device, true, (uint64_t)config.seed, config.recompute);

    TrainResult result;
    double best_value = INF;
    std::optional<Tensors> best;
    int64_t stale = 0, step = 0;
    double current_lr = config.lr;
    auto set_lr = [&](double lr) {
        current_lr = lr;
        for (auto &group : optimizer.param_groups())
            static_cast<torch::optim::AdamWOptions &>(group.options()).lr(lr);
    };
    for (int64_t epoch = 1; epoch <= config.epochs; epoch++) {
        double total_loss = 0.0;
        if (config.per_epoch) set_lr(learning_rate(config, epoch - 1, config.epochs));
        std::vector<int64_t> order;
        if (config.shuffle)
            order = shuffle_order(config.seed, epoch, n_batches);
        else
            for (int64_t i = 0; i < n_batches; i++)
                order.push_back(i);
        for (int64_t index : order) {
            if (!config.per_epoch) set_lr(learning_rate(config, step, total_steps));
            Tensors inputs = to_device(batches[index], config.device);
            Tensor loss;
            {
                Autocast autocast(config.device, config.bf16);
                loss = trainer.run(plan, params, inputs, {*loss_operand}).at(*loss_operand);
            }
            if (loss.dim() != 0)
                throw Error(fn + ": the loss output '" + config.loss +
                            "' must be a scalar, got rank " + std::to_string(loss.dim()));
            optimizer.zero_grad();
            loss.backward();
            if (config.clip_norm) torch::nn::utils::clip_grad_norm_(trainable, *config.clip_norm);
            optimizer.step();
            if (ema) {
                torch::NoGradGuard no_grad;
                double d = ema_decay(config, step);
                for (auto &kv : params)
                    (*ema)[kv.first].mul_(d).add_(kv.second.detach(), 1.0 - d);
            }
            step++;
            double loss_value = loss.detach().to(torch::kCPU).item<double>();
            total_loss += loss_value;
            if (config.progress && step % *config.progress == 0)
                fprintf(stderr, "%s: epoch %lld step %lld/%lld loss %s\n", fn.c_str(),
                        (long long)epoch, (long long)step, (long long)total_steps,
                        python_float(loss_value).c_str());
        }
        double mean_loss = total_loss / (double)n_batches;
        Tensors evaluated;
        if (ema)
            evaluated = *ema;
        else
            for (const auto &kv : params)
                evaluated[kv.first] = kv.second.detach();
        std::optional<double> validated;
        if (config.validation && !validation.empty())
            validated = validate(plan, evaluated, validation, config, fn);
        result.history.push_back({epoch, mean_loss, validated, current_lr});
        if (config.progress)
            fprintf(stderr, "%s: epoch %lld/%lld loss %s validation %s lr %s\n", fn.c_str(),
                    (long long)epoch, (long long)config.epochs, python_float(mean_loss).c_str(),
                    validated ? python_float(*validated).c_str() : "none",
                    python_float(current_lr).c_str());
        double monitored = validated ? *validated : mean_loss;
        if (monitored < best_value || !best) {
            if (monitored < best_value)
                stale = 0;
            else
                stale++;
            best_value = std::min(best_value, monitored);
            result.best_epoch = epoch;
            best = Tensors();
            for (const auto &kv : evaluated)
                (*best)[kv.first] = kv.second.detach().to(torch::kCPU, torch::kFloat64);
        } else {
            stale++;
        }
        if (config.patience && stale >= *config.patience) break;
    }
    result.weights = *best;
    return result;
}

} // namespace east_ds::nn
