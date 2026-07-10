"""The ``__PACKAGE_NAME__`` platform package — its own execution environment.

Everything under ``packages/python/__PACKAGE_NAME__`` is captured as ONE
environment when a task wired to it is exported. Editing this package changes
only its environment hash, so only the tasks that declare
``environment: { python: { project: "packages/python/__PACKAGE_NAME__" } }``
re-run — sibling packages are left untouched. That package boundary IS the
change-detection granularity.

``east-py run -p __PACKAGE_NAME__`` imports this package and reads the top-level
``platform`` list below. To add a function: create a module beside this file
(e.g. ``pricing.py``) ending with ``pricing_impl = platform_functions(__name__)``,
then import and spread it into ``platform``.
"""

from .example import example_impl

platform = [*example_impl]
