"""An example project-owned Python platform function — replace it with your own.

Platform functions let East call NATIVE Python (numpy, pandas, scikit-learn, …)
that East itself can't express. The ``@platform_function`` is bound to East by
its dotted ``"<project>.<fn>"`` name, which the TypeScript declaration in
``src/platform_module.ts`` mirrors exactly — keep the two in lockstep. Add
native dependencies to ``pyproject.toml`` and import them inside the body.

This module ends by collecting its functions into ``example_impl`` (the
canonical east-py idiom — ``platform_functions`` keys the registry on each
function's ``__module__``), which ``__init__.py`` spreads into the package's
top-level ``platform`` list.
"""

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, FloatType


@platform_function(
    inputs=[ArrayType(FloatType)],
    output=FloatType,
    name="__PROJECT_NAME__.example_python",
)
def example_python(values):
    """Example: the mean of a list of floats. Replace with your own logic."""
    values = list(values)
    return sum(values) / len(values) if values else 0.0


# The platform functions defined in THIS module, in definition order.
example_impl = platform_functions(__name__)
