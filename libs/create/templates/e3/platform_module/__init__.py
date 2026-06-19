"""Project-owned platform functions, callable from this project's East code.

`east-py run -p platform_module` imports this package and reads its top-level
``platform`` list. Each ``@platform_function`` is bound to East by its dotted
``"<project>.<fn>"`` name, which the TypeScript declaration in
``src/platform_module.ts`` mirrors exactly — keep the two in lockstep.

Add native-Python dependencies (numpy, pandas, scikit-learn, …) to
``pyproject.toml`` and import them inside the function body; `uv sync` installs
them into this project's ``.venv``, from which the bare ``east-py`` runner
resolves.
"""

from east.runtime.platform import platform_function, platform_functions
from east.types.types import ArrayType, FloatType


@platform_function(
    inputs=[ArrayType(FloatType)],
    output=FloatType,
    name="__PROJECT_NAME__.forecast_demand",
)
def forecast_demand(history):
    """Forecast next-period demand as the mean of recent history."""
    values = list(history)
    return sum(values) / len(values) if values else 0.0


# What `east-py run -p platform_module` loads: the platform functions declared
# above, in definition order.
platform = platform_functions(__name__)
