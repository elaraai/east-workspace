"""An example Python platform function owned by the ``__PACKAGE_NAME__`` package.

Platform functions let East call NATIVE Python (numpy, pandas, scikit-learn, …)
that East itself can't express. The ``@platform_function`` is bound to East by
its dotted ``"__PACKAGE_NAME__.<fn>"`` name, which the TypeScript declaration in
``src/packages/__PACKAGE_NAME__.ts`` mirrors exactly — keep the two in lockstep.
Add native dependencies to this package's ``pyproject.toml`` and import them
inside the body.
"""

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, FloatType


@platform_function(
    inputs=[ArrayType(FloatType)],
    output=FloatType,
    name="__PACKAGE_NAME__.example",
)
def example(values):
    """Example: the mean of a list of floats. Replace with your own logic."""
    values = list(values)
    return sum(values) / len(values) if values else 0.0


# The platform functions defined in THIS module, in definition order.
example_impl = platform_functions(__name__)
