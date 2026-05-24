# east-py-io currently has no native code — pure Python only.
#
# This CMakeLists is a placeholder so scikit-build-core has something to
# invoke. If/when native code lands here (e.g. an accelerated XLSX/Parquet
# decoder linked against east-c), restore the full pattern from
# packages/east-py-std/CMakeLists.txt.
cmake_minimum_required(VERSION 3.18)
project(east_py_io_native LANGUAGES NONE)
