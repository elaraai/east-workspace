/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The element types and shapes a network's plan speaks of
 * (docs/neural-networks.md §1–§2). */
#ifndef EAST_DATASCIENCE_NN_DTYPE_H
#define EAST_DATASCIENCE_NN_DTYPE_H

#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>

namespace east_ds::nn
{

enum class DType { Float, Float64, Integer, Boolean };

inline const char *dtype_name(DType d)
{
    switch (d) {
    case DType::Float:
        return "float";
    case DType::Float64:
        return "float64";
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
    if (s == "float64") return DType::Float64;
    if (s == "integer") return DType::Integer;
    if (s == "boolean") return DType::Boolean;
    throw std::runtime_error("unknown element type '" + s + "'");
}

/* The two float kinds (§2): `float` is f32 in flight, `float64` f64 throughout. */
inline bool is_float_kind(DType d)
{
    return d == DType::Float || d == DType::Float64;
}

/* What two float kinds promote to: float64 when either is. */
inline DType wider(DType a, DType b)
{
    return (a == DType::Float64 || b == DType::Float64) ? DType::Float64 : DType::Float;
}

using Shape = std::vector<int64_t>;

inline std::string shape_text(const Shape &shape)
{
    std::string s = "[";
    for (size_t i = 0; i < shape.size(); i++) {
        if (i) s += ", ";
        s += std::to_string(shape[i]);
    }
    return s + "]";
}

} // namespace east_ds::nn

#endif
