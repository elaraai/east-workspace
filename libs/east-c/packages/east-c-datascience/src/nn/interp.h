/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The CPU interpreter of a network plan (docs/neural-networks.md §4): every
 * operation in IEEE double, forward only. The twin of east_py_datascience's
 * torch interpreter, held to the same answers by the compliance suite. */
#ifndef EAST_DATASCIENCE_NN_INTERP_H
#define EAST_DATASCIENCE_NN_INTERP_H

#include "plan.h"
#include "tensor.h"

#include <map>
#include <memory>
#include <random>
#include <string>
#include <vector>

namespace east_ds::nn
{

using TensorPtr = std::shared_ptr<const Tensor>;

/* The interpreter's generator: uniform on [0, 1) and standard normal draws,
 * the same on every platform for a seed. */
class Rng
{
  public:
    explicit Rng(uint64_t seed) : gen_(seed) {}
    double uniform()
    {
        return (double)(gen_() >> 11) * 0x1.0p-53;
    }
    double normal();

  private:
    std::mt19937_64 gen_;
    bool has_spare_ = false;
    double spare_ = 0.0;
};

class Interpreter
{
  public:
    Interpreter(std::string fn, bool training, uint64_t seed)
        : fn_(std::move(fn)), training_(training), rng_(seed)
    {
    }

    /* The tensors the operands name, given the batch's inputs (checked against
     * the plan) and the prepared weights (checked by `prepare_weights`). */
    std::map<std::string, TensorPtr> run(const Plan &plan,
                                         const std::map<std::string, TensorPtr> &weights,
                                         const std::map<std::string, TensorPtr> &inputs,
                                         const std::vector<std::string> &operands);

    struct Value {
        bool many = false;
        TensorPtr one;
        std::map<std::string, TensorPtr> several;
    };
    using Env = std::map<std::string, Value>;

  private:
    std::map<std::string, TensorPtr> eval(const Plan &plan,
                                          const std::map<std::string, TensorPtr> &bound,
                                          const std::string &prefix,
                                          const std::vector<std::string> &operands);
    const Tensor &get(const Env &env, const std::string &operand);
    Value node(const Plan &plan, const Node &node, Env &env, const std::string &prefix,
               const std::set<std::string> &wanted);
    Value call(const Plan &plan, const Node &node, Env &env, const std::string &prefix,
               const std::set<std::string> &wanted);
    Value loop(const Node &node, Env &env, const std::string &prefix);
    Tensor attention(const Node &node, Env &env);

    std::string fn_;
    bool training_;
    Rng rng_;
    const std::map<std::string, TensorPtr> *weights_ = nullptr;
};

/* Every weight the plan reaches, checked against its parameter's shape (§6). */
std::map<std::string, TensorPtr> prepare_weights(const Plan &plan,
                                                 const std::map<std::string, TensorPtr> &weights,
                                                 const std::string &fn);

/* The initial value of a parameter (§5, nn_init). */
Tensor init_tensor(const ParamSpec &spec, Rng &rng, const std::string &fn);

} // namespace east_ds::nn

#endif
