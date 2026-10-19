# east-c-datascience — east-py-datascience's platform functions on the C
# runtime, family by family (the Google OR-Tools solvers, XGBoost), under one
# compliance suite: the IR east-py-datascience's specs export runs here too.
#
# Built when the root CMakeLists is configured with -DEAST_C_DATASCIENCE=ON.
# The implementations are C++17 (both libraries are C++); the surface the CLI
# and the compliance runner register through is C (include/).
#
# OR-Tools is linked from a prebuilt install — its release archives run to
# 55 MB per platform and its source build to most of an hour — as east-c-std
# links the system libcurl: scripts/fetch-ortools.sh puts the pinned release at
# build-deps/or-tools, which is looked in first, and any other install is named
# through CMAKE_PREFIX_PATH or ortools_DIR. XGBoost builds from its release
# archive under third_party/, CPU only, as a static library, so no build
# downloads anything.
cmake_minimum_required(VERSION 3.18)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── OR-Tools ──────────────────────────────────────────────────────────
set(EAST_ORTOOLS_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/../../build-deps/or-tools"
    CACHE PATH "Where scripts/fetch-ortools.sh installs the pinned OR-Tools release")
if(EXISTS "${EAST_ORTOOLS_PREFIX}/lib/cmake/ortools")
    list(APPEND CMAKE_PREFIX_PATH "${EAST_ORTOOLS_PREFIX}")
endif()
find_package(ortools CONFIG REQUIRED)
message(STATUS "east-c-datascience: OR-Tools ${ORTOOLS_VERSION} (${ortools_DIR})")

# ── XGBoost ───────────────────────────────────────────────────────────
set(EAST_XGBOOST_VERSION 3.2.0)
include(FetchContent)
FetchContent_Declare(
    xgboost
    URL "${CMAKE_CURRENT_SOURCE_DIR}/third_party/xgboost-src-${EAST_XGBOOST_VERSION}.tar.gz"
    URL_HASH SHA256=16a31dfbc0c54544c9c36ab5f696fa7b646c125f161c52c814d757a58241a404
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
set(BUILD_STATIC_LIB ON CACHE BOOL "" FORCE)
set(USE_OPENMP ON CACHE BOOL "" FORCE)
set(USE_CUDA OFF CACHE BOOL "" FORCE)
set(ADD_PKGCONFIG OFF CACHE BOOL "" FORCE)
set(BUILD_DEPRECATED_CLI OFF CACHE BOOL "" FORCE)
set(GOOGLE_TEST OFF CACHE BOOL "" FORCE)
set(USE_DMLC_GTEST OFF CACHE BOOL "" FORCE)
set(KEEP_BUILD_ARTIFACTS_IN_BINARY_DIR ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(xgboost)
# Third-party sources build with their own warning set, not east-c's.
foreach(_xgb_target objxgboost dmlc)
    if(TARGET ${_xgb_target} AND CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(${_xgb_target} PRIVATE -w)
    endif()
endforeach()

# ── The library ───────────────────────────────────────────────────────
add_library(east-c-datascience
    src/google_or_linear.cc
    src/google_or_cpsat.cc
    src/google_or_routing.cc
    src/google_or_graph.cc
    src/xgboost.cc
    src/nn/plan.cc
    src/nn/interp.cc
    src/nn/nn.cc
    src/register_all.cc
)
target_include_directories(east-c-datascience PUBLIC include)
target_include_directories(east-c-datascience SYSTEM PRIVATE
    ${xgboost_SOURCE_DIR}/include
    ${xgboost_SOURCE_DIR}/dmlc-core/include)
target_link_libraries(east-c-datascience PUBLIC east-c PRIVATE ortools::ortools xgboost)
target_compile_definitions(east-c-datascience PRIVATE
    EAST_DATASCIENCE_ORTOOLS_VERSION="${ORTOOLS_VERSION}"
    EAST_DATASCIENCE_XGBOOST_VERSION="${EAST_XGBOOST_VERSION}")

# The compliance runner: east-c-std's, registering this package beside std
# (`make test-east-c-datascience` runs it over the suites this package
# implements, exported by `make -C libs/east-py test-export`).
add_executable(test_datascience_compliance ${CMAKE_CURRENT_SOURCE_DIR}/../east-c-std/tests/test_compliance.c)
target_compile_definitions(test_datascience_compliance PRIVATE EAST_COMPLIANCE_DATASCIENCE=1)
target_link_libraries(test_datascience_compliance east-c-std east-c-datascience)
