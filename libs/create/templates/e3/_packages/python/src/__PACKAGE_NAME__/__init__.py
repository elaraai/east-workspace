"""The ``__PACKAGE_NAME__`` package — its own execution environment, and both ways
of crossing the language boundary.

Everything under ``packages/python/__PACKAGE_NAME__`` is captured as ONE
environment when a task wired to it is exported: e3 derives it from the task's
``{ custom: "__PACKAGE_NAME__" }`` platform reference. Editing this package
changes only its environment hash, so only the tasks wired to it re-run —
sibling packages are left untouched. That package boundary IS the
change-detection granularity.

Two things cross from here into the app's TypeScript tasks:

- ``platform`` — the platform functions (``example.py``): NATIVE python that
  East cannot express. ``east-py run -p __PACKAGE_NAME__`` imports this package
  and reads the list. To add one: create a module beside this file (e.g.
  ``pricing.py``) ending with ``pricing_impl = platform_functions(__name__)``,
  then import and spread it into ``platform``.
- ``east_functions`` — the East functions (``functions.py``): East IR authored
  in python, imported by the app with ``East.importFunction`` and embedded at
  export, so they run on any runner with no python at run time. To add one:
  build it and add it here under the name the app imports.
"""

from .example import example_impl
from .functions import scale

platform = [*example_impl]

east_functions = {"scale": scale}
