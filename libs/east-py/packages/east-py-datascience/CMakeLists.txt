# east-py-datascience native build — driven by scikit-build-core via pyproject.toml.
#
# Compiles the 2 .pyx files under src/east_py_datascience/ into Python
# extension modules, links them against east-c (built fresh via
# add_subdirectory).
#
# Mirrors packages/east-py/CMakeLists.txt — same monorepo-walk + PCRE2
# fetch + east-c build pattern. The only differences are the source
# directory layout (src/east_py_datascience/ vs east/) and the smaller
# .pyx file set.
cmake_minimum_required(VERSION 3.18)
project(east_py_datascience_native LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ────────────────────────────────────────────────────────────────────────
# Resolve native sources. Dev builds run inside the monorepo (sibling
# libs/east-c + east-py). Packaged builds — a PyPI sdist or a cibuildwheel
# container — have no monorepo, so fall back to the copies staged under
# _vendor/ by scripts/vendor-native.py.
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
    get_filename_component(EAST_PY_PXD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../east-py" ABSOLUTE)
else()
    set(EAST_C_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_vendor/east-c")
    set(EAST_PY_PXD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/_vendor/east-py")
endif()
if(NOT EXISTS "${EAST_C_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
        "east-c source not found at ${EAST_C_DIR}. For a packaged build run "
        "scripts/vendor-native.py --package <this package> first.")
endif()
if(NOT EXISTS "${EAST_PY_PXD_DIR}/east/_eastc.pxd")
    message(FATAL_ERROR
        "east-py .pxd not found at ${EAST_PY_PXD_DIR}/east/. For a packaged "
        "build run scripts/vendor-native.py --with-east-py-pxd first.")
endif()
message(STATUS "east-c source: ${EAST_C_DIR}")
message(STATUS "east-py .pxd:  ${EAST_PY_PXD_DIR}")

# ────────────────────────────────────────────────────────────────────────
# Native deps: PCRE2 (required by east-c) + east-c.
# ────────────────────────────────────────────────────────────────────────
include(FetchContent)
FetchContent_Declare(
    pcre2
    URL https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz
    URL_HASH SHA256=86b9cb0aa3bcb7994faa88018292bc704cdbb708e785f7c74352ff6ea7d3175b
    EXCLUDE_FROM_ALL
)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_UNICODE ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(pcre2)

set(EAST_USE_MIMALLOC OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

add_subdirectory(
    ${EAST_C_DIR}
    ${CMAKE_BINARY_DIR}/_deps/east-c
    EXCLUDE_FROM_ALL
)

# ────────────────────────────────────────────────────────────────────────
# Python + NumPy + Cython
# ────────────────────────────────────────────────────────────────────────
find_package(Python COMPONENTS Interpreter Development.Module NumPy REQUIRED)

execute_process(
    COMMAND ${Python_EXECUTABLE} -c "import cython; print(cython.__version__)"
    OUTPUT_VARIABLE CYTHON_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
    RESULT_VARIABLE _cython_check
)
if(NOT _cython_check EQUAL 0)
    message(FATAL_ERROR "Cython is required but not importable from ${Python_EXECUTABLE}")
endif()

# ────────────────────────────────────────────────────────────────────────
# Compile each .pyx into a Python extension.
# ────────────────────────────────────────────────────────────────────────
set(PACKAGE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/east_py_datascience")

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
                --include-dir "${EAST_PY_PXD_DIR}"
                --include-dir "${PACKAGE_DIR}"
                "${pyx}" -o "${c_file}"
        DEPENDS ${pyx}
        COMMENT "Cythonize east_py_datascience/${install_subdir}/${name}.pyx"
        VERBATIM
    )

    Python_add_library(${name} MODULE WITH_SOABI ${c_file})
    target_include_directories(${name} PRIVATE
        ${EAST_C_DIR}/include
        ${Python_NumPy_INCLUDE_DIRS}
        ${EAST_PY_PXD_DIR}
    )
    target_link_libraries(${name} PRIVATE east-c m)

    install(TARGETS ${name} LIBRARY DESTINATION "east_py_datascience/${install_subdir}")
endforeach()
