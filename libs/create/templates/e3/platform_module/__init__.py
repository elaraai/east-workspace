"""Project-owned Python platform functions, aggregated for the east-py runner.

`east-py run -p platform_module` imports this package and reads the top-level
``platform`` list below. This mirrors how the first-party east-py-std /
east-py-datascience packages are built: each submodule ends with
``<name>_impl = platform_functions(__name__)``, and this file spreads them all
into ``platform``.

To add a function: create a module beside this file (e.g. ``pricing.py``) ending
with ``pricing_impl = platform_functions(__name__)``, then add an import and
spread it into ``platform`` below.
"""

from .example import example_impl

platform = [*example_impl]
