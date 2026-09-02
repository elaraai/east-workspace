#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
# ruff: noqa
"""Python work inside an eager callback: the capture refuses these names before the body runs."""
import math
from math import floor

import numpy as np
from numpy import floor as np_floor

from east import EastArray, IntegerType


def work(v):
    return math.floor(v)


def through(v):
    return work(v) + 1


items = EastArray(IntegerType, [1, 2, 3])
lookup = EastArray(IntegerType, [10, 20, 30])
floored = items.map(lambda b, v: math.floor(v))  # expect: no-python-work
floored_by_name = items.map(lambda b, v: floor(v))  # expect: no-python-work
np_floored = items.map(lambda b, v: np_floor(v))  # expect: no-python-work
absolute = items.map(lambda b, v: np.abs(v))  # expect: no-python-work
worked = items.map(lambda b, v: work(v))  # expect: no-python-work
indirect = items.map(lambda b, v: through(v))  # expect: no-python-work
largest = items.map(lambda b, v: max(v, 1))  # expect: no-python-work
sized = items.map(lambda b, v: v + len("abc"))  # expect: no-python-work
typed = items.map(lambda b, v: 1 if isinstance(v, int) else 2)  # expect: no-python-work
looked_up = items.map(lambda b, v: lookup.get(0) + v)  # expect: no-python-work
