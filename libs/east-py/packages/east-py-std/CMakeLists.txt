# east-py-std currently has no native code — pure Python only.
#
# This CMakeLists is intentionally minimal so scikit-build-core has something
# to invoke. If/when native code lands here (e.g. a future pyx that binds to
# east-c-std for performance), restore the full pattern:
#   - FetchContent PCRE2
#   - add_subdirectory east-c, east-c-std
#   - find_package(Python COMPONENTS Interpreter Development.Module NumPy REQUIRED)
#   - file(GLOB *.pyx) → cythonize → Python_add_library
# (See packages/east-py/CMakeLists.txt for the full template.)
cmake_minimum_required(VERSION 3.18)
project(east_py_std_native LANGUAGES NONE)
