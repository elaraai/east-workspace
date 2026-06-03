# east-py native build — driven by scikit-build-core via pyproject.toml.
#
# Compiles each .pyx under east/ into a Python extension module, links the
# *_eastc.pyx ones against east-c (built as a static lib via add_subdirectory).
#
# The pure-Python fallback modules (each .pyx has a sister .py with import
# shims) keep the package importable in environments where the .so is absent
# — they're shipped by the wheel automatically as part of the east/ package.
#
# Cross-package .pxd discovery: east-py installs its .pxd files into
# site-packages, so downstream packages (east-py-std, east-py-datascience)
# can `cimport east._eastc` directly via Cython's standard `sys.path`-based
# resolution. No `_build_info` shim required.
cmake_minimum_required(VERSION 3.18)
project(east_py_native LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ────────────────────────────────────────────────────────────────────────
# Resolve east-c source. Dev builds run inside the monorepo (sibling
# libs/east-c). Packaged builds — a PyPI sdist or a cibuildwheel container —
# have no monorepo, so fall back to the copy staged under _vendor/ by
# scripts/vendor-native.py.
# ────────────────────────────────────────────────────────────────────────
set(_search_dir "${CMAKE_CURRENT_LIST_DIR}")
while(NOT EXISTS "${_search_dir}/pnpm-workspace.yaml")
    get_filename_component(_parent "${_search_dir}" DIRECTORY)
    if(_parent STREQUAL _search_dir)
        set(_search_dir "")
        break()
    endif()
    set(_search_dir "${_parent}")
endwhile()

if(_search_dir)
    set(EAST_C_DIR "${_search_dir}/libs/east-c/packages/east-c")
else()
    set(EAST_C_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_vendor/east-c")
endif()
if(NOT EXISTS "${EAST_C_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
        "east-c source not found at ${EAST_C_DIR}. For a packaged build run "
        "scripts/vendor-native.py --package <this package> first.")
endif()
message(STATUS "east-c source: ${EAST_C_DIR}")

# ────────────────────────────────────────────────────────────────────────
# Native deps: PCRE2 (required by east-c) + east-c itself.
# ────────────────────────────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
    pcre2
    URL https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz
    URL_HASH SHA256=86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b
    EXCLUDE_FROM_ALL  # don't install pcre2 docs/man pages with the wheel
)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_UNICODE ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(pcre2)

# tidwall/btree.c — east-c's Set/Dict ordered store. east-py add_subdirectory's
# packages/east-c directly (not the monorepo root), so — like pcre2 above — it
# must declare btreec itself; packages/east-c links it. BTREE_NOATOMICS drops the
# copy-on-write stdatomic dependency (nodes are never shared across threads).
FetchContent_Declare(
    btreec
    GIT_REPOSITORY https://github.com/tidwall/btree.c.git
    GIT_TAG v0.6.4
)
FetchContent_GetProperties(btreec)
if(NOT btreec_POPULATED)
    FetchContent_Populate(btreec)
endif()
add_library(btreec STATIC ${btreec_SOURCE_DIR}/btree.c)
target_include_directories(btreec PUBLIC ${btreec_SOURCE_DIR})
target_compile_definitions(btreec PUBLIC BTREE_NOATOMICS)
if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(btreec PRIVATE -w)
endif()

# We disable mimalloc (Python has its own allocator) and east-c's tests.
set(EAST_USE_MIMALLOC OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

add_subdirectory(
    ${EAST_C_DIR}
    ${CMAKE_BINARY_DIR}/_deps/east-c
    EXCLUDE_FROM_ALL
)

# ────────────────────────────────────────────────────────────────────────
# Python + NumPy
# ────────────────────────────────────────────────────────────────────────
find_package(Python COMPONENTS Interpreter Development.Module NumPy REQUIRED)

# ────────────────────────────────────────────────────────────────────────
# Cython
# ────────────────────────────────────────────────────────────────────────
execute_process(
    COMMAND ${Python_EXECUTABLE} -c "import cython; print(cython.__version__)"
    OUTPUT_VARIABLE CYTHON_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _cython_check
)
if(NOT _cython_check EQUAL 0)
    message(FATAL_ERROR "Cython is required but not importable from ${Python_EXECUTABLE}")
endif()
message(STATUS "Cython: ${CYTHON_VERSION}")

# ────────────────────────────────────────────────────────────────────────
# Compile each .pyx into a Python extension module.
# Per-file compiler directives are embedded in the .pyx itself (e.g.
# `# cython: boundscheck=False, wraparound=False`). We pass include
# paths so cimports of east._eastc / east._eastc_bridge / east._platform_bridge
# resolve against the source tree at build time.
# ────────────────────────────────────────────────────────────────────────
set(PACKAGE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/east")

file(GLOB_RECURSE PYX_FILES CONFIGURE_DEPENDS "${PACKAGE_DIR}/*.pyx")

foreach(pyx ${PYX_FILES})
    get_filename_component(name ${pyx} NAME_WE)
    get_filename_component(rel_dir ${pyx} DIRECTORY)
    file(RELATIVE_PATH install_subdir "${PACKAGE_DIR}" ${rel_dir})

    set(c_file "${CMAKE_CURRENT_BINARY_DIR}/${install_subdir}/${name}.c")
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/${install_subdir}")

    add_custom_command(
        OUTPUT ${c_file}
        COMMAND ${Python_EXECUTABLE} -m cython -3
                --include-dir "${PACKAGE_DIR}"
                "${pyx}" -o "${c_file}"
        DEPENDS ${pyx}
        COMMENT "Cythonize east/${install_subdir}/${name}.pyx"
        VERBATIM
    )

    Python_add_library(${name} MODULE WITH_SOABI ${c_file})
    target_include_directories(${name} PRIVATE
        ${EAST_C_DIR}/include
        ${Python_NumPy_INCLUDE_DIRS}
        ${PACKAGE_DIR}
    )

    # _eastc and _eastc_bridge / _platform_bridge link against east-c.
    # _values_cy and _ordering_cy are pure Cython acceleration — no native
    # link needed (they only use Python C API + numpy).
    if(name MATCHES "_eastc|_bridge")
        target_link_libraries(${name} PRIVATE east-c)
    endif()
    # libm is part of the CRT on Windows/MSVC; link the separate libm elsewhere.
    if(NOT WIN32)
        target_link_libraries(${name} PRIVATE m)
    endif()

    install(TARGETS ${name} LIBRARY DESTINATION "east/${install_subdir}")
endforeach()
