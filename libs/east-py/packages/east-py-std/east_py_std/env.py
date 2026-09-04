#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""Environment platform functions for East.

Provides read access to process environment variables for East programs
running in Python. Mirrors east-node-std's ``Env`` module (same platform
names and types), so the same IR runs on either runtime.

This is the supported way to consume credentials in East programs: the IR
carries only the variable *name*, and whatever launched the process supplies
the value. East IR is content-addressed, stored, exported, and replicated -
a literal secret compiled into it is effectively unredactable.
"""

import os

from east.runtime.platform import platform_function, platform_functions
from east.types.types import OptionType, StringType
from east.types.values import EastVariant


@platform_function(name="env_get", inputs=[StringType], output=OptionType(StringType))
def env_get(name: str) -> EastVariant:
    """Read an environment variable from the process environment.

    Impure by design (like ``time_now``): the value is read at runtime and is
    never part of the compiled program or task input hashing, which is the
    desired semantics for credentials - rotating a secret does not invalidate
    caches.

    Args:
        name: ``String`` (``str``) - the environment variable name
            (e.g., ``"ERP_DB_PASSWORD"``).

    Returns:
        ``Option<String>`` (``EastVariant``) - ``some(value)`` if the variable
        is set (including when set to the empty string), ``none`` otherwise.
    """
    value = os.environ.get(name)
    return EastVariant("none", None) if value is None else EastVariant("some", value)


# Collected from the @platform_function decorations above.
env_impl = platform_functions(__name__)


__all__ = [
    "env_impl",
    "env_get",
]
