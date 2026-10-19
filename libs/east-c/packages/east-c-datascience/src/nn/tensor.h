/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* A dense tensor of one element type, row-major, as the neural-network
 * interpreter computes on it (docs/neural-networks.md §1–§3): doubles for
 * `float`, 64-bit integers for `integer`, bytes for `boolean`. */
#ifndef EAST_DATASCIENCE_NN_TENSOR_H
#define EAST_DATASCIENCE_NN_TENSOR_H

#include <cstdint>
#include <numeric>
#include <stdexcept>
#include <string>
#include <vector>

namespace east_ds::nn
{

enum class DType { Float, Integer, Boolean };

inline const char *dtype_name(DType d)
{
    switch (d) {
    case DType::Float:
        return "float";
    case DType::Integer:
        return "integer";
    case DType::Boolean:
        return "boolean";
    }
    return "float";
}

inline DType dtype_of_name(const std::string &s)
{
    if (s == "float") return DType::Float;
    if (s == "integer") return DType::Integer;
    if (s == "boolean") return DType::Boolean;
    throw std::runtime_error("unknown element type '" + s + "'");
}

using Shape = std::vector<int64_t>;

inline int64_t numel_of(const Shape &shape)
{
    int64_t n = 1;
    for (int64_t d : shape)
        n *= d;
    return n;
}

inline std::string shape_text(const Shape &shape)
{
    std::string s = "[";
    for (size_t i = 0; i < shape.size(); i++) {
        if (i) s += ", ";
        s += std::to_string(shape[i]);
    }
    return s + "]";
}

/* Row-major strides, in elements. */
inline std::vector<int64_t> strides_of(const Shape &shape)
{
    std::vector<int64_t> st(shape.size(), 1);
    for (size_t i = shape.size(); i-- > 1;)
        st[i - 1] = st[i] * shape[i];
    return st;
}

struct Tensor {
    DType dtype = DType::Float;
    Shape shape;
    std::vector<double> f;
    std::vector<int64_t> i;
    std::vector<uint8_t> b;

    Tensor() = default;
    Tensor(DType d, Shape s) : dtype(d), shape(std::move(s))
    {
        size_t n = (size_t)numel_of(shape);
        switch (dtype) {
        case DType::Float:
            f.assign(n, 0.0);
            break;
        case DType::Integer:
            i.assign(n, 0);
            break;
        case DType::Boolean:
            b.assign(n, 0);
            break;
        }
    }
    static Tensor scalar(double v)
    {
        Tensor t(DType::Float, {});
        t.f[0] = v;
        return t;
    }
    static Tensor scalar_int(int64_t v)
    {
        Tensor t(DType::Integer, {});
        t.i[0] = v;
        return t;
    }
    static Tensor scalar_bool(bool v)
    {
        Tensor t(DType::Boolean, {});
        t.b[0] = v ? 1 : 0;
        return t;
    }
    size_t numel() const
    {
        return (size_t)numel_of(shape);
    }
    int rank() const
    {
        return (int)shape.size();
    }
    /* Element `k` as a double, whatever the type (booleans 0/1). */
    double as_double(size_t k) const
    {
        switch (dtype) {
        case DType::Float:
            return f[k];
        case DType::Integer:
            return (double)i[k];
        case DType::Boolean:
            return b[k] ? 1.0 : 0.0;
        }
        return 0.0;
    }
    int64_t as_int(size_t k) const
    {
        switch (dtype) {
        case DType::Float:
            return (int64_t)f[k];
        case DType::Integer:
            return i[k];
        case DType::Boolean:
            return b[k] ? 1 : 0;
        }
        return 0;
    }
    /* Copies element `src` of `from` into element `dst` of this (same dtype). */
    void copy_from(size_t dst, const Tensor &from, size_t src)
    {
        switch (dtype) {
        case DType::Float:
            f[dst] = from.f[src];
            break;
        case DType::Integer:
            i[dst] = from.i[src];
            break;
        case DType::Boolean:
            b[dst] = from.b[src];
            break;
        }
    }
};

/* The shape two tensors broadcast to (numpy's rules), or an empty optional. */
inline bool broadcast_shapes(const Shape &a, const Shape &b, Shape &out)
{
    size_t n = std::max(a.size(), b.size());
    out.assign(n, 1);
    for (size_t k = 0; k < n; k++) {
        int64_t da = k < n - a.size() ? 1 : a[k - (n - a.size())];
        int64_t db = k < n - b.size() ? 1 : b[k - (n - b.size())];
        if (da == db || db == 1)
            out[k] = da;
        else if (da == 1)
            out[k] = db;
        else
            return false;
    }
    return true;
}

/* Strides of `shape` as seen from `target` (aligned from the right, 0 where
 * the dimension is 1 and target's is not): the offsets a broadcast walk adds. */
inline std::vector<int64_t> broadcast_strides(const Shape &shape, const Shape &target)
{
    std::vector<int64_t> own = strides_of(shape);
    std::vector<int64_t> st(target.size(), 0);
    size_t off = target.size() - shape.size();
    for (size_t k = 0; k < shape.size(); k++)
        st[off + k] = shape[k] == 1 ? 0 : own[k];
    return st;
}

/* Walks every position of `shape` in row-major order, keeping each operand's
 * flat offset by its broadcast strides. */
class Walker
{
  public:
    Walker(const Shape &shape, std::vector<std::vector<int64_t> > strides)
        : shape_(shape), strides_(std::move(strides)), index_(shape.size(), 0),
          offsets_(strides_.size(), 0), total_(numel_of(shape))
    {
    }
    bool done() const
    {
        return pos_ >= total_;
    }
    int64_t offset(size_t operand) const
    {
        return offsets_[operand];
    }
    void next()
    {
        pos_++;
        for (size_t k = shape_.size(); k-- > 0;) {
            index_[k]++;
            for (size_t o = 0; o < strides_.size(); o++)
                offsets_[o] += strides_[o][k];
            if (index_[k] < shape_[k]) return;
            for (size_t o = 0; o < strides_.size(); o++)
                offsets_[o] -= strides_[o][k] * shape_[k];
            index_[k] = 0;
        }
    }

  private:
    Shape shape_;
    std::vector<std::vector<int64_t> > strides_;
    std::vector<int64_t> index_;
    std::vector<int64_t> offsets_;
    int64_t total_;
    int64_t pos_ = 0;
};

} // namespace east_ds::nn

#endif
