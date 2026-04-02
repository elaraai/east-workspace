#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Optuna platform functions for East.

Provides Bayesian optimization using Optuna's TPE sampler for East programs.
Supports general parameter optimization with mixed parameter types.
"""

import importlib.util
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from east.runtime.platform import PlatformFunction
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
from east.types.values import EastArray, EastStruct, EastVariant, is_east_variant

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

# Parameter space kind
ParamSpaceKindType = VariantType(
    [
        ("int", NullType),
        ("float", NullType),
        ("categorical", NullType),
        ("log_uniform", NullType),
    ]
)

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

# Named parameter (name + value pair)
NamedParamType = StructType(
    [
        ("name", StringType),
        ("value", ParamValueType),
    ]
)

# Optimization direction
OptimizationDirectionType = VariantType(
    [
        ("minimize", NullType),
        ("maximize", NullType),
    ]
)

# Pruner type
PrunerType = VariantType(
    [
        ("none", NullType),
        ("median", NullType),
        ("hyperband", NullType),
    ]
)

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

# Trial result
TrialResultType = StructType(
    [
        ("trial_id", IntegerType),
        ("params", ArrayType(NamedParamType)),
        ("score", FloatType),
    ]
)

# Study result
StudyResultType = StructType(
    [
        ("best_params", ArrayType(NamedParamType)),
        ("best_score", FloatType),
        ("trials", ArrayType(TrialResultType)),
    ]
)

# Objective function type
ObjectiveFunctionType = ArrayType(NamedParamType)  # Input type for the function


# ============================================================================
# Helper Functions
# ============================================================================


def _get_option(opt: EastVariant | None, default: Any) -> Any:
    """Extract value from Option variant, returning default if None."""
    if opt is None:
        return default
    if is_east_variant(opt) and opt.type == "some":
        return opt.value
    return default


def _get_enum_tag(variant: EastVariant) -> str:
    """Get tag name from enum-like variant."""
    if is_east_variant(variant):
        return variant.type
    raise RuntimeError(f"_get_enum_tag: Expected EastVariant, got {type(variant)}")



# Lazy import guard for optional dependency
_HAS_OPTUNA_SUPPORT = importlib.util.find_spec("optuna") is not None


def _check_optuna_support() -> None:
    """Check if optuna support is available."""
    if not _HAS_OPTUNA_SUPPORT:
        raise NotImplementedError(
            "Optuna support requires the 'optuna' extra. "
            "Add east-py-datascience[optuna] to your pyproject.toml dependencies."
        )


# ============================================================================
# Platform Function Implementation
# ============================================================================


def optuna_optimize_impl(
    search_space: EastArray,
    objective_fn: Callable[[EastArray], float],
    config: EastStruct,
) -> EastStruct:
    """Run Optuna optimization with East objective function.

    Args:
        search_space: Array of ParamSpace definitions
        objective_fn: East function that takes params and returns score
        config: Study configuration

    Returns:
        EastStruct with best_params, best_score, trials
    """
    _check_optuna_support()
    import optuna

    # Suppress Optuna's verbose logging
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # Parse config
    direction_variant = _get_option(config.get("direction"), None)
    direction = _get_enum_tag(direction_variant) if direction_variant else "minimize"

    n_trials = int(config["n_trials"])
    random_state = _get_option(config.get("random_state"), None)
    if random_state is not None:
        random_state = int(random_state)

    pruner_variant = _get_option(config.get("pruner"), None)
    pruner_name = _get_enum_tag(pruner_variant) if pruner_variant else "none"

    # Create pruner
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
    initial_params = _get_option(config.get("initial_params"), None)
    if initial_params is not None:
        init_dict = {}
        for param in initial_params:
            name = str(param["name"])
            value_variant = param["value"]
            init_dict[name] = value_variant.value
        study.enqueue_trial(init_dict)

    def wrapped_objective(trial: optuna.Trial) -> float:
        """Wrap Optuna trial to call East objective function."""
        params = _suggest_params_from_trial(trial, search_space)
        # Call the East function directly - it's a compiled Python callable
        return objective_fn(params)

    study.optimize(wrapped_objective, n_trials=n_trials, show_progress_bar=False)

    return _make_study_result(study)


def _suggest_params_from_trial(
    trial: "optuna.Trial",
    search_space: EastArray,
) -> EastArray:
    """Suggest parameters from Optuna trial based on search space."""
    params: list[EastStruct] = []

    for param_def in search_space:
        name = str(param_def["name"])
        kind_variant = param_def["kind"]
        kind = _get_enum_tag(kind_variant)

        if kind == "int":
            low = int(_get_option(param_def.get("low"), 1))
            high = int(_get_option(param_def.get("high"), 100))
            value = trial.suggest_int(name, low, high)
            params.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("int", value),
                    }
                )
            )

        elif kind == "float":
            low = float(_get_option(param_def.get("low"), 0.0))
            high = float(_get_option(param_def.get("high"), 1.0))
            value = trial.suggest_float(name, low, high)
            params.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("float", value),
                    }
                )
            )

        elif kind == "log_uniform":
            low = float(_get_option(param_def.get("low"), 1e-6))
            high = float(_get_option(param_def.get("high"), 1.0))
            value = trial.suggest_float(name, low, high, log=True)
            params.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("float", value),
                    }
                )
            )

        elif kind == "categorical":
            choices_arr = _get_option(param_def.get("choices"), None)
            if choices_arr is None:
                raise ValueError(f"categorical param {name} requires choices")

            # Extract Python values from EastVariant choices
            py_choices = []
            for choice in choices_arr:
                py_choices.append(choice.value)

            value = trial.suggest_categorical(name, py_choices)

            # Convert back to ParamValueType variant
            if isinstance(value, bool):
                params.append(
                    EastStruct(
                        {
                            "name": name,
                            "value": EastVariant("bool", value),
                        }
                    )
                )
            elif isinstance(value, int):
                params.append(
                    EastStruct(
                        {
                            "name": name,
                            "value": EastVariant("int", value),
                        }
                    )
                )
            elif isinstance(value, float):
                params.append(
                    EastStruct(
                        {
                            "name": name,
                            "value": EastVariant("float", value),
                        }
                    )
                )
            elif isinstance(value, str):
                params.append(
                    EastStruct(
                        {
                            "name": name,
                            "value": EastVariant("string", value),
                        }
                    )
                )

    return EastArray(NamedParamType, params)


def _make_study_result(study: "optuna.Study") -> EastStruct:
    """Convert Optuna study to East StudyResultType."""
    import optuna

    # Best params
    best_params = _params_to_east(study.best_params)

    # All completed trials
    trials: list[EastStruct] = []
    for trial in study.trials:
        if trial.state == optuna.trial.TrialState.COMPLETE:
            trials.append(
                EastStruct(
                    {
                        "trial_id": trial.number,
                        "params": EastArray(
                            NamedParamType, _params_to_east(trial.params)
                        ),
                        "score": float(trial.value),
                    }
                )
            )

    return EastStruct(
        {
            "best_params": EastArray(NamedParamType, best_params),
            "best_score": float(study.best_value),
            "trials": EastArray(TrialResultType, trials),
        }
    )


def _params_to_east(params: dict) -> list[EastStruct]:
    """Convert Python params dict to list of NamedParam."""
    result: list[EastStruct] = []
    for name, value in params.items():
        if isinstance(value, bool):
            result.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("bool", value),
                    }
                )
            )
        elif isinstance(value, int):
            result.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("int", value),
                    }
                )
            )
        elif isinstance(value, float):
            result.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("float", value),
                    }
                )
            )
        elif isinstance(value, str):
            result.append(
                EastStruct(
                    {
                        "name": name,
                        "value": EastVariant("string", value),
                    }
                )
            )
    return result


# ============================================================================
# Platform Function Registration
# ============================================================================

optuna_impl = [
    PlatformFunction(
        name="optuna_optimize",
        inputs=[
            ArrayType(ParamSpaceType),
            FunctionType([ArrayType(NamedParamType)], FloatType),
            OptunaStudyConfigType,
        ],
        output=StudyResultType,
        type="sync",
        fn=optuna_optimize_impl,
    ),
]


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
