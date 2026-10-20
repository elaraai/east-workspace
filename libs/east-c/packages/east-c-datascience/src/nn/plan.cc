/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */
#include "plan.h"

#include "../value_util.h"

#include <algorithm>
#include <cstring>

namespace east_ds::nn
{

namespace
{

const char *FN_PLACEHOLDER = "nn";

Error err(const std::string &fn, const std::string &what)
{
    return Error(fn + ": " + what);
}

Error node_err(const std::string &fn, const Node &node, const std::string &what)
{
    return Error(fn + ": node '" + node.name + "': " + node.op + ": " + what);
}

/* How a payload field is read. */
enum Kind {
    K_NAME,
    K_OPT_NAME,
    K_NAME_LIST,
    K_NAME_DICT,
    K_NAME_DICT2,
    K_INT,
    K_OPT_INT,
    K_INT_LIST,
    K_FLOAT,
    K_OPT_FLOAT,
    K_BOOL,
    K_STR,
    K_OPT_STR,
};

struct Field {
    const char *name;
    Kind kind;
};

std::string str_of(EastValue *v, const char *fn)
{
    return std::string(as_string(v, fn));
}

void read_dict(EastValue *d, std::map<std::string, std::string> &into, const char *fn)
{
    size_t n = east_dict_len(d);
    for (size_t i = 0; i < n; i++)
        into[str_of(east_dict_key_at(d, i), fn)] = str_of(east_dict_val_at(d, i), fn);
}

void read_fields(Node &node, EastValue *p, const std::vector<Field> &fields, const char *fn)
{
    for (const Field &f : fields) {
        EastValue *v = field(p, f.name, fn);
        switch (f.kind) {
        case K_NAME:
        case K_STR:
            node.str[f.name] = str_of(v, fn);
            break;
        case K_OPT_NAME:
        case K_OPT_STR:
            if (EastValue *inner = some_value(v, fn)) node.str[f.name] = str_of(inner, fn);
            break;
        case K_NAME_LIST:
            node.list = strings(v, fn);
            break;
        case K_NAME_DICT:
            read_dict(v, node.dict, fn);
            break;
        case K_NAME_DICT2:
            read_dict(v, node.dict2, fn);
            break;
        case K_INT:
            node.ival[f.name] = as_integer(v, fn);
            break;
        case K_OPT_INT:
            if (EastValue *inner = some_value(v, fn)) node.ival[f.name] = as_integer(inner, fn);
            break;
        case K_INT_LIST:
            node.ints = integers(v, fn);
            break;
        case K_FLOAT:
            node.fval[f.name] = as_float(v, fn);
            break;
        case K_OPT_FLOAT:
            if (EastValue *inner = some_value(v, fn)) node.fval[f.name] = as_float(inner, fn);
            break;
        case K_BOOL:
            node.bval[f.name] = as_boolean(v, fn);
            break;
        }
    }
}

const std::set<std::string> BINARY = {"add",       "sub", "mul",         "div",       "pow",
                                      "remainder", "eq",  "ne",          "lt",        "le",
                                      "gt",        "ge",  "logical_and", "logical_or"};
const std::set<std::string> UNARY = {
    "neg",      "abs",         "floor",        "ceil",           "round",
    "exp",      "log",         "log1p",        "sqrt",           "softplus",
    "sigmoid",  "tanh",        "relu",         "silu",           "sin",
    "cos",      "is_nan",      "normal_cdf",   "log_normal_cdf", "normal_quantile",
    "log1mexp", "logical_not", "stop_gradient"};
const std::set<std::string> FLOAT_UNARY = {"floor",
                                           "ceil",
                                           "round",
                                           "exp",
                                           "log",
                                           "log1p",
                                           "sqrt",
                                           "softplus",
                                           "sigmoid",
                                           "tanh",
                                           "relu",
                                           "gelu",
                                           "silu",
                                           "clamp",
                                           "sin",
                                           "cos",
                                           "nan_to_num",
                                           "normal_cdf",
                                           "log_normal_cdf",
                                           "normal_quantile",
                                           "log1mexp"};
const std::set<std::string> AXIS_OPS = {"sum",       "mean",    "max",         "min",
                                        "logsumexp", "softmax", "log_softmax", "cumsum",
                                        "cummax",    "cummin",  "argmax"};

std::shared_ptr<Plan> build(EastValue *data, const std::string &fn, const Plan *parent);

Node parse_node(EastValue *entry, const std::string &fn_s, const Plan *parent)
{
    const char *fn = fn_s.c_str();
    Node node;
    node.name = str_of(field(entry, "name", fn), fn);
    EastValue *op = field(entry, "op", fn);
    node.op = case_of(op, fn);
    EastValue *p = payload(op);
    const std::string &o = node.op;
    if (o == "gather")
        read_fields(node, p, {{"table", K_NAME}, {"index", K_NAME}}, fn);
    else if (o == "take_along")
        read_fields(node, p, {{"x", K_NAME}, {"index", K_NAME}, {"axis", K_INT}}, fn);
    else if (o == "mask_select")
        read_fields(node, p, {{"x", K_NAME}, {"mask", K_NAME}}, fn);
    else if (o == "mask_indices")
        read_fields(node, p, {{"mask", K_NAME}}, fn);
    else if (o == "repeat")
        read_fields(node, p, {{"x", K_NAME}, {"counts", K_NAME}}, fn);
    else if (o == "range")
        read_fields(node, p, {{"start", K_INT}, {"stop", K_NAME}, {"step", K_INT}}, fn);
    else if (o == "searchsorted")
        read_fields(node, p, {{"sorted", K_NAME}, {"values", K_NAME}, {"right", K_BOOL}}, fn);
    else if (o == "embedding_bag")
        read_fields(node, p,
                    {{"table", K_NAME},
                     {"index", K_NAME},
                     {"weights", K_OPT_NAME},
                     {"segments", K_NAME},
                     {"size", K_NAME}},
                    fn);
    else if (o == "segment_reduce") {
        read_fields(node, p, {{"x", K_NAME}, {"segments", K_NAME}, {"size", K_NAME}}, fn);
        node.str["reduce"] = case_of(field(p, "reduce", fn), fn);
    } else if (o == "segment_softmax" || o == "segment_log_softmax")
        read_fields(node, p, {{"x", K_NAME}, {"segments", K_NAME}}, fn);
    else if (o == "scatter_add")
        read_fields(node, p, {{"x", K_NAME}, {"index", K_NAME}, {"size", K_NAME}}, fn);
    else if (o == "concat")
        read_fields(node, p, {{"inputs", K_NAME_LIST}, {"axis", K_INT}}, fn);
    else if (o == "split")
        read_fields(node, p,
                    {{"x", K_NAME}, {"axis", K_INT}, {"sizes", K_INT_LIST}, {"part", K_INT}}, fn);
    else if (o == "slice")
        read_fields(node, p,
                    {{"x", K_NAME}, {"axis", K_INT}, {"start", K_INT}, {"stop", K_OPT_INT}}, fn);
    else if (o == "pad") {
        read_fields(node, p, {{"x", K_NAME}, {"axis", K_INT}, {"before", K_INT}, {"after", K_INT}},
                    fn);
        node.str["mode"] = case_of(field(p, "mode", fn), fn);
    } else if (o == "reshape")
        read_fields(node, p, {{"x", K_NAME}, {"shape", K_INT_LIST}}, fn);
    else if (o == "permute")
        read_fields(node, p, {{"x", K_NAME}, {"axes", K_INT_LIST}}, fn);
    else if (o == "broadcast")
        read_fields(node, p, {{"x", K_NAME}, {"like", K_NAME}}, fn);
    else if (o == "where")
        read_fields(node, p, {{"cond", K_NAME}, {"a", K_NAME}, {"b", K_NAME}}, fn);
    else if (o == "constant") {
        EastValue *value = field(p, "value", fn);
        std::string tag = case_of(value, fn);
        node.str["value"] = tag;
        if (tag == "float" || tag == "float64")
            node.fval["value"] = as_float(payload(value), fn);
        else if (tag == "integer")
            node.ival["value"] = as_integer(payload(value), fn);
        else
            node.bval["value"] = as_boolean(payload(value), fn);
    } else if (o == "cast") {
        read_fields(node, p, {{"x", K_NAME}}, fn);
        node.str["dtype"] = case_of(field(p, "dtype", fn), fn);
    } else if (o == "linear")
        read_fields(node, p, {{"x", K_NAME}, {"weight", K_NAME}, {"bias", K_OPT_NAME}}, fn);
    else if (o == "einsum")
        read_fields(node, p, {{"subscripts", K_STR}, {"inputs", K_NAME_LIST}}, fn);
    else if (o == "conv1d")
        read_fields(node, p,
                    {{"x", K_NAME},
                     {"weight", K_NAME},
                     {"bias", K_OPT_NAME},
                     {"stride", K_INT},
                     {"dilation", K_INT},
                     {"groups", K_INT}},
                    fn);
    else if (o == "avg_pool1d")
        read_fields(node, p, {{"x", K_NAME}, {"kernel", K_INT}, {"stride", K_INT}}, fn);
    else if (o == "upsample_nearest")
        read_fields(node, p, {{"x", K_NAME}, {"scale", K_INT}}, fn);
    else if (o == "layer_norm")
        read_fields(node, p,
                    {{"x", K_NAME}, {"weight", K_OPT_NAME}, {"bias", K_OPT_NAME}, {"eps", K_FLOAT}},
                    fn);
    else if (o == "group_norm")
        read_fields(node, p,
                    {{"x", K_NAME},
                     {"groups", K_INT},
                     {"weight", K_OPT_NAME},
                     {"bias", K_OPT_NAME},
                     {"eps", K_FLOAT}},
                    fn);
    else if (BINARY.count(o))
        read_fields(node, p, {{"a", K_NAME}, {"b", K_NAME}}, fn);
    else if (UNARY.count(o))
        read_fields(node, p, {{"x", K_NAME}}, fn);
    else if (o == "gelu") {
        read_fields(node, p, {{"x", K_NAME}}, fn);
        node.str["approximate"] = case_of(field(p, "approximate", fn), fn);
    } else if (o == "clamp")
        read_fields(node, p, {{"x", K_NAME}, {"min", K_OPT_FLOAT}, {"max", K_OPT_FLOAT}}, fn);
    else if (o == "nan_to_num")
        read_fields(node, p,
                    {{"x", K_NAME}, {"nan", K_FLOAT}, {"posinf", K_FLOAT}, {"neginf", K_FLOAT}},
                    fn);
    else if (AXIS_OPS.count(o))
        read_fields(node, p, {{"x", K_NAME}, {"axis", K_INT}}, fn);
    else if (o == "attention") {
        read_fields(node, p,
                    {{"q", K_NAME},
                     {"k", K_NAME},
                     {"v", K_NAME},
                     {"heads", K_INT},
                     {"bias", K_OPT_NAME},
                     {"scale", K_OPT_FLOAT}},
                    fn);
        EastValue *mask = field(p, "mask", fn);
        std::string tag = case_of(mask, fn);
        node.str["mask"] = tag;
        if (tag == "segments") {
            node.str["ids"] = str_of(field(payload(mask), "ids", fn), fn);
            node.bval["causal"] = as_boolean(field(payload(mask), "causal", fn), fn);
        } else if (tag == "key_sets") {
            node.str["ptr"] = str_of(field(payload(mask), "ptr", fn), fn);
            node.str["keys"] = str_of(field(payload(mask), "keys", fn), fn);
        }
    } else if (o == "rotary") {
        read_fields(node, p,
                    {{"x", K_NAME}, {"positions", K_NAME}, {"heads", K_INT}, {"base", K_FLOAT}},
                    fn);
        node.str["convention"] = case_of(field(p, "convention", fn), fn);
    } else if (o == "dropout")
        read_fields(node, p, {{"x", K_NAME}, {"p", K_FLOAT}}, fn);
    else if (o == "random_normal" || o == "random_uniform")
        read_fields(node, p, {{"like", K_NAME}}, fn);
    else if (o == "call")
        read_fields(node, p, {{"module", K_STR}, {"prefix", K_STR}, {"inputs", K_NAME_DICT}}, fn);
    else if (o == "loop") {
        read_fields(node, p,
                    {{"carried", K_NAME_DICT}, {"inputs", K_NAME_DICT2}, {"step", K_OPT_STR}}, fn);
        node.body = build(field(p, "body", fn), fn_s, parent);
        EastValue *steps = field(p, "steps", fn);
        std::string tag = case_of(steps, fn);
        node.str["steps"] = tag;
        if (tag == "fixed")
            node.ival["fixed"] = as_integer(payload(steps), fn);
        else {
            node.str["until_output"] = str_of(field(payload(steps), "output", fn), fn);
            node.ival["max"] = as_integer(field(payload(steps), "max", fn), fn);
        }
    } else
        throw Error(fn_s + ": node '" + node.name + "': unknown operation '" + o + "'");
    return node;
}

void check_name(const std::string &name, const std::string &fn)
{
    if (name.empty() || name.find('.') != std::string::npos)
        throw err(fn, "'" + name + "' is not a valid name: names are non-empty and hold no '.'");
}

void resolve(const Plan &plan, const std::string &operand, const std::string &fn,
             const std::string *node_name, const std::set<std::string> &later)
{
    std::string head = split_operand(operand).first;
    std::string where = node_name ? "node '" + *node_name + "'" : std::string("an output");
    if (plan.inputs.count(head) || plan.params.count(head) || plan.index.count(head)) return;
    if (later.count(head)) throw err(fn, where + " uses '" + operand + "' before it is defined");
    throw err(fn, where + " names an unknown operand '" + operand + "'");
}

std::string list_text(const std::vector<std::string> &xs)
{
    std::string s = "[";
    for (size_t i = 0; i < xs.size(); i++) {
        if (i) s += ", ";
        s += "'" + xs[i] + "'";
    }
    return s + "]";
}

void check_binding(const std::set<std::string> &given, const std::set<std::string> &declared,
                   const Node &node, const std::string &fn, const std::string &what)
{
    std::vector<std::string> missing, extra;
    for (const auto &d : declared)
        if (!given.count(d)) missing.push_back(d);
    for (const auto &g : given)
        if (!declared.count(g)) extra.push_back(g);
    if (!missing.empty())
        throw node_err(fn, node, what + " " + list_text(missing) + " are not bound");
    if (!extra.empty()) throw node_err(fn, node, list_text(extra) + " are not among " + what);
}

void parse_einsum(const std::string &subscripts, size_t n_inputs, const Node &node,
                  const std::string &fn, std::vector<std::string> *terms_out, std::string *rhs_out)
{
    size_t arrow = subscripts.find("->");
    if (arrow == std::string::npos) throw node_err(fn, node, "subscripts need an explicit '->'");
    std::string lhs = subscripts.substr(0, arrow), rhs = subscripts.substr(arrow + 2);
    std::vector<std::string> terms;
    size_t start = 0;
    while (true) {
        size_t comma = lhs.find(',', start);
        terms.push_back(
            lhs.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    if (terms.size() != n_inputs)
        throw node_err(fn, node,
                       "subscripts name " + std::to_string(terms.size()) +
                           " operands but there are " + std::to_string(n_inputs) + " inputs");
    std::set<char> letters;
    for (const std::string &term : terms) {
        bool ok = !term.empty();
        for (char c : term)
            if (!(c >= 'a' && c <= 'z')) ok = false;
        if (!ok) throw node_err(fn, node, "'" + term + "' is not a run of lowercase letters");
        if (std::set<char>(term.begin(), term.end()).size() != term.size())
            throw node_err(fn, node,
                           "'" + term + "' repeats a letter: diagonals are not supported");
        letters.insert(term.begin(), term.end());
    }
    std::set<char> out(rhs.begin(), rhs.end());
    bool subset = true;
    for (char c : rhs)
        if (!letters.count(c)) subset = false;
    if (out.size() != rhs.size() || !subset)
        throw node_err(fn, node,
                       "the output '" + rhs + "' must name distinct letters of the operands");
    if (terms_out) *terms_out = terms;
    if (rhs_out) *rhs_out = rhs;
}

void check_static(const Plan &plan, const Node &node, const std::string &fn)
{
    const std::string &op = node.op;
    if (op == "concat" && node.list.empty()) throw node_err(fn, node, "inputs is empty");
    if (op == "split") {
        for (int64_t s : node.ints)
            if (s < 0) throw node_err(fn, node, "sizes must not be negative");
        int64_t part = node.iv("part");
        if (part < 0 || part >= (int64_t)node.ints.size())
            throw node_err(fn, node,
                           "part " + std::to_string(part) + " is outside 0 .. " +
                               std::to_string((int64_t)node.ints.size() - 1));
    }
    if (op == "pad" && (node.iv("before") < 0 || node.iv("after") < 0))
        throw node_err(fn, node, "before and after must not be negative");
    if (op == "range" && node.iv("step") == 0) throw node_err(fn, node, "step must not be zero");
    if (op == "reshape") {
        int minus = 0;
        for (int64_t d : node.ints) {
            if (d == -1)
                minus++;
            else if (d < -1)
                throw node_err(fn, node, "a dimension must be -1 or non-negative");
        }
        if (minus > 1) throw node_err(fn, node, "at most one dimension may be -1");
    }
    if (op == "permute") {
        std::vector<int64_t> sorted = node.ints;
        std::sort(sorted.begin(), sorted.end());
        for (size_t k = 0; k < sorted.size(); k++)
            if (sorted[k] != (int64_t)k)
                throw node_err(fn, node,
                               "axes " + shape_text(node.ints) + " is not a permutation of 0 .. " +
                                   std::to_string((int64_t)node.ints.size() - 1));
    }
    if (op == "einsum")
        parse_einsum(node.s("subscripts"), node.list.size(), node, fn, nullptr, nullptr);
    if (op == "conv1d" &&
        (node.iv("stride") < 1 || node.iv("dilation") < 1 || node.iv("groups") < 1))
        throw node_err(fn, node, "stride, dilation and groups are at least 1");
    if (op == "avg_pool1d" && (node.iv("kernel") < 1 || node.iv("stride") < 1))
        throw node_err(fn, node, "kernel and stride are at least 1");
    if (op == "upsample_nearest" && node.iv("scale") < 1)
        throw node_err(fn, node, "scale is at least 1");
    if (op == "group_norm" && node.iv("groups") < 1)
        throw node_err(fn, node, "groups is at least 1");
    if ((op == "attention" || op == "rotary") && node.iv("heads") < 1)
        throw node_err(fn, node, "heads is at least 1");
    if (op == "dropout" && !(node.fv("p") >= 0.0 && node.fv("p") < 1.0))
        throw node_err(fn, node, "p must be in [0, 1), got " + python_float(node.fv("p")));
    if (op == "call") {
        const Plan *module = plan.find_module(node.s("module"));
        if (!module) throw node_err(fn, node, "unknown module '" + node.s("module") + "'");
        std::set<std::string> given, declared;
        for (const auto &kv : node.dict)
            given.insert(kv.first);
        for (const auto &kv : module->inputs)
            declared.insert(kv.first);
        check_binding(given, declared, node, fn, "the module's inputs");
    }
    if (op == "loop") {
        const Plan &body = *node.body;
        std::set<std::string> bound, declared;
        for (const auto &kv : node.dict)
            bound.insert(kv.first);
        for (const auto &kv : node.dict2) {
            if (bound.count(kv.first))
                throw node_err(fn, node, "a body input is both carried and fixed");
            bound.insert(kv.first);
        }
        if (node.has("step")) {
            const std::string &step = node.s("step");
            auto it = body.inputs.find(step);
            if (it == body.inputs.end())
                throw node_err(fn, node, "step names '" + step + "', which is not a body input");
            if (it->second.dtype != DType::Integer || it->second.rank != 0)
                throw node_err(fn, node,
                               "the step input '" + step + "' must be an integer of rank 0");
            bound.insert(step);
        }
        for (const auto &kv : body.inputs)
            declared.insert(kv.first);
        check_binding(bound, declared, node, fn, "the body's inputs");
        for (const auto &kv : node.dict)
            if (!body.output(kv.first))
                throw node_err(fn, node, "the body has no output '" + kv.first + "' to carry");
        if (node.s("steps") == "fixed" && node.iv("fixed") < 0)
            throw node_err(fn, node, "fixed steps must not be negative");
        if (node.s("steps") == "until") {
            if (!body.output(node.s("until_output")))
                throw node_err(
                    fn, node, "the body has no output '" + node.s("until_output") + "' to stop on");
            if (node.iv("max") < 0) throw node_err(fn, node, "max must not be negative");
        }
    }
}

void infer(Plan &plan, const std::string &fn);

void node_dtype(Plan &plan, Node &node, const std::string &fn)
{
    const std::string &op = node.op;
    auto bad = [&](const std::string &what) { return node_err(fn, node, what); };
    auto d = [&](const std::string &operand) { return dtype_of(plan, operand, fn); };
    auto name = [](DType t) { return std::string(dtype_name(t)); };
    auto set = [&](DType t) {
        node.many = false;
        node.dtype = t;
    };
    if (op == "add" || op == "sub" || op == "mul" || op == "remainder") {
        DType da = d(node.s("a")), db = d(node.s("b"));
        if (is_float_kind(da) && is_float_kind(db)) return set(wider(da, db));
        if (da != db || da == DType::Boolean)
            throw bad("takes float or integer operands of one type, got " + name(da) + " and " +
                      name(db));
        return set(da);
    }
    if (op == "div" || op == "pow") {
        DType da = d(node.s("a")), db = d(node.s("b"));
        if (!(is_float_kind(da) && is_float_kind(db)))
            throw bad("takes float operands, got " + name(da) + " and " + name(db));
        return set(wider(da, db));
    }
    if (op == "neg" || op == "abs") {
        DType dx = d(node.s("x"));
        if (dx == DType::Boolean) throw bad("takes a float or integer operand, got boolean");
        return set(dx);
    }
    if (FLOAT_UNARY.count(op)) {
        DType dx = d(node.s("x"));
        if (!is_float_kind(dx)) throw bad("takes a float operand, got " + name(dx));
        return set(dx);
    }
    if (op == "is_nan") {
        if (!is_float_kind(d(node.s("x")))) throw bad("takes a float operand");
        return set(DType::Boolean);
    }
    if (op == "eq" || op == "ne") {
        DType da = d(node.s("a")), db = d(node.s("b"));
        if (da != db && !(is_float_kind(da) && is_float_kind(db)))
            throw bad("takes operands of one type, got " + name(da) + " and " + name(db));
        return set(DType::Boolean);
    }
    if (op == "lt" || op == "le" || op == "gt" || op == "ge") {
        DType da = d(node.s("a")), db = d(node.s("b"));
        if ((da != db && !(is_float_kind(da) && is_float_kind(db))) || da == DType::Boolean)
            throw bad("takes float or integer operands of one type, got " + name(da) + " and " +
                      name(db));
        return set(DType::Boolean);
    }
    if (op == "logical_not") {
        if (d(node.s("x")) != DType::Boolean) throw bad("takes a boolean operand");
        return set(DType::Boolean);
    }
    if (op == "logical_and" || op == "logical_or") {
        if (d(node.s("a")) != DType::Boolean || d(node.s("b")) != DType::Boolean)
            throw bad("takes boolean operands");
        return set(DType::Boolean);
    }
    if (op == "where") {
        if (d(node.s("cond")) != DType::Boolean) throw bad("cond must be boolean");
        DType da = d(node.s("a")), db = d(node.s("b"));
        if (is_float_kind(da) && is_float_kind(db)) return set(wider(da, db));
        if (da != db)
            throw bad("a and b must be of one type, got " + name(da) + " and " + name(db));
        return set(da);
    }
    if (op == "cast") {
        d(node.s("x"));
        return set(dtype_of_name(node.s("dtype")));
    }
    if (op == "constant") return set(dtype_of_name(node.s("value")));
    if (op == "gather") {
        if (d(node.s("index")) != DType::Integer) throw bad("index must be integer");
        return set(d(node.s("table")));
    }
    if (op == "take_along") {
        if (d(node.s("index")) != DType::Integer) throw bad("index must be integer");
        return set(d(node.s("x")));
    }
    if (op == "mask_select") {
        if (d(node.s("mask")) != DType::Boolean) throw bad("mask must be boolean");
        return set(d(node.s("x")));
    }
    if (op == "mask_indices") {
        if (d(node.s("mask")) != DType::Boolean) throw bad("mask must be boolean");
        return set(DType::Integer);
    }
    if (op == "repeat") {
        if (d(node.s("counts")) != DType::Integer) throw bad("counts must be integer");
        return set(d(node.s("x")));
    }
    if (op == "range") {
        if (d(node.s("stop")) != DType::Integer) throw bad("stop must be integer");
        return set(DType::Integer);
    }
    if (op == "searchsorted") {
        DType ds = d(node.s("sorted")), dv = d(node.s("values"));
        if (ds != dv || ds == DType::Boolean)
            throw bad("sorted and values must be float or integer of one type, got " + name(ds) +
                      " and " + name(dv));
        return set(DType::Integer);
    }
    if (op == "split" || op == "slice" || op == "pad" || op == "reshape" || op == "permute" ||
        op == "stop_gradient")
        return set(d(node.s("x")));
    if (op == "broadcast") {
        d(node.s("like"));
        return set(d(node.s("x")));
    }
    if (op == "concat") {
        std::set<DType> dts;
        for (const std::string &x : node.list)
            dts.insert(d(x));
        if (dts.size() != 1) throw bad("inputs must be of one type");
        return set(*dts.begin());
    }
    if (op == "embedding_bag") {
        if (d(node.s("table")) != DType::Float) throw bad("table must be float");
        if (d(node.s("index")) != DType::Integer || d(node.s("segments")) != DType::Integer)
            throw bad("index and segments must be integer");
        if (node.has("weights") && d(node.s("weights")) != DType::Float)
            throw bad("weights must be float");
        d(node.s("size"));
        return set(DType::Float);
    }
    if (op == "segment_softmax" || op == "segment_log_softmax") {
        if (d(node.s("x")) != DType::Float) throw bad("x must be float");
        if (d(node.s("segments")) != DType::Integer) throw bad("segments must be integer");
        return set(DType::Float);
    }
    if (op == "segment_reduce") {
        DType dx = d(node.s("x"));
        if (d(node.s("segments")) != DType::Integer) throw bad("segments must be integer");
        d(node.s("size"));
        if (dx == DType::Boolean) throw bad("x must be float or integer");
        if (node.s("reduce") == "mean" && !is_float_kind(dx)) throw bad("mean takes a float x");
        return set(dx);
    }
    if (op == "scatter_add") {
        DType dx = d(node.s("x"));
        if (dx == DType::Boolean) throw bad("x must be float or integer");
        if (d(node.s("index")) != DType::Integer) throw bad("index must be integer");
        d(node.s("size"));
        return set(dx);
    }
    if (op == "linear" || op == "conv1d" || op == "layer_norm" || op == "group_norm") {
        for (const char *f : {"x", "weight", "bias"})
            if (node.has(f) && d(node.s(f)) != DType::Float)
                throw bad(std::string(f) + " must be float");
        return set(DType::Float);
    }
    if (op == "avg_pool1d" || op == "upsample_nearest" || op == "dropout") {
        if (d(node.s("x")) != DType::Float) throw bad("x must be float");
        return set(DType::Float);
    }
    if (op == "einsum") {
        for (const std::string &x : node.list)
            if (d(x) != DType::Float) throw bad("inputs must be float");
        return set(DType::Float);
    }
    if (op == "attention") {
        for (const char *f : {"q", "k", "v"})
            if (d(node.s(f)) != DType::Float) throw bad(std::string(f) + " must be float");
        if (node.has("bias") && d(node.s("bias")) != DType::Float) throw bad("bias must be float");
        if (node.s("mask") == "segments" && d(node.s("ids")) != DType::Integer)
            throw bad("the mask's ids must be integer");
        if (node.s("mask") == "key_sets" &&
            (d(node.s("ptr")) != DType::Integer || d(node.s("keys")) != DType::Integer))
            throw bad("the mask's ptr and keys must be integer");
        return set(DType::Float);
    }
    if (op == "rotary") {
        if (d(node.s("x")) != DType::Float) throw bad("x must be float");
        if (d(node.s("positions")) != DType::Integer) throw bad("positions must be integer");
        return set(DType::Float);
    }
    if (op == "random_normal" || op == "random_uniform") {
        d(node.s("like"));
        return set(DType::Float);
    }
    if (AXIS_OPS.count(op)) {
        DType dx = d(node.s("x"));
        if (dx == DType::Boolean) throw bad("takes a float or integer operand, got boolean");
        if ((op == "mean" || op == "logsumexp" || op == "softmax" || op == "log_softmax") &&
            !is_float_kind(dx))
            throw bad("takes a float operand, got " + name(dx));
        return set(op == "argmax" ? DType::Integer : dx);
    }
    if (op == "call") {
        Plan *module = const_cast<Plan *>(plan.find_module(node.s("module")));
        for (const auto &kv : node.dict) {
            const InputSpec &spec = module->inputs.at(kv.first);
            if (d(kv.second) != spec.dtype)
                throw bad("input '" + kv.first + "' is " + name(d(kv.second)) +
                          " but the module declares " + name(spec.dtype));
        }
        infer(*module, fn);
        node.many = true;
        node.dtypes.clear();
        for (const auto &out : module->outputs)
            node.dtypes[out.first] = dtype_of(*module, out.second, fn);
        return;
    }
    if (op == "loop") {
        Plan &body = *node.body;
        for (const auto *dict : {&node.dict, &node.dict2})
            for (const auto &kv : *dict) {
                const InputSpec &spec = body.inputs.at(kv.first);
                if (d(kv.second) != spec.dtype)
                    throw bad("input '" + kv.first + "' is " + name(d(kv.second)) +
                              " but the body declares " + name(spec.dtype));
            }
        infer(body, fn);
        node.many = true;
        node.dtypes.clear();
        for (const auto &kv : node.dict) {
            DType out = dtype_of(body, *body.output(kv.first), fn);
            if (out != body.inputs.at(kv.first).dtype)
                throw bad("the carried '" + kv.first + "' is " +
                          name(body.inputs.at(kv.first).dtype) + " but the body answers " +
                          name(out));
            node.dtypes[kv.first] = out;
        }
        if (node.s("steps") == "until" &&
            dtype_of(body, *body.output(node.s("until_output")), fn) != DType::Boolean)
            throw bad("the stop output '" + node.s("until_output") + "' must be boolean");
        return;
    }
    throw Error(fn + ": node '" + node.name + "': unknown operation '" + op + "'");
}

void infer(Plan &plan, const std::string &fn)
{
    for (Node &node : plan.nodes)
        node_dtype(plan, node, fn);
}

std::shared_ptr<Plan> build(EastValue *data, const std::string &fn_s, const Plan *parent)
{
    const char *fn = fn_s.c_str();
    auto plan = std::make_shared<Plan>();
    plan->parent = parent;
    EastValue *inputs = field(data, "inputs", fn);
    for (size_t i = 0, n = east_dict_len(inputs); i < n; i++) {
        EastValue *spec = east_dict_val_at(inputs, i);
        InputSpec in;
        in.dtype = dtype_of_name(case_of(field(spec, "dtype", fn), fn));
        in.rank = as_integer(field(spec, "rank", fn), fn);
        plan->inputs[str_of(east_dict_key_at(inputs, i), fn)] = in;
    }
    EastValue *params = field(data, "params", fn);
    for (size_t i = 0, n = east_dict_len(params); i < n; i++) {
        EastValue *spec = east_dict_val_at(params, i);
        ParamSpec ps;
        ps.shape = integers(field(spec, "shape", fn), fn);
        EastValue *init = field(spec, "init", fn);
        ps.init = case_of(init, fn);
        if (ps.init == "constant" || ps.init == "normal" || ps.init == "uniform")
            ps.init_arg = as_float(payload(init), fn);
        ps.trainable = as_boolean(field(spec, "trainable", fn), fn);
        ps.decay = as_float(field(spec, "decay", fn), fn);
        plan->params[str_of(east_dict_key_at(params, i), fn)] = ps;
    }
    EastValue *outputs = field(data, "outputs", fn);
    for (size_t i = 0, n = east_dict_len(outputs); i < n; i++)
        plan->outputs.emplace_back(str_of(east_dict_key_at(outputs, i), fn),
                                   str_of(east_dict_val_at(outputs, i), fn));
    EastValue *modules = field(data, "modules", fn);
    for (size_t i = 0, n = east_dict_len(modules); i < n; i++)
        plan->modules[str_of(east_dict_key_at(modules, i), fn)] =
            build(east_dict_val_at(modules, i), fn_s, plan.get());

    std::set<std::string> seen;
    for (const auto &kv : plan->inputs) {
        check_name(kv.first, fn_s);
        seen.insert(kv.first);
    }
    for (const auto &kv : plan->params) {
        if (seen.count(kv.first)) throw err(fn_s, "'" + kv.first + "' is defined twice");
        check_name(kv.first, fn_s);
        seen.insert(kv.first);
    }
    EastValue *nodes = field(data, "nodes", fn);
    size_t n_nodes = length(nodes, fn);
    std::set<std::string> later;
    for (size_t i = 0; i < n_nodes; i++)
        later.insert(str_of(field(at(nodes, i), "name", fn), fn));
    for (size_t i = 0; i < n_nodes; i++) {
        Node node = parse_node(at(nodes, i), fn_s, plan.get());
        if (seen.count(node.name)) throw err(fn_s, "'" + node.name + "' is defined twice");
        check_name(node.name, fn_s);
        for (const std::string &operand : operands_of(node))
            resolve(*plan, operand, fn_s, &node.name, later);
        check_static(*plan, node, fn_s);
        plan->index[node.name] = plan->nodes.size();
        plan->nodes.push_back(std::move(node));
        seen.insert(plan->nodes.back().name);
    }
    for (const auto &out : plan->outputs) {
        check_name(out.first, fn_s);
        resolve(*plan, out.second, fn_s, nullptr, {});
    }
    return plan;
}

} // namespace

const Plan *Plan::find_module(const std::string &name) const
{
    for (const Plan *scope = this; scope; scope = scope->parent) {
        auto it = scope->modules.find(name);
        if (it != scope->modules.end()) return it->second.get();
    }
    return nullptr;
}

const std::string *Plan::output(const std::string &name) const
{
    for (const auto &out : outputs)
        if (out.first == name) return &out.second;
    return nullptr;
}

std::shared_ptr<Plan> build_plan(EastValue *net, const std::string &fn)
{
    (void)FN_PLACEHOLDER;
    std::shared_ptr<Plan> plan = build(net, fn, nullptr);
    infer(*plan, fn);
    return plan;
}

std::pair<std::string, std::string> split_operand(const std::string &operand)
{
    size_t dot = operand.find('.');
    if (dot == std::string::npos) return {operand, ""};
    return {operand.substr(0, dot), operand.substr(dot + 1)};
}

std::vector<std::string> operands_of(const Node &node)
{
    std::vector<std::string> names;
    const std::string &op = node.op;
    auto add = [&](const char *f) {
        if (node.has(f)) names.push_back(node.s(f));
    };
    if (op == "gather") {
        add("table");
        add("index");
    } else if (op == "take_along") {
        add("x");
        add("index");
    } else if (op == "mask_select") {
        add("x");
        add("mask");
    } else if (op == "mask_indices") {
        add("mask");
    } else if (op == "repeat") {
        add("x");
        add("counts");
    } else if (op == "range") {
        add("stop");
    } else if (op == "searchsorted") {
        add("sorted");
        add("values");
    } else if (op == "embedding_bag") {
        add("table");
        add("index");
        add("weights");
        add("segments");
        add("size");
    } else if (op == "segment_reduce" || op == "scatter_add") {
        add("x");
        add(op == "scatter_add" ? "index" : "segments");
        add("size");
    } else if (op == "segment_softmax" || op == "segment_log_softmax") {
        add("x");
        add("segments");
    } else if (op == "concat" || op == "einsum") {
        names = node.list;
    } else if (op == "broadcast") {
        add("x");
        add("like");
    } else if (op == "where") {
        add("cond");
        add("a");
        add("b");
    } else if (op == "constant") {
    } else if (op == "linear" || op == "conv1d" || op == "layer_norm" || op == "group_norm") {
        add("x");
        add("weight");
        add("bias");
    } else if (BINARY.count(op)) {
        add("a");
        add("b");
    } else if (op == "attention") {
        add("q");
        add("k");
        add("v");
        add("bias");
        add("ids");
        add("ptr");
        add("keys");
    } else if (op == "rotary") {
        add("x");
        add("positions");
    } else if (op == "random_normal" || op == "random_uniform") {
        add("like");
    } else if (op == "call") {
        for (const auto &kv : node.dict)
            names.push_back(kv.second);
    } else if (op == "loop") {
        for (const auto &kv : node.dict)
            names.push_back(kv.second);
        for (const auto &kv : node.dict2)
            names.push_back(kv.second);
    } else {
        add("x");
    }
    return names;
}

DType dtype_of(const Plan &plan, const std::string &operand, const std::string &fn)
{
    auto [head, sub] = split_operand(operand);
    auto in = plan.inputs.find(head);
    if (in != plan.inputs.end()) return in->second.dtype;
    if (plan.params.count(head)) return DType::Float;
    const Node &node = plan.nodes[plan.index.at(head)];
    if (node.many) {
        if (sub.empty()) {
            if (node.dtypes.size() == 1) return node.dtypes.begin()->second;
            throw err(fn,
                      "'" + head + "' holds several tensors: name one as '" + head + ".<name>'");
        }
        auto it = node.dtypes.find(sub);
        if (it == node.dtypes.end()) throw err(fn, "'" + head + "' has no tensor '" + sub + "'");
        return it->second;
    }
    if (!sub.empty()) throw err(fn, "'" + head + "' holds one tensor: it has no '" + sub + "'");
    return node.dtype;
}

void collect_weights(const Plan &plan, const std::string &fn, const std::string &prefix,
                     std::map<std::string, ParamSpec> &into)
{
    for (const auto &kv : plan.params) {
        std::string full = prefix + kv.first;
        auto it = into.find(full);
        if (it != into.end() && it->second != kv.second)
            throw err(fn, "the weight '" + full +
                              "' is declared twice with different shapes or initialisations");
        into[full] = kv.second;
    }
    for (const Node &node : plan.nodes) {
        if (node.op == "call")
            collect_weights(*plan.find_module(node.s("module")), fn,
                            prefix + node.s("prefix") + ".", into);
        else if (node.op == "loop")
            collect_weights(*node.body, fn, prefix, into);
    }
}

std::vector<const Node *> needed_nodes(const Plan &plan, const std::vector<std::string> &operands,
                                       std::map<std::string, std::set<std::string> > *wanted)
{
    std::set<std::string> needed;
    std::vector<std::string> stack(operands.begin(), operands.end());
    while (!stack.empty()) {
        std::string operand = stack.back();
        stack.pop_back();
        auto [head, sub] = split_operand(operand);
        if (!plan.index.count(head)) continue;
        if (wanted) (*wanted)[head].insert(sub);
        if (needed.count(head)) continue;
        needed.insert(head);
        for (const std::string &o : operands_of(plan.nodes[plan.index.at(head)]))
            stack.push_back(o);
    }
    std::vector<const Node *> out;
    for (const Node &node : plan.nodes)
        if (needed.count(node.name)) out.push_back(&node);
    return out;
}

} // namespace east_ds::nn
