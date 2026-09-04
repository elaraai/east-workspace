"""An example Python platform function owned by the ``__PACKAGE_NAME__`` package.

Platform functions let East call NATIVE Python (numpy, pandas, scikit-learn, …)
that East itself can't express. The ``@East.platform_function`` is bound to
East by its dotted ``"__PACKAGE_NAME__.<fn>"`` name, which the TypeScript
declaration in ``src/packages/__PACKAGE_NAME__.ts`` mirrors exactly — keep the
two in lockstep. A python-authored East body (``functions.py``) needs no
declaration: the decorated function is callable inside one directly. Add
native dependencies to this package's ``pyproject.toml`` and import them
inside the body.
"""

from east import ArrayType, East, FloatType


@East.platform_function(
    inputs=[ArrayType(FloatType)],
    output=FloatType,
    name="__PACKAGE_NAME__.example",
)
def example(values):
    """Example: the mean of a list of floats. Replace with your own logic."""
    values = list(values)
    return sum(values) / len(values) if values else 0.0


# The platform functions defined in THIS module, in definition order.
example_impl = East.platform_functions(__name__)
