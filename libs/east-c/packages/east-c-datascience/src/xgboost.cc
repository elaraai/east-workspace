/*
 * The XGBoost family: xgboost_train_regressor, xgboost_train_classifier,
 * xgboost_train_quantile, xgboost_predict, xgboost_predict_class,
 * xgboost_predict_proba and xgboost_predict_quantile on XGBoost's C API, with
 * the parameters east-py-datascience's sklearn wrappers hand the same library.
 *
 * The model blob is XGBoost's own UBJSON model, so a model trained on one
 * runner predicts on the other: a classifier carries its class labels as the
 * booster attribute `east_classes` (a JSON array), and a quantile model is a
 * container of one UBJSON model per quantile (`QUANTILE_MAGIC`, then a count,
 * then each model's quantile, length and bytes, all little-endian).
 *
 * Categorical columns follow east-py-datascience's pandas encoding exactly:
 * without a category count a column's codes are the ranks of its distinct
 * whole-number values; with one a value is its own code when it lies in
 * [0, n), else missing; and a non-integer value is refused where pandas
 * refuses it.
 */
#include "value_util.h"

#include <xgboost/c_api.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace
{

using namespace east_ds;

/* ---- the library ------------------------------------------------------ */

struct DMatrix {
    DMatrixHandle h = nullptr;
    ~DMatrix()
    {
        if (h) XGDMatrixFree(h);
    }
};

struct Booster {
    BoosterHandle h = nullptr;
    ~Booster()
    {
        if (h) XGBoosterFree(h);
    }
};

std::string last_error()
{
    const char *e = XGBGetLastError();
    return e ? e : "unknown error";
}

/* A dense row-major matrix as the library takes it. */
struct Dense {
    size_t rows = 0, cols = 0;
    std::vector<float> data;
};

std::string shape(const Dense &X)
{
    return "(" + std::to_string(X.rows) + ", " + std::to_string(X.cols) + ")";
}

Dense dense(EastValue *v, const char *fn)
{
    Matrix m = matrix_floats(v, fn);
    Dense d;
    d.rows = m.rows;
    d.cols = m.cols;
    d.data.assign(m.data.begin(), m.data.end());
    return d;
}

/* ---- categorical columns ---------------------------------------------- */

struct Categorical {
    bool enabled = false;
    std::vector<int64_t> indices;
    bool has_n = false;
    std::vector<int64_t> n;
};

/* The `categorical_features` / `categorical_n` options of a config or blob. */
Categorical categorical_config(EastValue *s, const char *fn)
{
    Categorical c;
    if (EastValue *features = some_value(field(s, "categorical_features", fn), fn)) {
        c.enabled = true;
        c.indices = vector_integers(features, fn);
    }
    if (EastValue *counts = some_value(field(s, "categorical_n", fn), fn)) {
        c.has_n = true;
        c.n = vector_integers(counts, fn);
    }
    return c;
}

void check_indices(const Categorical &c, size_t n_features, const char *fn)
{
    for (int64_t idx : c.indices)
        if (idx < 0 || idx >= static_cast<int64_t>(n_features))
            throw Error(msg(fn, "categorical_features index " + std::to_string(idx) +
                                    " out of bounds for " + std::to_string(n_features) +
                                    " features"));
}

[[noreturn]] void non_integer(size_t idx, size_t row, double v, const char *fn)
{
    throw Error(msg(fn, "categorical column " + std::to_string(idx) +
                            " contains non-integer value " + python_float(v) + " at row " +
                            std::to_string(row) +
                            ". Categorical features must contain whole numbers (0.0, 1.0, 2.0, "
                            "...) representing category indices."));
}

/* Refuses a non-integer among the column's present values. */
void check_integer_codes(const Dense &X, size_t idx, const char *fn)
{
    for (size_t r = 0; r < X.rows; r++) {
        double v = X.data[r * X.cols + idx];
        if (std::isnan(v)) continue;
        if (!std::isfinite(v) || v != std::trunc(v)) non_integer(idx, r, v, fn);
    }
}

/* Encodes the categorical columns in place: at training (`check`) a column's
 * values must be whole numbers, and with no category count they must be at
 * prediction too; with a count a prediction-time value is truncated, and one
 * outside [0, n) is missing. */
void encode_categorical(Dense &X, const Categorical &c, const char *fn, bool check)
{
    if (!c.enabled) return;
    check_indices(c, X.cols, fn);
    if (check && c.has_n && c.n.size() != c.indices.size())
        throw Error(msg(fn, "categorical_n has " + std::to_string(c.n.size()) +
                                " entries but categorical_features has " +
                                std::to_string(c.indices.size()) + " entries"));
    for (size_t i = 0; i < c.indices.size(); i++) {
        size_t idx = static_cast<size_t>(c.indices[i]);
        if (!c.has_n || i >= c.n.size()) {
            /* The inferred category space: every value a whole number, each
             * coded by its rank among the column's distinct values. */
            for (size_t r = 0; r < X.rows; r++) {
                double v = X.data[r * X.cols + idx];
                if (!std::isfinite(v))
                    throw Error(msg(fn, "categorical column " + std::to_string(idx) +
                                            " contains non-finite value " + python_float(v) +
                                            " at row " + std::to_string(r) +
                                            ". Categorical features must contain whole numbers "
                                            "(0.0, 1.0, 2.0, ...) representing category indices."));
            }
            check_integer_codes(X, idx, fn);
            std::set<int64_t> values;
            for (size_t r = 0; r < X.rows; r++)
                values.insert(static_cast<int64_t>(X.data[r * X.cols + idx]));
            std::map<int64_t, float> code;
            float next = 0.0f;
            for (int64_t v : values)
                code[v] = next++;
            for (size_t r = 0; r < X.rows; r++)
                X.data[r * X.cols + idx] = code[static_cast<int64_t>(X.data[r * X.cols + idx])];
        } else {
            if (check) check_integer_codes(X, idx, fn);
            int64_t n = c.n[i];
            for (size_t r = 0; r < X.rows; r++) {
                float &cell = X.data[r * X.cols + idx];
                if (std::isnan(cell)) continue;
                double k = std::trunc(static_cast<double>(cell));
                cell =
                    (k >= 0 && k < static_cast<double>(n)) ? static_cast<float>(k) : std::nanf("");
            }
        }
    }
}

/* The DMatrix of an encoded matrix: its feature types name the categorical
 * columns, as a pandas frame's would. */
DMatrix dmatrix(const Dense &X, const Categorical &c, const char *fn)
{
    DMatrix dm;
    if (XGDMatrixCreateFromMat(X.data.data(), X.rows, X.cols, std::nanf(""), &dm.h) != 0)
        throw Error(msg(fn, "the feature matrix was refused - " + last_error()));
    if (c.enabled) {
        std::vector<const char *> types(X.cols, "float");
        for (int64_t idx : c.indices)
            types[static_cast<size_t>(idx)] = "c";
        if (XGDMatrixSetStrFeatureInfo(dm.h, "feature_type", types.data(), X.cols) != 0)
            throw Error(msg(fn, "the feature types were refused - " + last_error()));
    }
    return dm;
}

/* ---- the hyperparameters ---------------------------------------------- */

std::string number(double x)
{
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.17g", x);
    return buf;
}

/* The config's hyperparameters, as the sklearn wrapper hands them to the
 * library (its own defaults where the option is `none`). */
struct Params {
    int64_t n_estimators = 100;
    std::vector<std::pair<std::string, std::string> > set;
};

Params params(EastValue *config, const char *fn, bool classifier)
{
    Params p;
    auto integer = [&](const char *name, const char *param, int64_t dflt) {
        EastValue *v = some_value(field(config, name, fn), fn);
        p.set.emplace_back(param, std::to_string(v ? as_integer(v, fn) : dflt));
    };
    auto real = [&](const char *name, const char *param, double dflt) {
        EastValue *v = some_value(field(config, name, fn), fn);
        p.set.emplace_back(param, number(v ? as_float(v, fn) : dflt));
    };
    if (EastValue *v = some_value(field(config, "n_estimators", fn), fn))
        p.n_estimators = as_integer(v, fn);
    integer("max_depth", "max_depth", 6);
    real("learning_rate", "eta", 0.3);
    integer("min_child_weight", "min_child_weight", 1);
    real("subsample", "subsample", 1.0);
    real("colsample_bytree", "colsample_bytree", 1.0);
    real("reg_alpha", "alpha", 0.0);
    real("reg_lambda", "lambda", 1.0);
    real("gamma", "gamma", 0.0);
    if (EastValue *v = some_value(field(config, "random_state", fn), fn))
        p.set.emplace_back("seed", std::to_string(as_integer(v, fn)));
    integer("n_jobs", "nthread", -1);
    integer("max_cat_to_onehot", "max_cat_to_onehot", 4);
    integer("max_cat_threshold", "max_cat_threshold", 64);
    if (classifier)
        if (EastValue *v = some_value(field(config, "scale_pos_weight", fn), fn))
            p.set.emplace_back("scale_pos_weight", number(as_float(v, fn)));
    return p;
}

/* The per-sample weights, checked against the rows. */
std::vector<float> sample_weight(EastValue *config, size_t rows, const char *fn)
{
    std::vector<float> w;
    if (EastValue *v = some_value(field(config, "sample_weight", fn), fn)) {
        std::vector<double> d = vector_floats(v, fn);
        if (d.size() != rows)
            throw Error(msg(fn, "sample_weight has " + std::to_string(d.size()) +
                                    " elements but X has " + std::to_string(rows) + " samples"));
        w.assign(d.begin(), d.end());
    }
    return w;
}

/* ---- training and prediction ------------------------------------------ */

void set_param(Booster &b, const char *name, const std::string &value, const Dense &X,
               const char *fn)
{
    if (XGBoosterSetParam(b.h, name, value.c_str()) != 0)
        throw Error(msg(fn, "Training failed with X shape " + shape(X) + " - " + last_error()));
}

/* Trains `rounds` boosting rounds on X with the given labels and parameters. */
Booster train(const Dense &X, const std::vector<float> &labels, const std::vector<float> &weights,
              const Categorical &c, const Params &p, const char *objective,
              const std::vector<std::pair<std::string, std::string> > &extra, const char *fn)
{
    DMatrix dm = dmatrix(X, c, fn);
    if (XGDMatrixSetFloatInfo(dm.h, "label", labels.data(), labels.size()) != 0 ||
        (!weights.empty() &&
         XGDMatrixSetFloatInfo(dm.h, "weight", weights.data(), weights.size()) != 0))
        throw Error(msg(fn, "Training failed with X shape " + shape(X) + " - " + last_error()));
    Booster b;
    if (XGBoosterCreate(&dm.h, 1, &b.h) != 0)
        throw Error(msg(fn, "Training failed with X shape " + shape(X) + " - " + last_error()));
    set_param(b, "objective", objective, X, fn);
    set_param(b, "verbosity", "0", X, fn);
    for (const auto &[name, value] : p.set)
        set_param(b, name.c_str(), value, X, fn);
    for (const auto &[name, value] : extra)
        set_param(b, name.c_str(), value, X, fn);
    for (int64_t i = 0; i < p.n_estimators; i++)
        if (XGBoosterUpdateOneIter(b.h, static_cast<int>(i), dm.h) != 0)
            throw Error(msg(fn, "Training failed with X shape " + shape(X) + " - " + last_error()));
    return b;
}

/* The booster as its UBJSON model. */
std::string save(const Booster &b, const char *fn)
{
    bst_ulong len = 0;
    const char *out = nullptr;
    if (XGBoosterSaveModelToBuffer(b.h, "{\"format\":\"ubj\"}", &len, &out) != 0)
        throw Error(msg(fn, "the model could not be saved - " + last_error()));
    return std::string(out, len);
}

/* What every runner says of a blob from before the UBJSON form (a cloudpickle,
 * which begins with 0x80; UBJSON with `{`), after the function's name — the
 * python runner alone reads one, through xgboost_resave. */
const char *const LEGACY_MESSAGE = "the model blob is from before the UBJSON form (a cloudpickle); "
                                   "re-save it once with xgboost_resave on the python runner";

bool is_legacy_pickle(std::string_view bytes)
{
    return !bytes.empty() && static_cast<unsigned char>(bytes[0]) == 0x80;
}

void refuse_legacy(std::string_view bytes, const char *fn)
{
    if (is_legacy_pickle(bytes)) throw Error(msg(fn, LEGACY_MESSAGE));
}

Booster load(std::string_view bytes, const Dense &X, const char *fn)
{
    Booster b;
    if (XGBoosterCreate(nullptr, 0, &b.h) != 0 ||
        XGBoosterLoadModelFromBuffer(b.h, bytes.data(), bytes.size()) != 0)
        throw Error(msg(fn, "Prediction failed with X shape " + shape(X) + " - " + last_error()));
    return b;
}

/* A booster from its UBJSON model alone (xgboost_resave). */
Booster load_model(std::string_view bytes, const char *fn)
{
    Booster b;
    if (XGBoosterCreate(nullptr, 0, &b.h) != 0 ||
        XGBoosterLoadModelFromBuffer(b.h, bytes.data(), bytes.size()) != 0)
        throw Error(msg(fn, "the model blob is not one this runner reads - " + last_error()));
    return b;
}

/* The predictions of a booster on X: `columns` values per row. */
std::vector<double> predict(const Booster &b, const Dense &X, const Categorical &c, size_t *columns,
                            const char *fn)
{
    DMatrix dm = dmatrix(X, c, fn);
    const bst_ulong *out_shape = nullptr;
    bst_ulong out_dim = 0;
    const float *out = nullptr;
    const char *config = "{\"type\":0,\"training\":false,\"iteration_begin\":0,"
                         "\"iteration_end\":0,\"strict_shape\":true}";
    if (XGBoosterPredictFromDMatrix(b.h, dm.h, config, &out_shape, &out_dim, &out) != 0)
        throw Error(msg(fn, "Prediction failed with X shape " + shape(X) + " - " + last_error()));
    size_t total = 1;
    for (bst_ulong i = 0; i < out_dim; i++)
        total *= out_shape[i];
    *columns = X.rows == 0 ? 1 : total / X.rows;
    return std::vector<double>(out, out + total);
}

/* ---- the model blob --------------------------------------------------- */

/* The `categorical_features` / `categorical_n` options a blob carries. */
void set_categorical(StructBuilder &s, EastType *payload_t, const Categorical &c, const char *fn)
{
    EastType *features_t = field_type(payload_t, "categorical_features", fn);
    EastType *n_t = field_type(payload_t, "categorical_n", fn);
    s.set("categorical_features",
          c.enabled ? some(features_t, integer_vector(c.indices)) : none(features_t));
    s.set("categorical_n", c.has_n ? some(n_t, integer_vector(c.n)) : none(n_t));
}

/* The payload of a model blob whose case is `tag`, or the error the python
 * runner raises for another case. */
EastValue *expect_case(EastValue *model, const char *tag, const char *fn)
{
    const char *actual = case_of(model, fn);
    if (std::strcmp(actual, tag) != 0)
        throw Error(msg(fn, std::string("Expected ") + tag + ", got " + actual));
    return payload(model);
}

/* The class labels a classifier carries, as JSON: `[0,1,7]`. */
/* The class labels as the python runner writes them (json.dumps: ", "
 * between elements), so a classifier fitted alike on both runners is the
 * same bytes. */
std::string classes_json(const std::vector<int64_t> &classes)
{
    std::string s = "[";
    for (size_t i = 0; i < classes.size(); i++) {
        if (i) s += ", ";
        s += std::to_string(classes[i]);
    }
    return s + "]";
}

std::vector<int64_t> classes_of(const Booster &b, const char *fn)
{
    const char *out = nullptr;
    int success = 0;
    if (XGBoosterGetAttr(b.h, "east_classes", &out, &success) != 0 || !success || !out)
        throw Error(msg(fn, "the classifier blob carries no class labels"));
    std::vector<int64_t> classes;
    const char *p = out;
    while (*p) {
        if (*p == '-' || (*p >= '0' && *p <= '9')) {
            char *end = nullptr;
            classes.push_back(std::strtoll(p, &end, 10));
            p = end;
        } else {
            p++;
        }
    }
    return classes;
}

/* ---- the quantile container ------------------------------------------- */

const char QUANTILE_MAGIC[8] = {'E', '3', 'X', 'G', 'B', 'Q', '0', '1'};

template <typename T> void put_le(std::string &out, T v)
{
    unsigned char bytes[sizeof(T)];
    std::memcpy(bytes, &v, sizeof(T));
    out.append(reinterpret_cast<const char *>(bytes), sizeof(T));
}

template <typename T> T get_le(std::string_view in, size_t &at, const char *fn)
{
    if (at + sizeof(T) > in.size()) throw Error(msg(fn, "the quantile model blob is cut short"));
    T v;
    std::memcpy(&v, in.data() + at, sizeof(T));
    at += sizeof(T);
    return v;
}

struct QuantileModel {
    double quantile;
    std::string model;
};

std::string pack_quantiles(const std::vector<QuantileModel> &models)
{
    std::string out(QUANTILE_MAGIC, sizeof(QUANTILE_MAGIC));
    put_le<uint32_t>(out, static_cast<uint32_t>(models.size()));
    for (const QuantileModel &m : models) {
        put_le<double>(out, m.quantile);
        put_le<uint64_t>(out, m.model.size());
        out += m.model;
    }
    return out;
}

std::vector<QuantileModel> unpack_quantiles(std::string_view in, const char *fn)
{
    if (in.size() < sizeof(QUANTILE_MAGIC) ||
        std::memcmp(in.data(), QUANTILE_MAGIC, sizeof(QUANTILE_MAGIC)) != 0)
        throw Error(msg(fn, "the quantile model blob is not one this runner reads"));
    size_t at = sizeof(QUANTILE_MAGIC);
    uint32_t count = get_le<uint32_t>(in, at, fn);
    std::vector<QuantileModel> models;
    for (uint32_t i = 0; i < count; i++) {
        double q = get_le<double>(in, at, fn);
        uint64_t len = get_le<uint64_t>(in, at, fn);
        if (at + len > in.size()) throw Error(msg(fn, "the quantile model blob is cut short"));
        models.push_back({q, std::string(in.data() + at, len)});
        at += len;
    }
    return models;
}

/* ---- the platform functions ------------------------------------------- */

void check_rows(const Dense &X, size_t labels, const char *fn)
{
    if (X.rows != labels)
        throw Error(msg(fn, "X has " + std::to_string(X.rows) + " samples but y has " +
                                std::to_string(labels) + " samples"));
}

EvalResult train_regressor(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "xgboost_train_regressor";
    if (num_args != 3) throw Error(msg(fn, "takes X, y and a config"));
    Dense X = dense(args[0], fn);
    std::vector<double> y = vector_floats(args[1], fn);
    check_rows(X, y.size(), fn);
    std::vector<float> labels(y.begin(), y.end());
    std::vector<float> weights = sample_weight(args[2], X.rows, fn);
    Categorical c = categorical_config(args[2], fn);
    encode_categorical(X, c, fn, true);
    Params p = params(args[2], fn, false);
    Booster b = train(X, labels, weights, c, p, "reg:squarederror", {}, fn);
    std::string model = save(b, fn);

    EastType *payload_t = case_type(out, "xgboost_regressor", fn);
    StructBuilder s(payload_t, fn);
    s.set("data", blob(model.data(), model.size()));
    s.set("n_features", east_integer(static_cast<int64_t>(X.cols)));
    set_categorical(s, payload_t, c, fn);
    return eval_ok(variant(out, "xgboost_regressor", s.build()));
}

EvalResult train_classifier(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "xgboost_train_classifier";
    if (num_args != 3) throw Error(msg(fn, "takes X, y and a config"));
    Dense X = dense(args[0], fn);
    std::vector<int64_t> y = vector_integers(args[1], fn);
    check_rows(X, y.size(), fn);
    /* The library takes contiguous labels from 0; the originals ride in the
     * blob so predictions map back. */
    std::set<int64_t> distinct(y.begin(), y.end());
    std::vector<int64_t> classes(distinct.begin(), distinct.end());
    std::map<int64_t, float> index;
    for (size_t i = 0; i < classes.size(); i++)
        index[classes[i]] = static_cast<float>(i);
    std::vector<float> labels;
    labels.reserve(y.size());
    for (int64_t v : y)
        labels.push_back(index[v]);
    std::vector<float> weights = sample_weight(args[2], X.rows, fn);
    Categorical c = categorical_config(args[2], fn);
    encode_categorical(X, c, fn, true);
    Params p = params(args[2], fn, true);
    if (classes.size() < 2)
        throw Error(msg(fn, "Training failed with X shape " + shape(X) +
                                " - y holds fewer than two classes"));
    std::vector<std::pair<std::string, std::string> > extra;
    const char *objective = "binary:logistic";
    if (classes.size() > 2) {
        objective = "multi:softprob";
        extra.emplace_back("num_class", std::to_string(classes.size()));
    }
    Booster b = train(X, labels, weights, c, p, objective, extra, fn);
    if (XGBoosterSetAttr(b.h, "east_classes", classes_json(classes).c_str()) != 0)
        throw Error(msg(fn, "Training failed with X shape " + shape(X) + " - " + last_error()));
    std::string model = save(b, fn);

    EastType *payload_t = case_type(out, "xgboost_classifier", fn);
    StructBuilder s(payload_t, fn);
    s.set("data", blob(model.data(), model.size()));
    s.set("n_features", east_integer(static_cast<int64_t>(X.cols)));
    s.set("n_classes", east_integer(static_cast<int64_t>(classes.size())));
    set_categorical(s, payload_t, c, fn);
    return eval_ok(variant(out, "xgboost_classifier", s.build()));
}

EvalResult train_quantile(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "xgboost_train_quantile";
    if (num_args != 3) throw Error(msg(fn, "takes X, y and a config"));
    Dense X = dense(args[0], fn);
    std::vector<double> y = vector_floats(args[1], fn);
    check_rows(X, y.size(), fn);
    std::vector<double> quantiles = vector_floats(field(args[2], "quantiles", fn), fn);
    for (double q : quantiles)
        if (!(q > 0 && q < 1))
            throw Error(msg(fn, "Quantiles must be in (0, 1), got " + python_float(q)));
    std::vector<float> labels(y.begin(), y.end());
    std::vector<float> weights = sample_weight(args[2], X.rows, fn);
    Categorical c = categorical_config(args[2], fn);
    encode_categorical(X, c, fn, true);
    Params p = params(args[2], fn, false);

    /* One model per distinct quantile, the last training of a quantile given
     * twice; kept in ascending order, which prediction answers in. */
    std::map<double, std::string> by_quantile;
    for (double q : quantiles) {
        Booster b = train(X, labels, weights, c, p, "reg:quantileerror",
                          {{"quantile_alpha", number(q)}}, fn);
        by_quantile[q] = save(b, fn);
    }
    std::vector<QuantileModel> models;
    for (auto &[q, model] : by_quantile)
        models.push_back({q, std::move(model)});
    std::string packed = pack_quantiles(models);

    EastType *payload_t = case_type(out, "xgboost_quantile", fn);
    StructBuilder s(payload_t, fn);
    s.set("data", blob(packed.data(), packed.size()));
    s.set("quantiles", float_vector(quantiles));
    s.set("n_features", east_integer(static_cast<int64_t>(X.cols)));
    set_categorical(s, payload_t, c, fn);
    return eval_ok(variant(out, "xgboost_quantile", s.build()));
}

EvalResult predict_values(EastValue **args, size_t num_args, EastType *out)
{
    (void)out;
    const char *fn = "xgboost_predict";
    if (num_args != 2) throw Error(msg(fn, "takes a model and X"));
    EastValue *blob_value = expect_case(args[0], "xgboost_regressor", fn);
    refuse_legacy(blob_bytes(field(blob_value, "data", fn), fn), fn);
    Dense X = dense(args[1], fn);
    Categorical c = categorical_config(blob_value, fn);
    encode_categorical(X, c, fn, false);
    Booster b = load(blob_bytes(field(blob_value, "data", fn), fn), X, fn);
    size_t columns = 0;
    std::vector<double> pred = predict(b, X, c, &columns, fn);
    pred.resize(X.rows);
    return eval_ok(float_vector(pred));
}

/* A classifier's class probabilities, one row per sample. */
std::vector<double> probabilities(const Booster &b, const Dense &X, const Categorical &c,
                                  size_t *classes, const char *fn)
{
    size_t columns = 0;
    std::vector<double> pred = predict(b, X, c, &columns, fn);
    if (columns == 1) {
        /* binary:logistic answers the positive class's probability. */
        std::vector<double> both(X.rows * 2);
        for (size_t r = 0; r < X.rows; r++) {
            both[r * 2] = 1.0 - pred[r];
            both[r * 2 + 1] = pred[r];
        }
        *classes = 2;
        return both;
    }
    *classes = columns;
    return pred;
}

EvalResult predict_class(EastValue **args, size_t num_args, EastType *out)
{
    (void)out;
    const char *fn = "xgboost_predict_class";
    if (num_args != 2) throw Error(msg(fn, "takes a model and X"));
    EastValue *blob_value = expect_case(args[0], "xgboost_classifier", fn);
    refuse_legacy(blob_bytes(field(blob_value, "data", fn), fn), fn);
    Dense X = dense(args[1], fn);
    Categorical c = categorical_config(blob_value, fn);
    encode_categorical(X, c, fn, false);
    Booster b = load(blob_bytes(field(blob_value, "data", fn), fn), X, fn);
    std::vector<int64_t> classes = classes_of(b, fn);
    size_t columns = 0;
    std::vector<double> proba = probabilities(b, X, c, &columns, fn);
    std::vector<int64_t> labels(X.rows);
    for (size_t r = 0; r < X.rows; r++) {
        size_t best = 0;
        if (columns == 2 && classes.size() == 2) {
            best = proba[r * 2 + 1] > 0.5 ? 1 : 0;
        } else {
            for (size_t k = 1; k < columns; k++)
                if (proba[r * columns + k] > proba[r * columns + best]) best = k;
        }
        labels[r] = best < classes.size() ? classes[best] : static_cast<int64_t>(best);
    }
    return eval_ok(integer_vector(labels));
}

EvalResult predict_proba(EastValue **args, size_t num_args, EastType *out)
{
    (void)out;
    const char *fn = "xgboost_predict_proba";
    if (num_args != 2) throw Error(msg(fn, "takes a model and X"));
    EastValue *blob_value = expect_case(args[0], "xgboost_classifier", fn);
    refuse_legacy(blob_bytes(field(blob_value, "data", fn), fn), fn);
    Dense X = dense(args[1], fn);
    Categorical c = categorical_config(blob_value, fn);
    encode_categorical(X, c, fn, false);
    Booster b = load(blob_bytes(field(blob_value, "data", fn), fn), X, fn);
    size_t columns = 0;
    std::vector<double> proba = probabilities(b, X, c, &columns, fn);
    return eval_ok(float_matrix(X.rows, columns, proba));
}

EvalResult predict_quantile(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "xgboost_predict_quantile";
    if (num_args != 2) throw Error(msg(fn, "takes a model and X"));
    EastValue *blob_value = expect_case(args[0], "xgboost_quantile", fn);
    refuse_legacy(blob_bytes(field(blob_value, "data", fn), fn), fn);
    Dense X = dense(args[1], fn);
    Categorical c = categorical_config(blob_value, fn);
    encode_categorical(X, c, fn, false);
    std::vector<QuantileModel> models =
        unpack_quantiles(blob_bytes(field(blob_value, "data", fn), fn), fn);
    std::vector<double> quantiles;
    std::vector<double> predictions(X.rows * models.size());
    for (size_t i = 0; i < models.size(); i++) {
        quantiles.push_back(models[i].quantile);
        Booster b = load(models[i].model, X, fn);
        size_t columns = 0;
        std::vector<double> pred = predict(b, X, c, &columns, fn);
        for (size_t r = 0; r < X.rows; r++)
            predictions[r * models.size() + i] = pred[r * columns];
    }
    StructBuilder s(out, fn);
    s.set("quantiles", float_vector(quantiles));
    s.set("predictions", float_matrix(X.rows, models.size(), predictions));
    return eval_ok(s.build());
}

/* xgboost_resave: the blob's data in the UBJSON form, as the library writes it
 * again; the other fields kept. A pre-UBJSON blob (a cloudpickle) is refused
 * here: the python runner alone reads one. */
EvalResult resave(EastValue **args, size_t num_args, EastType *out)
{
    const char *fn = "xgboost_resave";
    if (num_args != 1) throw Error(msg(fn, "takes a model"));
    const char *tag = case_of(args[0], fn);
    EastValue *blob_value = payload(args[0]);
    std::string_view bytes = blob_bytes(field(blob_value, "data", fn), fn);
    if (is_legacy_pickle(bytes))
        throw Error(msg(fn, "the model blob is from before the UBJSON form (a cloudpickle), which "
                            "only the python runner reads: re-save it there"));
    std::string data;
    if (std::strcmp(tag, "xgboost_quantile") == 0) {
        std::vector<QuantileModel> models = unpack_quantiles(bytes, fn);
        for (QuantileModel &m : models)
            m.model = save(load_model(m.model, fn), fn);
        data = pack_quantiles(models);
    } else {
        data = save(load_model(bytes, fn), fn);
    }
    EastType *payload_t = case_type(out, tag, fn);
    StructBuilder s(payload_t, fn);
    size_t n = blob_value->data.struct_.num_fields;
    for (size_t k = 0; k < n; k++) {
        const char *name = east_struct_field_name(blob_value, k);
        if (!name) continue;
        if (std::strcmp(name, "data") == 0) {
            s.set("data", blob(data.data(), data.size()));
        } else {
            EastValue *v = east_struct_get_field_idx(blob_value, k);
            east_value_retain(v);
            s.set(name, v);
        }
    }
    return eval_ok(variant(out, tag, s.build()));
}

} // namespace

namespace east_ds
{

void register_xgboost(PlatformRegistry *reg)
{
    platform_registry_add(reg, "xgboost_train_regressor", &platform_call<train_regressor>, false);
    platform_registry_add(reg, "xgboost_train_classifier", &platform_call<train_classifier>, false);
    platform_registry_add(reg, "xgboost_train_quantile", &platform_call<train_quantile>, false);
    platform_registry_add(reg, "xgboost_predict", &platform_call<predict_values>, false);
    platform_registry_add(reg, "xgboost_predict_class", &platform_call<predict_class>, false);
    platform_registry_add(reg, "xgboost_predict_proba", &platform_call<predict_proba>, false);
    platform_registry_add(reg, "xgboost_predict_quantile", &platform_call<predict_quantile>, false);
    platform_registry_add(reg, "xgboost_resave", &platform_call<resave>, false);
}

} // namespace east_ds
