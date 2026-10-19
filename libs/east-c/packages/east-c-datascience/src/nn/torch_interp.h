/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
/* The interpreter of a network plan on libtorch (docs/neural-networks.md §4,
 * §5): the same ATen kernels the python interpreter runs on, CPU or CUDA by
 * the build linked, with autograd for training. The twin of
 * east_py_datascience/nn/_torch.py and nn_impl.py's trainer. */
#ifndef EAST_DATASCIENCE_NN_TORCH_INTERP_H
#define EAST_DATASCIENCE_NN_TORCH_INTERP_H

#include "plan.h"

#include <torch/torch.h>

#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace east_ds::nn
{

using Tensors = std::map<std::string, torch::Tensor>;

/* float / integer / boolean of a tensor's scalar type. */
DType dtype_of_tensor(const torch::Tensor &t);
torch::ScalarType scalar_type_of(DType d);

class Interpreter
{
  public:
    Interpreter(std::string fn, torch::Device device, bool training, uint64_t seed);

    /* The tensors the operands name, given the batch's inputs (checked against
     * the plan) and the prepared weights. */
    Tensors run(const Plan &plan, const Tensors &weights, const Tensors &inputs,
                const std::vector<std::string> &operands);

    struct Value {
        bool many = false;
        torch::Tensor one;
        Tensors several;
    };
    using Env = std::map<std::string, Value>;

  private:
    Tensors eval(const Plan &plan, const Tensors &bound, const std::string &prefix,
                 const std::vector<std::string> &operands);
    torch::Tensor get(const Env &env, const std::string &operand);
    Value node(const Plan &plan, const Node &node, Env &env, const std::string &prefix,
               const std::set<std::string> &wanted);
    Value call(const Plan &plan, const Node &node, Env &env, const std::string &prefix,
               const std::set<std::string> &wanted);
    Value loop(const Node &node, Env &env, const std::string &prefix);
    torch::Tensor attention(const Node &node, Env &env);
    /* A draw shaped `shape` on the device: standard normal or uniform on [0, 1),
     * from the interpreter's seeded CPU generator. */
    torch::Tensor random(const std::vector<int64_t> &shape, bool normal);

    std::string fn_;
    torch::Device device_;
    bool training_;
    torch::Generator generator_;
    const Tensors *weights_ = nullptr;
};

/* Every weight the plan reaches, moved to `device` as f32 and checked against
 * its parameter's shape (§6); `trainable` makes the trainable ones leaves
 * requiring a gradient. */
Tensors prepare_weights(const Plan &plan, const Tensors &weights, torch::Device device,
                        const std::string &fn, bool trainable);

/* The initial value of a parameter (§5, nn_init): f64 on the CPU, drawn from
 * `generator` as the python runner draws it. */
torch::Tensor init_tensor(const ParamSpec &spec, torch::Generator &generator,
                          const std::string &fn);

struct TrainConfig {
    std::string loss;
    std::optional<std::string> validation;
    double lr = 1e-3, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, weight_decay = 0.0;
    std::string schedule = "constant";
    int64_t warmup_steps = 0;
    double min_lr = 0.0;
    std::optional<double> clip_norm, ema_decay;
    int64_t epochs = 1;
    std::optional<int64_t> patience;
    bool bf16 = false;
    uint64_t seed = 0;
    torch::Device device = torch::kCPU;
    std::set<std::string> recompute;
};

struct HistoryEntry {
    int64_t epoch;
    double loss;
    std::optional<double> validation;
    double learning_rate;
};

struct TrainResult {
    Tensors weights; /* the best epoch's, f64 on the CPU */
    std::vector<HistoryEntry> history;
    int64_t best_epoch = 0;
};

/* nn_train (§5): AdamW over the trainable weights under the schedule, with
 * clipping, an EMA and early stopping as configured. */
TrainResult train(const Plan &plan, const Tensors &weights, const std::vector<Tensors> &batches,
                  const std::vector<Tensors> &validation, const TrainConfig &config,
                  const std::string &fn);

} // namespace east_ds::nn

#endif
