#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python ordering on decoded options — it raises."""
from east import BooleanType, East, IntegerType, OptionType, some


@East.platform_function(inputs=[OptionType(IntegerType)], output=BooleanType)
def later(o):
    return o > some(1)  # expect: no-host-comparison-on-east-values


held = some(3)
ordered = held < some(4)  # expect: no-host-comparison-on-east-values
