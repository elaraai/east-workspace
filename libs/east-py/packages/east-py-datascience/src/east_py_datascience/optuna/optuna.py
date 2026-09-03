#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Optuna platform functions for East.

Provides Bayesian optimization using Optuna's TPE sampler for East programs.
Supports general parameter optimization with mixed parameter types.
"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from east import variant
from east.runtime.platform import platform_function, platform_functions
from east.types.types import (
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
)
from east.types.values import EastArray, EastStruct

from east_py_datascience._common import extra_guard, option_tag

if TYPE_CHECKING:
    import optuna

# ============================================================================
# Type Definitions
# ============================================================================

# Parameter value type (can be int, float, string, or bool)
ParamValueType = VariantType(
    [
        ("int", IntegerType),
        ("float", FloatType),
        ("string", StringType),
        ("bool", BooleanType),
    ]
)
"""A single parameter value suggested by the TPE sampler.

Cases: ``int`` (``Integer``), ``float`` (``Float``), ``string``
(``String``), ``bool`` (``Boolean``).
"""

# Parameter space kind
ParamSpaceKindType = VariantType(
    [
        ("int", NullType),
        ("float", NullType),
        ("categorical", NullType),
        ("log_uniform", NullType),
    ]
)
"""Sampling distribution kind for a search-space parameter.

Cases: ``int`` (uniform integer in ``[low, high]``), ``float`` (uniform
float), ``log_uniform`` (log-uniform float, useful for learning rates),
``categorical`` (discrete choice from ``choices``).
"""

# Parameter search space definition
ParamSpaceType = StructType(
    [
        ("name", StringType),
        ("kind", ParamSpaceKindType),
        ("low", OptionType(FloatType)),
        ("high", OptionType(FloatType)),
        ("choices", OptionType(ArrayType(ParamValueType))),
    ]
)
"""Definition of one parameter's search space.

Fields: ``name`` (parameter name passed to the objective), ``kind``
(sampling distribution), ``low`` (lower bound for ``int`` (default 1),
``float`` (default 0.0), or ``log_uniform`` (default 1e-6)),
``high`` (upper bound for ``int`` (default 100), ``float`` (default 1.0),
or ``log_uniform`` (default 1.0)), ``choices`` (discrete candidates for
``categorical`` parameters, each a ``ParamValueType`` variant).
"""

# Named parameter (name + value pair)
NamedParamType = StructType(
    [
        ("name", StringType),
        ("value", ParamValueType),
    ]
)
"""A name-value pair for one parameter in a trial.

Fields: ``name`` (``String``), ``value`` (``ParamValueType`` variant).
"""

# Optimization direction
OptimizationDirectionType = VariantType(
    [
        ("minimize", NullType),
        ("maximize", NullType),
    ]
)
"""Whether Optuna minimizes or maximizes the objective score.

Cases: ``minimize`` (default), ``maximize``.
"""

# Pruner type
PrunerType = VariantType(
    [
        ("none", NullType),
        ("median", NullType),
        ("hyperband", NullType),
    ]
)
"""Early-stopping pruner applied to intermediate trial values.

Cases: ``none`` (no pruning, default), ``median`` (prune below median of
previous trials at the same step), ``hyperband`` (successive halving with
a bracket schedule).
"""

# Study config
OptunaStudyConfigType = StructType(
    [
        ("direction", OptionType(OptimizationDirectionType)),
        ("n_trials", IntegerType),
        ("random_state", OptionType(IntegerType)),
        ("pruner", OptionType(PrunerType)),
        ("initial_params", OptionType(ArrayType(NamedParamType))),
    ]
)
"""Configuration for an Optuna TPE study.

Fields: ``direction`` (default ``minimize``), ``n_trials`` (number of
trials to run), ``random_state`` (TPE sampler seed),
``pruner`` (default ``none``), ``initial_params`` (warm-start point
enqueued as the first trial).
"""

# Trial result
TrialResultType = StructType(
    [
        ("trial_id", IntegerType),
        ("params", ArrayType(NamedParamType)),
        ("score", FloatType),
    ]
)
"""Result for one completed Optuna trial.

Fields: ``trial_id`` (``Integer`` Optuna trial number), ``params``
(``Array<NamedParamType>`` parameter values used), ``score`` (``Float``
objective value returned by the objective function).
"""

# Study result
StudyResultType = StructType(
    [
        ("best_params", ArrayType(NamedParamType)),
        ("best_score", FloatType),
        ("trials", ArrayType(TrialResultType)),
    ]
)
"""Outcome of a completed Optuna study.

Fields: ``best_params`` (``Array<NamedParamType>`` parameters of the best
trial), ``best_score`` (``Float`` objective at the best trial), ``trials``
(``Array<TrialResultType>`` all completed trials).
"""

# Objective function type
ObjectiveFunctionType = ArrayType(NamedParamType)  # Input type for the function


_check_optuna_support = extra_guard("optuna", "optuna", "Optuna")


# ============================================================================
# Platform Function Implementation
# ============================================================================


@platform_function(
    name="optuna_optimize",
    inputs=[
        ArrayType(ParamSpaceType),
        FunctionType([ArrayType(NamedParamType)], FloatType),
        OptunaStudyConfigType,
    ],
    output=StudyResultType,
)
def optuna_optimize_impl(
    search_space: EastArray,
    objective_fn: Callable[[EastArray], float],
    config: EastStruct,
) -> EastStruct:
    """Run Bayesian hyperparameter optimization using Optuna's TPE sampler.

    Creates an Optuna study, optionally warm-starts it from ``initial_params``,
    and runs ``n_trials`` trials by suggesting parameter values from the
    ``search_space`` and evaluating them with ``objective_fn``.

    Args:
        search_space: ``Array<ParamSpaceType>`` (``EastArray``) - one entry per
            parameter. Each ``ParamSpaceType`` is a struct:

            - ``name`` (``String``): parameter name passed to the objective.
            - ``kind`` (``ParamSpaceKindType``): ``int``, ``float``,
              ``log_uniform``, or ``categorical``.
            - ``low`` (``Option<Float>``): lower bound for ``int`` (default 1),
              ``float`` (default 0.0), or ``log_uniform`` (default 1e-6).
            - ``high`` (``Option<Float>``): upper bound for ``int``
              (default 100), ``float`` (default 1.0), or ``log_uniform``
              (default 1.0).
            - ``choices`` (``Option<Array<ParamValueType>>``): discrete
              candidates for ``categorical`` parameters; each choice is a
              ``ParamValueType`` variant (``int``, ``float``, ``string``, or
              ``bool``).

        objective_fn: ``Function<[Array<NamedParamType>], Float>`` (callable) -
            receives an ``Array<NamedParamType>`` where each element is a
            ``{name: String, value: ParamValueType}`` struct, and returns the
            score to optimize (minimize or maximize per ``config.direction``).
        config: ``OptunaStudyConfigType`` (``EastStruct``) with fields:

            - ``direction`` (``Option<OptimizationDirectionType>``):
              ``minimize`` (default) or ``maximize``.
            - ``n_trials`` (``Integer``): number of Optuna trials to run.
            - ``random_state`` (``Option<Integer>``): TPE sampler seed.
            - ``pruner`` (``Option<PrunerType>``): ``none`` (default),
              ``median``, or ``hyperband``.
            - ``initial_params`` (``Option<Array<NamedParamType>>``): warm-start
              point enqueued as the first trial.

    Returns:
        ``StudyResultType`` (``EastStruct``): ``best_params``
        (``Array<NamedParamType>``), ``best_score`` (``Float``), ``trials``
        (``Array<TrialResultType>`` - completed trials only, each with
        ``trial_id``, ``params``, and ``score``).

    Raises:
        NotImplementedError: the ``optuna`` extra is not installed.
        ValueError: a ``categorical`` parameter has no ``choices``.
    """
    _check_optuna_support()
    import optuna

    # Suppress Optuna's verbose logging
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # Parse config
    direction = option_tag(config["direction"], "minimize")
    n_trials = int(config["n_trials"])
    random_state = config["random_state"].unwrap_or(None)
    if random_state is not None:
        random_state = int(random_state)
    pruner_name = option_tag(config["pruner"], "none")

    # Create pruner
    pruner: optuna.pruners.BasePruner
    if pruner_name == "median":
        pruner = optuna.pruners.MedianPruner()
    elif pruner_name == "hyperband":
        pruner = optuna.pruners.HyperbandPruner()
    else:
        pruner = optuna.pruners.NopPruner()

    # Create sampler and study
    sampler = optuna.samplers.TPESampler(seed=random_state)
    study = optuna.create_study(direction=direction, sampler=sampler, pruner=pruner)

    # Enqueue initial params if provided (warm-start)
    initial_params = config["initial_params"].unwrap_or(None)
    if initial_params is not None:
        study.enqueue_trial({str(param["name"]): param["value"].value for param in initial_params})

    def wrapped_objective(trial: optuna.Trial) -> float:
        """Wrap Optuna trial to call East objective function."""
        params = _suggest_params_from_trial(trial, search_space)
        # Call the East function directly - it's a compiled Python callable
        return objective_fn(params)

    study.optimize(wrapped_objective, n_trials=n_trials, show_progress_bar=False)

    return _make_study_result(study)


def _named_param(name: str, value: Any) -> EastStruct:
    """A ``NamedParamType`` struct for a Python parameter value, tagged by its type."""
    if isinstance(value, bool):
        tag = "bool"
    elif isinstance(value, int):
        tag = "int"
    elif isinstance(value, float):
        tag = "float"
    elif isinstance(value, str):
        tag = "string"
    else:
        raise TypeError(f"optuna parameter {name!r} has an unsupported value {value!r}")
    return EastStruct({"name": name, "value": variant(tag, value, ParamValueType)})


def _suggest_params_from_trial(
    trial: "optuna.Trial",
    search_space: EastArray,
) -> EastArray:
    """Suggest one value per search-space parameter from the trial."""
    params: list[EastStruct] = []
    for param_def in search_space:
        name = str(param_def["name"])
        kind = param_def["kind"].type
        value: Any
        if kind == "int":
            value = trial.suggest_int(
                name, int(param_def["low"].unwrap_or(1)), int(param_def["high"].unwrap_or(100))
            )
        elif kind == "float":
            value = trial.suggest_float(
                name, float(param_def["low"].unwrap_or(0.0)), float(param_def["high"].unwrap_or(1.0))
            )
        elif kind == "log_uniform":
            value = trial.suggest_float(
                name,
                float(param_def["low"].unwrap_or(1e-6)),
                float(param_def["high"].unwrap_or(1.0)),
                log=True,
            )
        elif kind == "categorical":
            choices = param_def["choices"].unwrap_or(None)
            if choices is None:
                raise ValueError(f"categorical param {name} requires choices")
            value = trial.suggest_categorical(name, [choice.value for choice in choices])
        else:
            raise ValueError(f"unknown parameter kind {kind!r} for {name}")
        params.append(_named_param(name, value))
    return EastArray(NamedParamType, params)


def _make_study_result(study: "optuna.Study") -> EastStruct:
    """Convert Optuna study to East StudyResultType."""
    import optuna

    # Best params
    best_params = _params_to_east(study.best_params)

    # All completed trials (a completed single-objective trial always carries a value)
    trials: list[EastStruct] = [
        EastStruct(
            {
                "trial_id": trial.number,
                "params": EastArray(NamedParamType, _params_to_east(trial.params)),
                "score": float(trial.value),
            }
        )
        for trial in study.trials
        if trial.state == optuna.trial.TrialState.COMPLETE and trial.value is not None
    ]

    return EastStruct(
        {
            "best_params": EastArray(NamedParamType, best_params),
            "best_score": float(study.best_value),
            "trials": EastArray(TrialResultType, trials),
        }
    )


def _params_to_east(params: dict) -> list[EastStruct]:
    """Optuna's ``{name: value}`` params as a list of ``NamedParamType`` structs."""
    return [_named_param(name, value) for name, value in params.items()]


# ============================================================================
# Platform Function Registration
# ============================================================================

optuna_impl = platform_functions(__name__)


__all__ = [
    "optuna_impl",
    "ParamValueType",
    "ParamSpaceKindType",
    "ParamSpaceType",
    "NamedParamType",
    "OptimizationDirectionType",
    "PrunerType",
    "OptunaStudyConfigType",
    "TrialResultType",
    "StudyResultType",
]
