"""An East function owned by the ``__PACKAGE_NAME__`` package — East all the way down.

``example.py`` is the other way across the language boundary: a platform
function wraps NATIVE python that East cannot express, and the task calling it
runs on east-py with this package installed. An East function is authored in
python but built with east-py's ``East.function``, so it IS East IR: the app's
TypeScript task refers to it by package, name and type
(``East.importFunction("__PACKAGE_NAME__", "scale", …)`` in
``src/packages/__PACKAGE_NAME__.ts``), and at export e3 finds this package in
the uv workspace, exports every function in ``east_functions`` (``east-py
export-functions``) and embeds the IR in the task. The deployed program is pure
IR — it runs on ANY runner, the default east-node one included, with no python
at run time and nothing installed where it runs.

To add a function: build it here (or in a module beside this one) and add it to
``east_functions`` in ``__init__.py`` under the name the app imports. The app
declares the same type with ``FunctionType([...], Out)`` — the two must be equal
exactly, and e3 checks that at export.
"""

from east import ArrayType, East, FloatType

# Scale every value by a factor. The parameters are East expressions and `.map`
# builds East IR — nothing here runs in python.
scale = East.function(
    [ArrayType(FloatType), FloatType],
    ArrayType(FloatType),
    lambda b, values, factor: values.map(lambda b, v: v * factor),
)
