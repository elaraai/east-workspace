#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Platform function definitions for East runtime.

Platform functions are the bridge between East IR and the host environment (Python).
They allow East code to call native Python functions (sync or async).
"""

from collections.abc import Callable
from typing import Any, Literal, TypedDict

from east.types.types import EastType


class PlatformFunction(TypedDict):
    """Represents a platform function callable from East IR.

    Platform functions are defined by the host environment and can be called
    from East IR using Platform nodes. They can be synchronous or asynchronous.

    Example:
        >>> log = PlatformFunction(
        ...     name="log",
        ...     inputs=[StringType],
        ...     output=NullType,
        ...     type='sync',
        ...     fn=print
        ... )
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    inputs: list[EastType]
    """Input parameter types"""

    output: EastType
    """Output/return type"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous (returns a coroutine)"""

    fn: Callable[..., Any]
    """The actual Python function implementation"""


class GenericPlatformFunction(TypedDict):
    """Generic platform function with type parameters.

    The `fn` field is a factory that receives type arguments and returns
    the actual implementation.

    Example:
        >>> alns = GenericPlatformFunction(
        ...     name="alns_optimize",
        ...     type_parameters=["S"],
        ...     type='sync',
        ...     fn=lambda S: alns_optimize_impl,
        ... )
    """

    name: str
    """The name of the platform function (must match Platform IR node name)"""

    type_parameters: list[str]
    """Type parameter names (e.g., ["S", "T"])"""

    type: Literal["sync", "async"]
    """Whether the function is synchronous or asynchronous"""

    fn: Callable[..., Callable[..., Any]]
    """Factory: fn(*type_params) -> impl where impl(*args) -> result"""


__all__ = ["PlatformFunction", "GenericPlatformFunction"]
