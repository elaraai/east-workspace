#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Helpers shared by every east_py_datascience module.

Blob serialisation, the optional-extra guard, the small East option/variant
readers the implementations use at the boundary, and the warning filter that
keeps chatty ML libraries quiet inside a platform function.
"""

from __future__ import annotations

import importlib.util
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from east.types.values import EastBlob, EastVariant


def serialize(obj: Any) -> EastBlob:
    """Cloudpickle ``obj`` (a model, explainer, or fitted transformer) into an East ``Blob``."""
    import cloudpickle

    return EastBlob(cloudpickle.dumps(obj))


def deserialize(blob: EastBlob) -> Any:
    """Load an object serialised by :func:`serialize`."""
    import cloudpickle

    return cloudpickle.loads(bytes(blob))


def extra_guard(module: str, extra: str, label: str) -> Callable[[], None]:
    """Build a module's ``_check_<name>_support()`` guard for an optional extra.

    The ``find_spec`` probe runs once, when the calling module loads (layer 1
    of ``PYTHON_OPTIONAL_DEPS.md``); the returned function is what every
    platform function calls first, raising ``NotImplementedError`` that names
    the extra to install.

    Args:
        module: The importable module the extra provides (``"xgboost"``).
        extra: The extras group in ``pyproject.toml`` (``"google-or"``).
        label: How the message refers to the capability (``"XGBoost"``).

    Returns:
        A zero-argument guard to call at the top of each implementation.
    """
    available = importlib.util.find_spec(module) is not None
    message = (
        f"{label} support requires the '{extra}' extra. "
        f"Add east-py-datascience[{extra}] to your pyproject.toml dependencies."
    )

    def check() -> None:
        if not available:
            raise NotImplementedError(message)

    return check


def option_tag(opt: EastVariant, default: str) -> str:
    """The case name of an ``Option<Variant>`` config field, or ``default`` when it is ``none``."""
    inner = opt.unwrap_or(None)
    return default if inner is None else inner.type


def expect_case(value: EastVariant, tag: str, func_name: str) -> Any:
    """The payload of ``value`` when its case is ``tag``; a named ``RuntimeError`` otherwise.

    The model-blob guard every predict function opens with. The message names
    the platform function and both cases; the spec corpus pins that wording.
    """
    if value.type != tag:
        raise RuntimeError(f"{func_name}: Expected {tag}, got {value.type}")
    return value.value


@contextmanager
def quiet_warnings() -> Iterator[None]:
    """Silence the advisory warnings ML libraries emit on every fit and predict.

    Scoped to the block: ``UserWarning`` (sklearn convergence, xgboost and
    torch notes) and ``FutureWarning`` are dropped, while ``RuntimeWarning``
    and ``DeprecationWarning`` keep Python's default handling so a numerical
    problem or a library deprecation stays visible.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        warnings.simplefilter("ignore", FutureWarning)
        yield


__all__ = [
    "serialize",
    "deserialize",
    "extra_guard",
    "option_tag",
    "expect_case",
    "quiet_warnings",
]
