/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* A network's plan: a NetType value resolved and checked before anything runs
 * (docs/neural-networks.md §1–§2), every operand resolved, every node's
 * element type inferred, refusing what the specification refuses with its
 * wording. The twin of east_py_datascience/nn/_plan.py. */
#ifndef EAST_DATASCIENCE_NN_PLAN_H
#define EAST_DATASCIENCE_NN_PLAN_H

#include "dtype.h"

#include <east/values.h>

#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace east_ds::nn
{

struct InputSpec {
    DType dtype = DType::Float;
    int64_t rank = 0;
};

struct ParamSpec {
    Shape shape;
    std::string init;
    double init_arg = 0.0;
    bool trainable = true;
    bool operator==(const ParamSpec &o) const
    {
        return shape == o.shape && init == o.init && init_arg == o.init_arg &&
               trainable == o.trainable;
    }
    bool operator!=(const ParamSpec &o) const
    {
        return !(*this == o);
    }
};

struct Plan;

/* A node: its operation and fields, by kind. Operands and other strings in
 * `str` (an option's field present only when `some`); `list` the operands of
 * concat and einsum; `dict` a call's inputs or a loop's carried values, `dict2`
 * a loop's fixed inputs; `ints` a shape, axes or sizes; `ival`, `fval`, `bval`
 * the scalar fields by name; `body` a loop's network. */
struct Node {
    std::string name;
    std::string op;
    std::map<std::string, std::string> str;
    std::vector<std::string> list;
    std::map<std::string, std::string> dict;
    std::map<std::string, std::string> dict2;
    std::vector<int64_t> ints;
    std::map<std::string, int64_t> ival;
    std::map<std::string, double> fval;
    std::map<std::string, bool> bval;
    std::shared_ptr<Plan> body;
    /* Inferred: one element type, or (for a call or a loop) one per tensor. */
    bool many = false;
    DType dtype = DType::Float;
    std::map<std::string, DType> dtypes;

    bool has(const std::string &k) const
    {
        return str.count(k) > 0;
    }
    const std::string &s(const std::string &k) const
    {
        return str.at(k);
    }
    int64_t iv(const std::string &k) const
    {
        return ival.at(k);
    }
    double fv(const std::string &k) const
    {
        return fval.at(k);
    }
    bool bv(const std::string &k) const
    {
        return bval.at(k);
    }
};

struct Plan {
    std::map<std::string, InputSpec> inputs;
    std::map<std::string, ParamSpec> params;
    std::map<std::string, std::shared_ptr<Plan> > modules;
    std::vector<Node> nodes;
    std::map<std::string, size_t> index;
    std::vector<std::pair<std::string, std::string> > outputs;
    const Plan *parent = nullptr;

    const Plan *find_module(const std::string &name) const;
    const std::string *output(const std::string &name) const;
};

/* The plan of a NetType value (its Recursive wrapper already transparent at
 * the value level); throws east_ds::Error as §6 words it. */
std::shared_ptr<Plan> build_plan(EastValue *net, const std::string &fn);

/* "node.out" → ("node", "out"); a bare name → (name, ""). */
std::pair<std::string, std::string> split_operand(const std::string &operand);

/* Every operand a node names, in field order. */
std::vector<std::string> operands_of(const Node &node);

/* The element type an operand holds, or the one tensor of a many-tensor node. */
DType dtype_of(const Plan &plan, const std::string &operand, const std::string &fn);

/* Every weight the network reaches, by name (§1). */
void collect_weights(const Plan &plan, const std::string &fn, const std::string &prefix,
                     std::map<std::string, ParamSpec> &into);

/* The nodes the operands depend on, in the plan's order, and which tensors of
 * each many-tensor node they demand ("" for its bare one). */
std::vector<const Node *> needed_nodes(const Plan &plan, const std::vector<std::string> &operands,
                                       std::map<std::string, std::set<std::string> > *wanted);

} // namespace east_ds::nn

#endif
