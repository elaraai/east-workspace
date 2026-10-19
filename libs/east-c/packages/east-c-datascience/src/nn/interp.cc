/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
#include "interp.h"

#include "../value_util.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <numeric>

namespace east_ds::nn
{

namespace
{

const double INF = std::numeric_limits<double>::infinity();
const double NAN_D = std::numeric_limits<double>::quiet_NaN();

using Bad = std::function<Error(const std::string &)>;

int64_t axis_of(const Tensor &t, int64_t axis, const Bad &bad)
{
    int64_t r = t.rank();
    if (axis < -r || axis >= r)
        throw bad("axis " + std::to_string(axis) + " is outside a rank of " + std::to_string(r));
    return axis < 0 ? axis + r : axis;
}

/* The elements before, along and after an axis. */
void axis_split(const Shape &shape, int64_t axis, int64_t &outer, int64_t &n, int64_t &inner)
{
    outer = 1;
    for (int64_t k = 0; k < axis; k++)
        outer *= shape[k];
    n = shape[axis];
    inner = 1;
    for (size_t k = axis + 1; k < shape.size(); k++)
        inner *= shape[k];
}

Shape without_axis(const Shape &shape, int64_t axis)
{
    Shape out;
    for (size_t k = 0; k < shape.size(); k++)
        if ((int64_t)k != axis) out.push_back(shape[k]);
    return out;
}

void check_index(const Tensor &index, int64_t n, const Bad &bad, const std::string &what)
{
    for (int64_t v : index.i)
        if (v < 0 || v >= n)
            throw bad(what + " " + std::to_string(v) + " is outside 0 .. " + std::to_string(n - 1));
}

int64_t segments_count(const Tensor &size, const Bad &bad)
{
    if (size.rank() == 0) throw bad("size must have a first dimension: the number of segments");
    return size.shape[0];
}

int64_t rows_stride(const Tensor &t)
{
    return t.numel() == 0 ? 0 : (int64_t)t.numel() / t.shape[0];
}

template <typename F>
Tensor zip(const Tensor &a, const Tensor &b, DType out_dtype, const Bad &bad, F f)
{
    Shape shape;
    if (!broadcast_shapes(a.shape, b.shape, shape))
        throw bad("cannot broadcast " + shape_text(a.shape) + " with " + shape_text(b.shape));
    Tensor out(out_dtype, shape);
    Walker w(shape, {broadcast_strides(a.shape, shape), broadcast_strides(b.shape, shape)});
    for (size_t k = 0; !w.done(); w.next(), k++)
        f(out, k, (size_t)w.offset(0), (size_t)w.offset(1));
    return out;
}

template <typename F> Tensor map_float(const Tensor &x, F f)
{
    Tensor out(DType::Float, x.shape);
    for (size_t k = 0; k < x.f.size(); k++)
        out.f[k] = f(x.f[k]);
    return out;
}

double softplus(double x)
{
    return x > 20.0 ? x : std::log1p(std::exp(x));
}
double sigmoid(double x)
{
    return 1.0 / (1.0 + std::exp(-x));
}
double normal_cdf(double x)
{
    return 0.5 * std::erfc(-x / std::sqrt(2.0));
}

double log_normal_cdf(double x)
{
    if (x > -20.0) return std::log(normal_cdf(x));
    // the asymptotic series of the lower tail
    double x2 = x * x;
    double series =
        1.0 - 1.0 / x2 + 3.0 / (x2 * x2) - 15.0 / (x2 * x2 * x2) + 105.0 / (x2 * x2 * x2 * x2);
    return -0.5 * x2 - std::log(-x) - 0.5 * std::log(2.0 * M_PI) + std::log(series);
}

/* Wichura's AS241 (PPND16): the normal quantile to double precision. */
double normal_quantile(double p)
{
    if (std::isnan(p) || p < 0.0 || p > 1.0) return NAN_D;
    if (p == 0.0) return -INF;
    if (p == 1.0) return INF;
    double q = p - 0.5, r;
    if (std::fabs(q) <= 0.425) {
        r = 0.180625 - q * q;
        return q *
               (((((((2509.0809287301226727 * r + 33430.575583588128105) * r +
                     67265.770927008700853) *
                        r +
                    45921.953931549871457) *
                       r +
                   13731.693765509461125) *
                      r +
                  1971.5909503065514427) *
                     r +
                 133.14166789178437745) *
                    r +
                3.387132872796366608) /
               (((((((5226.495278852545925 * r + 28729.085735721942674) * r +
                     39307.89580009271061) *
                        r +
                    21213.794301586595867) *
                       r +
                   5394.1960214247511077) *
                      r +
                  687.1870074920579083) *
                     r +
                 42.313330701600911252) *
                    r +
                1.0);
    }
    r = q < 0.0 ? p : 1.0 - p;
    r = std::sqrt(-std::log(r));
    double val;
    if (r <= 5.0) {
        r -= 1.6;
        val = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r +
                    0.24178072517745061177) *
                       r +
                   1.27045825245236838258) *
                      r +
                  3.64784832476320460504) *
                     r +
                 5.7694972214606914055) *
                    r +
                4.6303378461565452959) *
                   r +
               1.42343711074968357734) /
              (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r +
                    0.0151986665636164571966) *
                       r +
                   0.14810397642748007459) *
                      r +
                  0.68976733498510000455) *
                     r +
                 1.6763848301838038494) *
                    r +
                2.05319162663775882187) *
                   r +
               1.0);
    } else {
        r -= 5.0;
        val = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r +
                    0.0012426609473880784386) *
                       r +
                   0.026532189526576123093) *
                      r +
                  0.29656057182850489123) *
                     r +
                 1.7848265399172913358) *
                    r +
                5.4637849111641143699) *
                   r +
               6.6579046435011037772) /
              (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r +
                    1.8463183175100546818e-5) *
                       r +
                   7.868691311456132591e-4) *
                      r +
                  0.0148753612908506148525) *
                     r +
                 0.13692988092273580531) *
                    r +
                0.59983220655588793769) *
                   r +
               1.0);
    }
    return q < 0.0 ? -val : val;
}

double log1mexp(double x)
{
    return x > -std::log(2.0) ? std::log(-std::expm1(x)) : std::log1p(-std::exp(x));
}

/* Segment helpers: `rows` consecutive elements per leading index. */
Tensor segment_zeros(const Tensor &x, int64_t n_seg)
{
    Shape shape = x.shape;
    shape[0] = n_seg;
    return Tensor(x.dtype, shape);
}

} // namespace

double Rng::normal()
{
    if (has_spare_) {
        has_spare_ = false;
        return spare_;
    }
    double u1 = uniform(), u2 = uniform();
    while (u1 <= 1e-300)
        u1 = uniform();
    double r = std::sqrt(-2.0 * std::log(u1));
    spare_ = r * std::sin(2.0 * M_PI * u2);
    has_spare_ = true;
    return r * std::cos(2.0 * M_PI * u2);
}

// ============================================================================
// Entry
// ============================================================================

std::map<std::string, TensorPtr> Interpreter::run(const Plan &plan,
                                                  const std::map<std::string, TensorPtr> &weights,
                                                  const std::map<std::string, TensorPtr> &inputs,
                                                  const std::vector<std::string> &operands)
{
    weights_ = &weights;
    for (const auto &kv : plan.inputs) {
        auto it = inputs.find(kv.first);
        if (it == inputs.end()) throw Error(fn_ + ": the batch has no input '" + kv.first + "'");
        const Tensor &t = *it->second;
        if (t.dtype != kv.second.dtype)
            throw Error(fn_ + ": input '" + kv.first + "' is " + dtype_name(t.dtype) +
                        " but the network declares " + dtype_name(kv.second.dtype));
        if (t.rank() != kv.second.rank)
            throw Error(fn_ + ": input '" + kv.first + "' has rank " + std::to_string(t.rank()) +
                        " but the network declares rank " + std::to_string(kv.second.rank));
    }
    return eval(plan, inputs, "", operands);
}

std::map<std::string, TensorPtr> Interpreter::eval(const Plan &plan,
                                                   const std::map<std::string, TensorPtr> &bound,
                                                   const std::string &prefix,
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
    std::map<std::string, TensorPtr> out;
    for (const std::string &operand : operands) {
        const Tensor &t = get(env, operand);
        auto [head, sub] = split_operand(operand);
        const Value &v = env.at(head);
        out[operand] =
            v.many ? (sub.empty() ? v.several.begin()->second : v.several.at(sub)) : v.one;
        (void)t;
    }
    return out;
}

const Tensor &Interpreter::get(const Env &env, const std::string &operand)
{
    auto [head, sub] = split_operand(operand);
    const Value &v = env.at(head);
    if (v.many) {
        if (sub.empty()) {
            if (v.several.size() == 1) return *v.several.begin()->second;
            throw Error(fn_ + ": '" + head + "' holds several tensors: name one as '" + head +
                        ".<name>'");
        }
        return *v.several.at(sub);
    }
    return *v.one;
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
    auto g = [&](const char *f) -> const Tensor & { return get(env, nd.s(f)); };
    auto opt = [&](const char *f) -> const Tensor * {
        return nd.has(f) ? &get(env, nd.s(f)) : nullptr;
    };
    auto one = [](Tensor t) {
        Value v;
        v.one = std::make_shared<Tensor>(std::move(t));
        return v;
    };

    if (op == "call") return call(plan, nd, env, prefix, wanted);
    if (op == "loop") return loop(nd, env, prefix);

    // ---- indexing and layout
    if (op == "gather") {
        const Tensor &table = g("table"), &index = g("index");
        if (table.rank() == 0) throw bad("table must have a first dimension");
        check_index(index, table.shape[0], bad, "index");
        int64_t row = rows_stride(table);
        Shape shape = index.shape;
        shape.insert(shape.end(), table.shape.begin() + 1, table.shape.end());
        Tensor out(table.dtype, shape);
        for (size_t k = 0; k < index.i.size(); k++)
            for (int64_t c = 0; c < row; c++)
                out.copy_from(k * row + c, table, index.i[k] * row + c);
        return one(std::move(out));
    }
    if (op == "embedding_bag") {
        const Tensor &table = g("table"), &index = g("index"), &segments = g("segments"),
                     &size = g("size");
        const Tensor *weights = opt("weights");
        if (table.rank() < 1 || index.rank() != 1 || segments.rank() != 1)
            throw bad("table has a first dimension, index and segments are vectors");
        if (index.shape[0] != segments.shape[0])
            throw bad("index has " + std::to_string(index.shape[0]) + " entries but segments has " +
                      std::to_string(segments.shape[0]));
        if (weights && (weights->rank() != 1 || weights->shape[0] != index.shape[0]))
            throw bad("weights must have " + std::to_string(index.shape[0]) + " entries");
        int64_t n_seg = segments_count(size, bad);
        check_index(index, table.shape[0], bad, "index");
        check_index(segments, n_seg, bad, "segments");
        int64_t row = rows_stride(table);
        Tensor out = segment_zeros(table, n_seg);
        for (size_t k = 0; k < index.i.size(); k++) {
            double w = weights ? weights->f[k] : 1.0;
            for (int64_t c = 0; c < row; c++)
                out.f[segments.i[k] * row + c] += w * table.f[index.i[k] * row + c];
        }
        return one(std::move(out));
    }
    if (op == "segment_reduce") {
        const Tensor &x = g("x"), &segments = g("segments"), &size = g("size");
        const std::string &reduce = nd.s("reduce");
        if (x.rank() < 1 || segments.rank() != 1 || segments.shape[0] != x.shape[0])
            throw bad("segments is a vector with one id per row of x");
        int64_t n_seg = segments_count(size, bad);
        check_index(segments, n_seg, bad, "segments");
        int64_t row = rows_stride(x);
        Tensor out = segment_zeros(x, n_seg);
        std::vector<int64_t> counts(n_seg, 0);
        std::vector<uint8_t> seen((size_t)(n_seg * row), 0);
        for (int64_t r = 0; r < x.shape[0]; r++) {
            int64_t s = segments.i[r];
            counts[s]++;
            for (int64_t c = 0; c < row; c++) {
                size_t o = s * row + c, src = r * row + c;
                if (x.dtype == DType::Float) {
                    double v = x.f[src];
                    if (reduce == "sum" || reduce == "mean")
                        out.f[o] += v;
                    else if (!seen[o] || (reduce == "max" ? v > out.f[o] : v < out.f[o]))
                        out.f[o] = v;
                } else {
                    int64_t v = x.i[src];
                    if (reduce == "sum")
                        out.i[o] += v;
                    else if (!seen[o] || (reduce == "max" ? v > out.i[o] : v < out.i[o]))
                        out.i[o] = v;
                }
                seen[o] = 1;
            }
        }
        if (reduce == "mean")
            for (int64_t s = 0; s < n_seg; s++)
                if (counts[s] > 0)
                    for (int64_t c = 0; c < row; c++)
                        out.f[s * row + c] /= (double)counts[s];
        return one(std::move(out));
    }
    if (op == "segment_softmax" || op == "segment_log_softmax") {
        const Tensor &x = g("x"), &segments = g("segments");
        if (x.rank() < 1 || segments.rank() != 1 || segments.shape[0] != x.shape[0])
            throw bad("segments is a vector with one id per row of x");
        Tensor out(DType::Float, x.shape);
        if (x.shape[0] == 0) return one(std::move(out));
        int64_t n_seg = 0;
        for (int64_t s : segments.i) {
            if (s < 0) throw bad("a segment id is negative");
            n_seg = std::max(n_seg, s + 1);
        }
        int64_t row = rows_stride(x);
        std::vector<double> mx((size_t)(n_seg * row), -INF), sum((size_t)(n_seg * row), 0.0);
        for (int64_t r = 0; r < x.shape[0]; r++)
            for (int64_t c = 0; c < row; c++)
                mx[segments.i[r] * row + c] =
                    std::max(mx[segments.i[r] * row + c], x.f[r * row + c]);
        for (int64_t r = 0; r < x.shape[0]; r++)
            for (int64_t c = 0; c < row; c++)
                sum[segments.i[r] * row + c] +=
                    std::exp(x.f[r * row + c] - mx[segments.i[r] * row + c]);
        for (int64_t r = 0; r < x.shape[0]; r++)
            for (int64_t c = 0; c < row; c++) {
                size_t o = segments.i[r] * row + c;
                double shifted = x.f[r * row + c] - mx[o];
                out.f[r * row + c] = op == "segment_softmax" ? std::exp(shifted) / sum[o]
                                                             : shifted - std::log(sum[o]);
            }
        return one(std::move(out));
    }
    if (op == "scatter_add") {
        const Tensor &x = g("x"), &index = g("index"), &size = g("size");
        if (x.rank() < 1 || index.rank() != 1 || index.shape[0] != x.shape[0])
            throw bad("index is a vector with one entry per row of x");
        int64_t n_seg = segments_count(size, bad);
        check_index(index, n_seg, bad, "index");
        int64_t row = rows_stride(x);
        Tensor out = segment_zeros(x, n_seg);
        for (int64_t r = 0; r < x.shape[0]; r++)
            for (int64_t c = 0; c < row; c++) {
                if (x.dtype == DType::Float)
                    out.f[index.i[r] * row + c] += x.f[r * row + c];
                else
                    out.i[index.i[r] * row + c] += x.i[r * row + c];
            }
        return one(std::move(out));
    }
    if (op == "concat") {
        std::vector<const Tensor *> xs;
        for (const std::string &name : nd.list)
            xs.push_back(&get(env, name));
        for (const Tensor *x : xs)
            if (x->rank() != xs[0]->rank()) throw bad("inputs must have one rank");
        int64_t axis = axis_of(*xs[0], nd.iv("axis"), bad);
        Shape shape = xs[0]->shape;
        shape[axis] = 0;
        for (const Tensor *x : xs) {
            for (size_t k = 0; k < shape.size(); k++)
                if ((int64_t)k != axis && x->shape[k] != xs[0]->shape[k])
                    throw bad("inputs must agree in every dimension but the axis");
            shape[axis] += x->shape[axis];
        }
        Tensor out(xs[0]->dtype, shape);
        int64_t outer, n, inner;
        axis_split(shape, axis, outer, n, inner);
        int64_t at = 0;
        for (const Tensor *x : xs) {
            int64_t xn = x->shape[axis];
            for (int64_t o = 0; o < outer; o++)
                for (int64_t j = 0; j < xn; j++)
                    for (int64_t in = 0; in < inner; in++)
                        out.copy_from((o * n + at + j) * inner + in, *x, (o * xn + j) * inner + in);
            at += xn;
        }
        return one(std::move(out));
    }
    if (op == "split" || op == "slice") {
        const Tensor &x = g("x");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        int64_t n = x.shape[axis], start, stop;
        if (op == "split") {
            int64_t total = 0;
            for (int64_t s : nd.ints)
                total += s;
            if (total != n)
                throw bad("sizes sum to " + std::to_string(total) + " but the axis has " +
                          std::to_string(n));
            start = 0;
            for (int64_t k = 0; k < nd.iv("part"); k++)
                start += nd.ints[k];
            stop = start + nd.ints[nd.iv("part")];
        } else {
            start = nd.iv("start");
            stop = nd.ival.count("stop") ? nd.iv("stop") : n;
            if (start < 0) start += n;
            if (stop < 0) stop += n;
            start = std::clamp<int64_t>(start, 0, n);
            stop = std::clamp<int64_t>(stop, start, n);
        }
        Shape shape = x.shape;
        shape[axis] = stop - start;
        Tensor out(x.dtype, shape);
        int64_t outer, nn, inner;
        axis_split(x.shape, axis, outer, nn, inner);
        for (int64_t o = 0; o < outer; o++)
            for (int64_t j = start; j < stop; j++)
                for (int64_t in = 0; in < inner; in++)
                    out.copy_from((o * (stop - start) + (j - start)) * inner + in, x,
                                  (o * nn + j) * inner + in);
        return one(std::move(out));
    }
    if (op == "pad") {
        const Tensor &x = g("x");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        int64_t before = nd.iv("before"), after = nd.iv("after"), n = x.shape[axis];
        bool replicate = nd.s("mode") == "replicate";
        if (replicate && n == 0) throw bad("an empty axis cannot be replicated");
        Shape shape = x.shape;
        shape[axis] = n + before + after;
        Tensor out(x.dtype, shape);
        int64_t outer, nn, inner;
        axis_split(x.shape, axis, outer, nn, inner);
        for (int64_t o = 0; o < outer; o++)
            for (int64_t j = 0; j < shape[axis]; j++) {
                int64_t src = j - before;
                if (src < 0 || src >= n) {
                    if (!replicate) continue;
                    src = std::clamp<int64_t>(src, 0, n - 1);
                }
                for (int64_t in = 0; in < inner; in++)
                    out.copy_from((o * shape[axis] + j) * inner + in, x,
                                  (o * nn + src) * inner + in);
            }
        return one(std::move(out));
    }
    if (op == "reshape") {
        const Tensor &x = g("x");
        Shape shape = nd.ints;
        int64_t known = 1, minus = -1;
        for (size_t k = 0; k < shape.size(); k++) {
            if (shape[k] == -1)
                minus = (int64_t)k;
            else
                known *= shape[k];
        }
        int64_t total = (int64_t)x.numel();
        if (minus >= 0) {
            if (known == 0 || total % known != 0)
                throw bad("cannot reshape " + shape_text(x.shape) + " to " + shape_text(nd.ints));
            shape[minus] = total / known;
        } else if (known != total)
            throw bad("cannot reshape " + shape_text(x.shape) + " to " + shape_text(nd.ints));
        Tensor out = x;
        out.shape = shape;
        return one(std::move(out));
    }
    if (op == "permute") {
        const Tensor &x = g("x");
        if ((int64_t)nd.ints.size() != x.rank())
            throw bad("axes has " + std::to_string(nd.ints.size()) + " entries but the rank is " +
                      std::to_string(x.rank()));
        Shape shape;
        std::vector<int64_t> src_strides = strides_of(x.shape), walk(x.rank());
        for (size_t k = 0; k < nd.ints.size(); k++) {
            shape.push_back(x.shape[nd.ints[k]]);
            walk[k] = src_strides[nd.ints[k]];
        }
        Tensor out(x.dtype, shape);
        Walker w(shape, {walk});
        for (size_t k = 0; !w.done(); w.next(), k++)
            out.copy_from(k, x, (size_t)w.offset(0));
        return one(std::move(out));
    }
    if (op == "broadcast") {
        const Tensor &x = g("x"), &like = g("like");
        Shape shape;
        if (!broadcast_shapes(x.shape, like.shape, shape) || shape != like.shape)
            throw bad("cannot broadcast " + shape_text(x.shape) + " to " + shape_text(like.shape));
        Tensor out(x.dtype, shape);
        Walker w(shape, {broadcast_strides(x.shape, shape)});
        for (size_t k = 0; !w.done(); w.next(), k++)
            out.copy_from(k, x, (size_t)w.offset(0));
        return one(std::move(out));
    }
    if (op == "where") {
        const Tensor &c = g("cond"), &a = g("a"), &b = g("b");
        Shape ab, shape;
        if (!broadcast_shapes(a.shape, b.shape, ab) || !broadcast_shapes(c.shape, ab, shape))
            throw bad("cannot broadcast " + shape_text(c.shape) + ", " + shape_text(a.shape) +
                      " and " + shape_text(b.shape));
        Tensor out(a.dtype, shape);
        Walker w(shape, {broadcast_strides(c.shape, shape), broadcast_strides(a.shape, shape),
                         broadcast_strides(b.shape, shape)});
        for (size_t k = 0; !w.done(); w.next(), k++) {
            if (c.b[w.offset(0)])
                out.copy_from(k, a, (size_t)w.offset(1));
            else
                out.copy_from(k, b, (size_t)w.offset(2));
        }
        return one(std::move(out));
    }
    if (op == "constant") {
        const std::string &tag = nd.s("value");
        if (tag == "float") return one(Tensor::scalar(nd.fv("value")));
        if (tag == "integer") return one(Tensor::scalar_int(nd.iv("value")));
        return one(Tensor::scalar_bool(nd.bv("value")));
    }
    if (op == "cast") {
        const Tensor &x = g("x");
        DType target = dtype_of_name(nd.s("dtype"));
        Tensor out(target, x.shape);
        size_t n = x.numel();
        for (size_t k = 0; k < n; k++) {
            switch (target) {
            case DType::Float:
                out.f[k] = x.as_double(k);
                break;
            case DType::Integer:
                if (x.dtype == DType::Float) {
                    if (!std::isfinite(x.f[k]))
                        throw bad("cannot cast a non-finite float to integer");
                    out.i[k] = (int64_t)std::trunc(x.f[k]);
                } else
                    out.i[k] = x.as_int(k);
                break;
            case DType::Boolean:
                out.b[k] = x.as_double(k) != 0.0 ? 1 : 0;
                break;
            }
        }
        return one(std::move(out));
    }

    // ---- dense
    if (op == "linear") {
        const Tensor &x = g("x"), &w = g("weight");
        const Tensor *b = opt("bias");
        if (x.rank() < 1 || w.rank() != 2)
            throw bad("x has a last dimension and weight is a matrix [out, in]");
        int64_t in = x.shape.back(), outf = w.shape[0];
        if (in != w.shape[1])
            throw bad("x has " + std::to_string(in) + " columns but weight has " +
                      std::to_string(w.shape[1]));
        if (b && (b->rank() != 1 || b->shape[0] != outf))
            throw bad("bias must have " + std::to_string(outf) + " entries");
        Shape shape = x.shape;
        shape.back() = outf;
        Tensor out(DType::Float, shape);
        int64_t rows =
            in == 0 ? (int64_t)out.numel() / std::max<int64_t>(outf, 1) : (int64_t)x.numel() / in;
        for (int64_t r = 0; r < rows; r++)
            for (int64_t o = 0; o < outf; o++) {
                double acc = b ? b->f[o] : 0.0;
                const double *xr = x.f.data() + r * in, *wr = w.f.data() + o * in;
                for (int64_t c = 0; c < in; c++)
                    acc += xr[c] * wr[c];
                out.f[r * outf + o] = acc;
            }
        return one(std::move(out));
    }
    if (op == "einsum") {
        std::vector<const Tensor *> xs;
        for (const std::string &name : nd.list)
            xs.push_back(&get(env, name));
        const std::string &subs = nd.s("subscripts");
        size_t arrow = subs.find("->");
        std::string lhs = subs.substr(0, arrow), rhs = subs.substr(arrow + 2);
        std::vector<std::string> terms;
        size_t start = 0;
        while (true) {
            size_t comma = lhs.find(',', start);
            terms.push_back(
                lhs.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
            if (comma == std::string::npos) break;
            start = comma + 1;
        }
        std::map<char, int64_t> extent;
        for (size_t o = 0; o < xs.size(); o++) {
            if ((int64_t)terms[o].size() != xs[o]->rank())
                throw bad("'" + terms[o] + "' names " + std::to_string(terms[o].size()) +
                          " axes but input " + std::to_string(o) + " has rank " +
                          std::to_string(xs[o]->rank()));
            for (size_t k = 0; k < terms[o].size(); k++) {
                char c = terms[o][k];
                int64_t d = xs[o]->shape[k];
                auto it = extent.find(c);
                if (it == extent.end())
                    extent[c] = d;
                else if (it->second != d)
                    throw bad(std::string("the letter '") + c + "' has extent " +
                              std::to_string(it->second) + " in one operand and " +
                              std::to_string(d) + " in another");
            }
        }
        std::string letters = rhs;
        for (const auto &kv : extent)
            if (rhs.find(kv.first) == std::string::npos) letters += kv.first;
        Shape full;
        for (char c : letters)
            full.push_back(extent[c]);
        std::vector<std::vector<int64_t> > strides;
        for (size_t o = 0; o < xs.size(); o++) {
            std::vector<int64_t> own = strides_of(xs[o]->shape), st(letters.size(), 0);
            for (size_t k = 0; k < terms[o].size(); k++)
                st[letters.find(terms[o][k])] = own[k];
            strides.push_back(st);
        }
        Shape out_shape(full.begin(), full.begin() + rhs.size());
        Tensor out(DType::Float, out_shape);
        int64_t n_out = numel_of(out_shape), n_sum = numel_of(full) / std::max<int64_t>(n_out, 1);
        if (n_out == 0) return one(std::move(out));
        Walker w(full, strides);
        for (int64_t k = 0; !w.done(); w.next(), k++) {
            double prod = 1.0;
            for (size_t o = 0; o < xs.size(); o++)
                prod *= xs[o]->f[w.offset(o)];
            out.f[k / n_sum] += prod;
        }
        return one(std::move(out));
    }
    if (op == "conv1d") {
        const Tensor &x = g("x"), &w = g("weight");
        const Tensor *b = opt("bias");
        if (x.rank() != 3 || w.rank() != 3)
            throw bad("x is [N, C_in, L] and weight is [C_out, C_in/groups, K]");
        int64_t groups = nd.iv("groups"), stride = nd.iv("stride"), dilation = nd.iv("dilation");
        int64_t N = x.shape[0], cin = x.shape[1], L = x.shape[2], cout = w.shape[0],
                cg = w.shape[1], K = w.shape[2];
        if (cin != cg * groups || cout % groups != 0)
            throw bad("x has " + std::to_string(cin) + " channels but weight takes " +
                      std::to_string(cg) + " × " + std::to_string(groups) + " groups");
        if (b && (b->rank() != 1 || b->shape[0] != cout))
            throw bad("bias must have " + std::to_string(cout) + " entries");
        int64_t Lout = (L - dilation * (K - 1) - 1) / stride + 1;
        if (L - dilation * (K - 1) - 1 < 0)
            throw bad("the kernel does not fit a length of " + std::to_string(L));
        Tensor out(DType::Float, {N, cout, Lout});
        int64_t cout_g = cout / groups;
        for (int64_t n = 0; n < N; n++)
            for (int64_t co = 0; co < cout; co++) {
                int64_t grp = co / cout_g;
                for (int64_t l = 0; l < Lout; l++) {
                    double acc = b ? b->f[co] : 0.0;
                    for (int64_t ci = 0; ci < cg; ci++)
                        for (int64_t k = 0; k < K; k++)
                            acc += x.f[(n * cin + grp * cg + ci) * L + l * stride + k * dilation] *
                                   w.f[(co * cg + ci) * K + k];
                    out.f[(n * cout + co) * Lout + l] = acc;
                }
            }
        return one(std::move(out));
    }
    if (op == "avg_pool1d") {
        const Tensor &x = g("x");
        if (x.rank() != 3) throw bad("x is [N, C, L]");
        int64_t kernel = nd.iv("kernel"), stride = nd.iv("stride"), N = x.shape[0], C = x.shape[1],
                L = x.shape[2];
        if (L < kernel) throw bad("the kernel does not fit a length of " + std::to_string(L));
        int64_t Lout = (L - kernel) / stride + 1;
        Tensor out(DType::Float, {N, C, Lout});
        for (int64_t nc = 0; nc < N * C; nc++)
            for (int64_t l = 0; l < Lout; l++) {
                double acc = 0.0;
                for (int64_t k = 0; k < kernel; k++)
                    acc += x.f[nc * L + l * stride + k];
                out.f[nc * Lout + l] = acc / (double)kernel;
            }
        return one(std::move(out));
    }
    if (op == "upsample_nearest") {
        const Tensor &x = g("x");
        if (x.rank() < 1) throw bad("x has a last dimension");
        int64_t scale = nd.iv("scale"), L = x.shape.back();
        Shape shape = x.shape;
        shape.back() = L * scale;
        Tensor out(DType::Float, shape);
        int64_t rows = L == 0 ? 0 : (int64_t)x.numel() / L;
        for (int64_t r = 0; r < rows; r++)
            for (int64_t l = 0; l < L; l++)
                for (int64_t s = 0; s < scale; s++)
                    out.f[r * L * scale + l * scale + s] = x.f[r * L + l];
        return one(std::move(out));
    }
    if (op == "layer_norm") {
        const Tensor &x = g("x");
        const Tensor *w = opt("weight"), *b = opt("bias");
        if (x.rank() < 1) throw bad("x has a last dimension");
        int64_t d = x.shape.back();
        if (w && (w->rank() != 1 || w->shape[0] != d))
            throw bad("weight must have " + std::to_string(d) + " entries");
        if (b && (b->rank() != 1 || b->shape[0] != d))
            throw bad("bias must have " + std::to_string(d) + " entries");
        double eps = nd.fv("eps");
        Tensor out(DType::Float, x.shape);
        int64_t rows = d == 0 ? 0 : (int64_t)x.numel() / d;
        for (int64_t r = 0; r < rows; r++) {
            double mean = 0.0, var = 0.0;
            for (int64_t c = 0; c < d; c++)
                mean += x.f[r * d + c];
            mean /= (double)d;
            for (int64_t c = 0; c < d; c++)
                var += (x.f[r * d + c] - mean) * (x.f[r * d + c] - mean);
            var /= (double)d;
            double inv = 1.0 / std::sqrt(var + eps);
            for (int64_t c = 0; c < d; c++) {
                double y = (x.f[r * d + c] - mean) * inv;
                if (w) y *= w->f[c];
                if (b) y += b->f[c];
                out.f[r * d + c] = y;
            }
        }
        return one(std::move(out));
    }
    if (op == "group_norm") {
        const Tensor &x = g("x");
        const Tensor *w = opt("weight"), *b = opt("bias");
        if (x.rank() < 2) throw bad("x is [N, C, ...]");
        int64_t groups = nd.iv("groups"), N = x.shape[0], C = x.shape[1];
        if (C % groups != 0)
            throw bad(std::to_string(C) + " channels are not a multiple of " +
                      std::to_string(groups) + " groups");
        if (w && (w->rank() != 1 || w->shape[0] != C))
            throw bad("weight must have " + std::to_string(C) + " entries");
        if (b && (b->rank() != 1 || b->shape[0] != C))
            throw bad("bias must have " + std::to_string(C) + " entries");
        int64_t spatial = N * C == 0 ? 0 : (int64_t)x.numel() / (N * C), cg = C / groups;
        double eps = nd.fv("eps");
        Tensor out(DType::Float, x.shape);
        for (int64_t n = 0; n < N; n++)
            for (int64_t gi = 0; gi < groups; gi++) {
                double mean = 0.0, var = 0.0;
                int64_t count = cg * spatial;
                for (int64_t c = gi * cg; c < (gi + 1) * cg; c++)
                    for (int64_t s = 0; s < spatial; s++)
                        mean += x.f[(n * C + c) * spatial + s];
                mean /= (double)count;
                for (int64_t c = gi * cg; c < (gi + 1) * cg; c++)
                    for (int64_t s = 0; s < spatial; s++) {
                        double dlt = x.f[(n * C + c) * spatial + s] - mean;
                        var += dlt * dlt;
                    }
                var /= (double)count;
                double inv = 1.0 / std::sqrt(var + eps);
                for (int64_t c = gi * cg; c < (gi + 1) * cg; c++)
                    for (int64_t s = 0; s < spatial; s++) {
                        double y = (x.f[(n * C + c) * spatial + s] - mean) * inv;
                        if (w) y *= w->f[c];
                        if (b) y += b->f[c];
                        out.f[(n * C + c) * spatial + s] = y;
                    }
            }
        return one(std::move(out));
    }

    // ---- element-wise
    if (op == "add" || op == "sub" || op == "mul" || op == "div" || op == "pow") {
        const Tensor &a = g("a"), &b = g("b");
        if (a.dtype == DType::Float)
            return one(zip(a, b, DType::Float, bad, [&](Tensor &o, size_t k, size_t ia, size_t ib) {
                double x = a.f[ia], y = b.f[ib];
                o.f[k] = op == "add"   ? x + y
                         : op == "sub" ? x - y
                         : op == "mul" ? x * y
                         : op == "div" ? x / y
                                       : std::pow(x, y);
            }));
        return one(zip(a, b, DType::Integer, bad, [&](Tensor &o, size_t k, size_t ia, size_t ib) {
            int64_t x = a.i[ia], y = b.i[ib];
            o.i[k] = op == "add" ? x + y : op == "sub" ? x - y : x * y;
        }));
    }
    if (op == "eq" || op == "ne" || op == "lt" || op == "le" || op == "gt" || op == "ge") {
        const Tensor &a = g("a"), &b = g("b");
        return one(zip(a, b, DType::Boolean, bad, [&](Tensor &o, size_t k, size_t ia, size_t ib) {
            bool r;
            if (a.dtype == DType::Float) {
                double x = a.f[ia], y = b.f[ib];
                r = op == "eq"   ? x == y
                    : op == "ne" ? x != y
                    : op == "lt" ? x < y
                    : op == "le" ? x <= y
                    : op == "gt" ? x > y
                                 : x >= y;
            } else {
                int64_t x = a.as_int(ia), y = b.as_int(ib);
                r = op == "eq"   ? x == y
                    : op == "ne" ? x != y
                    : op == "lt" ? x < y
                    : op == "le" ? x <= y
                    : op == "gt" ? x > y
                                 : x >= y;
            }
            o.b[k] = r ? 1 : 0;
        }));
    }
    if (op == "logical_and" || op == "logical_or") {
        const Tensor &a = g("a"), &b = g("b");
        return one(zip(a, b, DType::Boolean, bad, [&](Tensor &o, size_t k, size_t ia, size_t ib) {
            o.b[k] = (op == "logical_and" ? (a.b[ia] && b.b[ib]) : (a.b[ia] || b.b[ib])) ? 1 : 0;
        }));
    }
    if (op == "logical_not") {
        const Tensor &x = g("x");
        Tensor out(DType::Boolean, x.shape);
        for (size_t k = 0; k < x.b.size(); k++)
            out.b[k] = x.b[k] ? 0 : 1;
        return one(std::move(out));
    }
    if (op == "neg" || op == "abs") {
        const Tensor &x = g("x");
        Tensor out(x.dtype, x.shape);
        for (size_t k = 0; k < x.numel(); k++) {
            if (x.dtype == DType::Float)
                out.f[k] = op == "neg" ? -x.f[k] : std::fabs(x.f[k]);
            else
                out.i[k] = op == "neg" ? -x.i[k] : (x.i[k] < 0 ? -x.i[k] : x.i[k]);
        }
        return one(std::move(out));
    }
    if (op == "is_nan") {
        const Tensor &x = g("x");
        Tensor out(DType::Boolean, x.shape);
        for (size_t k = 0; k < x.f.size(); k++)
            out.b[k] = std::isnan(x.f[k]) ? 1 : 0;
        return one(std::move(out));
    }
    {
        const Tensor *xp = nd.has("x") ? &get(env, nd.s("x")) : nullptr;
        if (op == "exp") return one(map_float(*xp, [](double v) { return std::exp(v); }));
        if (op == "log") return one(map_float(*xp, [](double v) { return std::log(v); }));
        if (op == "log1p") return one(map_float(*xp, [](double v) { return std::log1p(v); }));
        if (op == "sqrt") return one(map_float(*xp, [](double v) { return std::sqrt(v); }));
        if (op == "softplus") return one(map_float(*xp, softplus));
        if (op == "sigmoid") return one(map_float(*xp, sigmoid));
        if (op == "tanh") return one(map_float(*xp, [](double v) { return std::tanh(v); }));
        if (op == "relu") return one(map_float(*xp, [](double v) { return v > 0.0 ? v : 0.0; }));
        if (op == "silu") return one(map_float(*xp, [](double v) { return v * sigmoid(v); }));
        if (op == "sin") return one(map_float(*xp, [](double v) { return std::sin(v); }));
        if (op == "cos") return one(map_float(*xp, [](double v) { return std::cos(v); }));
        if (op == "normal_cdf") return one(map_float(*xp, normal_cdf));
        if (op == "log_normal_cdf") return one(map_float(*xp, log_normal_cdf));
        if (op == "normal_quantile") return one(map_float(*xp, normal_quantile));
        if (op == "log1mexp") return one(map_float(*xp, log1mexp));
        if (op == "gelu") {
            bool tanh_form = nd.s("approximate") == "tanh";
            return one(map_float(*xp, [tanh_form](double v) {
                if (tanh_form)
                    return 0.5 * v *
                           (1.0 + std::tanh(std::sqrt(2.0 / M_PI) * (v + 0.044715 * v * v * v)));
                return 0.5 * v * (1.0 + std::erf(v / std::sqrt(2.0)));
            }));
        }
        if (op == "clamp") {
            bool has_lo = nd.fval.count("min") > 0, has_hi = nd.fval.count("max") > 0;
            double lo = has_lo ? nd.fv("min") : 0.0, hi = has_hi ? nd.fv("max") : 0.0;
            return one(map_float(*xp, [=](double v) {
                if (has_lo && v < lo) v = lo;
                if (has_hi && v > hi) v = hi;
                return v;
            }));
        }
        if (op == "nan_to_num") {
            double nan_v = nd.fv("nan"), pos = nd.fv("posinf"), neg = nd.fv("neginf");
            return one(map_float(*xp, [=](double v) {
                if (std::isnan(v)) return nan_v;
                if (std::isinf(v)) return v > 0 ? pos : neg;
                return v;
            }));
        }
        if (op == "dropout") {
            if (!training_) return one(*xp);
            double p = nd.fv("p");
            Tensor out(DType::Float, xp->shape);
            for (size_t k = 0; k < xp->f.size(); k++)
                out.f[k] = rng_.uniform() >= p ? xp->f[k] / (1.0 - p) : 0.0;
            return one(std::move(out));
        }
        if (op == "stop_gradient") return one(*xp);
    }
    if (op == "random_normal" || op == "random_uniform") {
        const Tensor &like = g("like");
        Tensor out(DType::Float, like.shape);
        for (size_t k = 0; k < out.f.size(); k++)
            out.f[k] = op == "random_normal" ? rng_.normal() : rng_.uniform();
        return one(std::move(out));
    }

    // ---- along an axis
    if (op == "sum" || op == "mean" || op == "max" || op == "min" || op == "logsumexp" ||
        op == "softmax" || op == "log_softmax" || op == "cumsum" || op == "cummax" ||
        op == "cummin" || op == "argmax") {
        const Tensor &x = g("x");
        if (x.rank() == 0) throw bad("x must have an axis");
        int64_t axis = axis_of(x, nd.iv("axis"), bad);
        int64_t outer, n, inner;
        axis_split(x.shape, axis, outer, n, inner);
        if ((op == "max" || op == "min" || op == "argmax") && n == 0)
            throw bad("the axis is empty");
        bool keeps = op == "softmax" || op == "log_softmax" || op == "cumsum" || op == "cummax" ||
                     op == "cummin";
        Shape shape = keeps ? x.shape : without_axis(x.shape, axis);
        DType out_dtype = op == "argmax" ? DType::Integer : x.dtype;
        Tensor out(out_dtype, shape);
        bool is_float = x.dtype == DType::Float;
        for (int64_t o = 0; o < outer; o++)
            for (int64_t in = 0; in < inner; in++) {
                auto at = [&](int64_t j) { return (o * n + j) * inner + in; };
                size_t ro = (size_t)(o * inner + in);
                if (op == "sum" || op == "mean") {
                    if (is_float) {
                        double acc = 0.0;
                        for (int64_t j = 0; j < n; j++)
                            acc += x.f[at(j)];
                        out.f[ro] = op == "mean" ? (n > 0 ? acc / (double)n : 0.0) : acc;
                    } else {
                        int64_t acc = 0;
                        for (int64_t j = 0; j < n; j++)
                            acc += x.i[at(j)];
                        out.i[ro] = acc;
                    }
                } else if (op == "max" || op == "min" || op == "argmax") {
                    int64_t best = 0;
                    for (int64_t j = 1; j < n; j++) {
                        bool better = is_float ? (op == "min" ? x.f[at(j)] < x.f[at(best)]
                                                              : x.f[at(j)] > x.f[at(best)])
                                               : (op == "min" ? x.i[at(j)] < x.i[at(best)]
                                                              : x.i[at(j)] > x.i[at(best)]);
                        if (better) best = j;
                    }
                    if (op == "argmax")
                        out.i[ro] = best;
                    else if (is_float)
                        out.f[ro] = x.f[at(best)];
                    else
                        out.i[ro] = x.i[at(best)];
                } else if (op == "logsumexp" || op == "softmax" || op == "log_softmax") {
                    double mx = -INF;
                    for (int64_t j = 0; j < n; j++)
                        mx = std::max(mx, x.f[at(j)]);
                    double sum = 0.0;
                    for (int64_t j = 0; j < n; j++)
                        sum += std::exp(x.f[at(j)] - mx);
                    if (op == "logsumexp")
                        out.f[ro] = n == 0 ? -INF : mx + std::log(sum);
                    else
                        for (int64_t j = 0; j < n; j++)
                            out.f[at(j)] = op == "softmax" ? std::exp(x.f[at(j)] - mx) / sum
                                                           : x.f[at(j)] - mx - std::log(sum);
                } else {
                    for (int64_t j = 0; j < n; j++) {
                        if (is_float) {
                            double prev = j == 0 ? (op == "cumsum" ? 0.0 : x.f[at(0)])
                                                 : out.f[at(j - 1)],
                                   v = x.f[at(j)];
                            out.f[at(j)] = op == "cumsum"   ? prev + v
                                           : op == "cummax" ? std::max(prev, v)
                                                            : std::min(prev, v);
                        } else {
                            int64_t prev = j == 0 ? (op == "cumsum" ? 0 : x.i[at(0)])
                                                  : out.i[at(j - 1)],
                                    v = x.i[at(j)];
                            out.i[at(j)] = op == "cumsum"   ? prev + v
                                           : op == "cummax" ? std::max(prev, v)
                                                            : std::min(prev, v);
                        }
                    }
                }
            }
        return one(std::move(out));
    }

    // ---- attention
    if (op == "attention") return one(attention(nd, env));
    if (op == "rotary") {
        const Tensor &x = g("x"), &positions = g("positions");
        int64_t heads = nd.iv("heads");
        if (x.rank() < 2) throw bad("x is [..., T, d]");
        int64_t d = x.shape.back();
        if (d % heads != 0)
            throw bad("d = " + std::to_string(d) +
                      " is not a multiple of heads = " + std::to_string(heads));
        int64_t dh = d / heads;
        if (dh % 2 != 0) throw bad("the head dimension " + std::to_string(dh) + " is odd");
        Shape lead(x.shape.begin(), x.shape.end() - 1);
        if (positions.shape != lead) throw bad("positions must be shaped " + shape_text(lead));
        int64_t half = dh / 2, rows = (int64_t)positions.numel();
        double base = nd.fv("base");
        Tensor out(DType::Float, x.shape);
        for (int64_t r = 0; r < rows; r++) {
            double pos = (double)positions.i[r];
            for (int64_t h = 0; h < heads; h++)
                for (int64_t i = 0; i < half; i++) {
                    double theta = pos * std::pow(base, -(2.0 * (double)i) / (double)dh);
                    double c = std::cos(theta), s = std::sin(theta);
                    size_t i1 = r * d + h * dh + i, i2 = i1 + half;
                    out.f[i1] = x.f[i1] * c - x.f[i2] * s;
                    out.f[i2] = x.f[i2] * c + x.f[i1] * s;
                }
        }
        return one(std::move(out));
    }
    throw bad("unknown operation");
}

Tensor Interpreter::attention(const Node &nd, Env &env)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': attention: " + what);
    };
    const Tensor &q = get(env, nd.s("q")), &k = get(env, nd.s("k")), &v = get(env, nd.s("v"));
    const Tensor *bias = nd.has("bias") ? &get(env, nd.s("bias")) : nullptr;
    int64_t heads = nd.iv("heads");
    if (q.rank() < 2 || k.rank() != q.rank() || v.rank() != q.rank())
        throw bad("q, k and v have one rank of at least 2");
    int64_t d = q.shape.back();
    if (d % heads != 0)
        throw bad("d = " + std::to_string(d) +
                  " is not a multiple of heads = " + std::to_string(heads));
    if (k.shape.back() != d || v.shape.back() != d)
        throw bad("q, k and v share their last dimension");
    if (k.shape[k.rank() - 2] != v.shape[v.rank() - 2])
        throw bad("k and v have the same number of keys");
    Shape lead(q.shape.begin(), q.shape.end() - 2), klead(k.shape.begin(), k.shape.end() - 2),
        vlead(v.shape.begin(), v.shape.end() - 2);
    if (lead != klead || lead != vlead) throw bad("q, k and v share their leading dimensions");
    int64_t dh = d / heads, tq = q.shape[q.rank() - 2], tk = k.shape[k.rank() - 2],
            B = numel_of(lead);
    double scale = nd.fval.count("scale") ? nd.fv("scale") : 1.0 / std::sqrt((double)dh);
    const std::string &mask = nd.s("mask");
    const Tensor *ids = nullptr, *ptr = nullptr, *keys = nullptr;
    bool causal = mask == "causal";
    std::vector<uint8_t> allowed_sets;
    if (mask == "segments") {
        ids = &get(env, nd.s("ids"));
        Shape want = lead;
        want.push_back(tq);
        if (ids->shape != want || tq != tk)
            throw bad("the mask's ids must be shaped " + shape_text(want) + " with Tq = Tk");
        causal = nd.bv("causal");
    } else if (mask == "key_sets") {
        ptr = &get(env, nd.s("ptr"));
        keys = &get(env, nd.s("keys"));
        if (!lead.empty()) throw bad("a key_sets mask takes unbatched q, k and v");
        if (ptr->rank() != 1 || ptr->shape[0] != tq + 1)
            throw bad("the mask's ptr must have " + std::to_string(tq + 1) + " entries");
        if (tq > 0 && (ptr->i[0] != 0 || !std::is_sorted(ptr->i.begin(), ptr->i.end())))
            throw bad("the mask's ptr must start at 0 and not decrease");
        int64_t total = tq > 0 ? ptr->i[tq] : 0;
        if (keys->rank() != 1 || keys->shape[0] != total)
            throw bad("the mask's keys must have " + std::to_string(total) +
                      " entries, ptr's last");
        check_index(*keys, tk, bad, "the mask's key");
        allowed_sets.assign((size_t)(tq * tk), 0);
        for (int64_t i = 0; i < tq; i++)
            for (int64_t e = ptr->i[i]; e < ptr->i[i + 1]; e++)
                allowed_sets[i * tk + keys->i[e]] = 1;
    } else if (mask == "causal") {
        if (tq != tk) throw bad("a causal mask needs Tq = Tk");
    }
    std::vector<int64_t> bias_strides;
    Shape score_shape = lead;
    score_shape.insert(score_shape.end(), {heads, tq, tk});
    if (bias) {
        Shape bshape;
        if (!broadcast_shapes(bias->shape, score_shape, bshape) || bshape != score_shape)
            throw bad("cannot broadcast the bias " + shape_text(bias->shape) + " to " +
                      shape_text(score_shape));
        bias_strides = broadcast_strides(bias->shape, score_shape);
    }
    std::vector<int64_t> score_strides = strides_of(score_shape);
    Tensor out(DType::Float, q.shape);
    std::vector<double> scores((size_t)tk), probs((size_t)tk);
    std::vector<int64_t> lead_strides = strides_of(lead);
    for (int64_t b = 0; b < B; b++) {
        // the leading multi-index of this batch element, for the bias offset
        int64_t bias_base = 0;
        if (bias) {
            int64_t rem = b;
            for (size_t l = 0; l < lead.size(); l++) {
                int64_t idx = lead_strides[l] == 0 ? 0 : rem / lead_strides[l];
                rem -= idx * lead_strides[l];
                bias_base += idx * bias_strides[l];
            }
        }
        for (int64_t h = 0; h < heads; h++)
            for (int64_t i = 0; i < tq; i++) {
                int64_t allowed_n = 0;
                double mx = -INF;
                for (int64_t j = 0; j < tk; j++) {
                    bool ok = true;
                    if (mask == "causal")
                        ok = j <= i;
                    else if (mask == "segments")
                        ok = ids->i[b * tq + j] == ids->i[b * tq + i] && (!causal || j <= i);
                    else if (mask == "key_sets")
                        ok = allowed_sets[i * tk + j] != 0;
                    if (!ok) {
                        scores[j] = -INF;
                        continue;
                    }
                    double s = 0.0;
                    const double *qi = q.f.data() + (b * tq + i) * d + h * dh,
                                 *kj = k.f.data() + (b * tk + j) * d + h * dh;
                    for (int64_t c = 0; c < dh; c++)
                        s += qi[c] * kj[c];
                    s *= scale;
                    if (bias) {
                        size_t L = lead.size();
                        s += bias->f[bias_base + h * bias_strides[L] + i * bias_strides[L + 1] +
                                     j * bias_strides[L + 2]];
                    }
                    scores[j] = s;
                    mx = std::max(mx, s);
                    allowed_n++;
                }
                double *oi = out.f.data() + (b * tq + i) * d + h * dh;
                if (allowed_n == 0) {
                    for (int64_t c = 0; c < dh; c++)
                        oi[c] = 0.0;
                    continue;
                }
                double sum = 0.0;
                for (int64_t j = 0; j < tk; j++) {
                    probs[j] = scores[j] == -INF ? 0.0 : std::exp(scores[j] - mx);
                    sum += probs[j];
                }
                for (int64_t c = 0; c < dh; c++)
                    oi[c] = 0.0;
                for (int64_t j = 0; j < tk; j++) {
                    if (probs[j] == 0.0) continue;
                    double p = probs[j] / sum;
                    const double *vj = v.f.data() + (b * tk + j) * d + h * dh;
                    for (int64_t c = 0; c < dh; c++)
                        oi[c] += p * vj[c];
                }
            }
    }
    (void)score_strides;
    return out;
}

Interpreter::Value Interpreter::call(const Plan &plan, const Node &nd, Env &env,
                                     const std::string &prefix, const std::set<std::string> &wanted)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': call: " + what);
    };
    const Plan *module = plan.find_module(nd.s("module"));
    std::map<std::string, TensorPtr> bound;
    for (const auto &kv : nd.dict) {
        auto [head, sub] = split_operand(kv.second);
        const Value &val = env.at(head);
        TensorPtr t =
            val.many ? (sub.empty() ? val.several.begin()->second : val.several.at(sub)) : val.one;
        if (val.many && sub.empty() && val.several.size() != 1) get(env, kv.second);
        const InputSpec &spec = module->inputs.at(kv.first);
        if (t->rank() != spec.rank)
            throw bad("input '" + kv.first + "' has rank " + std::to_string(t->rank()) +
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
    std::map<std::string, TensorPtr> values =
        eval(*module, bound, prefix + nd.s("prefix") + ".", operands);
    Value result;
    result.many = true;
    for (size_t k = 0; k < outputs.size(); k++)
        result.several[outputs[k]] = values.at(operands[k]);
    return result;
}

Interpreter::Value Interpreter::loop(const Node &nd, Env &env, const std::string &prefix)
{
    Bad bad = [&](const std::string &what) {
        return Error(fn_ + ": node '" + nd.name + "': loop: " + what);
    };
    const Plan &body = *nd.body;
    std::map<std::string, TensorPtr> carried, fixed;
    auto fetch = [&](const std::string &operand) {
        auto [head, sub] = split_operand(operand);
        const Value &val = env.at(head);
        if (val.many && sub.empty() && val.several.size() != 1) get(env, operand);
        return val.many ? (sub.empty() ? val.several.begin()->second : val.several.at(sub))
                        : val.one;
    };
    for (const auto &kv : nd.dict)
        carried[kv.first] = fetch(kv.second);
    for (const auto &kv : nd.dict2)
        fixed[kv.first] = fetch(kv.second);
    for (const auto *m : {&carried, &fixed})
        for (const auto &kv : *m)
            if (kv.second->rank() != body.inputs.at(kv.first).rank)
                throw bad("input '" + kv.first + "' has rank " + std::to_string(kv.second->rank()) +
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
        std::map<std::string, TensorPtr> bound = fixed;
        for (const auto &kv : carried)
            bound[kv.first] = kv.second;
        if (nd.has("step")) bound[nd.s("step")] = std::make_shared<Tensor>(Tensor::scalar_int(i));
        std::map<std::string, TensorPtr> values = eval(body, bound, prefix, operands);
        for (auto &kv : carried) {
            TensorPtr t = values.at(*body.output(kv.first));
            if (t->rank() != body.inputs.at(kv.first).rank)
                throw bad("the body answers '" + kv.first + "' with rank " +
                          std::to_string(t->rank()) + " but declares rank " +
                          std::to_string(body.inputs.at(kv.first).rank));
            kv.second = t;
        }
        if (stop_operand) {
            const Tensor &stop = *values.at(*stop_operand);
            if (stop.rank() != 0)
                throw bad("the stop output '" + nd.s("until_output") + "' must have rank 0");
            if (stop.b[0]) break;
        }
    }
    Value result;
    result.many = true;
    result.several = carried;
    return result;
}

// ============================================================================
// Preparation and initialisation
// ============================================================================

std::map<std::string, TensorPtr> prepare_weights(const Plan &plan,
                                                 const std::map<std::string, TensorPtr> &weights,
                                                 const std::string &fn)
{
    std::map<std::string, ParamSpec> specs;
    collect_weights(plan, fn, "", specs);
    std::map<std::string, TensorPtr> prepared;
    for (const auto &kv : specs) {
        auto it = weights.find(kv.first);
        if (it == weights.end())
            throw Error(fn + ": the weights have no parameter '" + kv.first + "'");
        if (it->second->shape != kv.second.shape)
            throw Error(fn + ": parameter '" + kv.first + "' has shape " +
                        shape_text(it->second->shape) + " but the network declares " +
                        shape_text(kv.second.shape));
        prepared[kv.first] = it->second;
    }
    return prepared;
}

Tensor init_tensor(const ParamSpec &spec, Rng &rng, const std::string &fn)
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
    Tensor t(DType::Float, shape);
    const std::string &kind = spec.init;
    auto fill_uniform = [&](double bound) {
        for (double &v : t.f)
            v = (rng.uniform() * 2.0 - 1.0) * bound;
    };
    auto fill_normal = [&](double std) {
        for (double &v : t.f)
            v = rng.normal() * std;
    };
    if (kind == "zeros") return t;
    if (kind == "ones")
        std::fill(t.f.begin(), t.f.end(), 1.0);
    else if (kind == "constant")
        std::fill(t.f.begin(), t.f.end(), spec.init_arg);
    else if (kind == "normal")
        fill_normal(spec.init_arg);
    else if (kind == "uniform")
        fill_uniform(spec.init_arg);
    else if (kind == "xavier_uniform")
        fill_uniform(std::sqrt(6.0 / (double)(fan_in + fan_out)));
    else if (kind == "xavier_normal")
        fill_normal(std::sqrt(2.0 / (double)(fan_in + fan_out)));
    else if (kind == "kaiming_uniform")
        fill_uniform(std::sqrt(6.0 / (double)fan_in));
    else if (kind == "kaiming_normal")
        fill_normal(std::sqrt(2.0 / (double)fan_in));
    else
        throw Error(fn + ": unknown initialisation '" + kind + "'");
    return t;
}

} // namespace east_ds::nn
