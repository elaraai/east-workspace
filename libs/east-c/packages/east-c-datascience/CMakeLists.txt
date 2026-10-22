# east-c-datascience — east-py-datascience's platform functions on the C
# runtime, family by family (the Google OR-Tools solvers, XGBoost, the neural
# networks on libtorch), under one compliance suite: the IR
# east-py-datascience's specs export runs here too.
#
# Built when the root CMakeLists is configured with -DEAST_C_DATASCIENCE=ON, as
# two shared libraries the runner opens at run time
# (packages/east-c-cli/src/package_loader.c): libeast-c-datascience (OR-Tools,
# XGBoost, and the neural-network stubs) and libeast-c-nn (the libtorch half,
# opened by the first nn_* call). Neither links east-c: their east_* calls bind
# to the runtime the binary exports, so one runtime lives in the process. The
# implementations are C++17 (all three libraries are C++); the surface the CLI
# and the compliance runner resolve by name is C (include/).
#
# OR-Tools is linked from a prebuilt install — its release archives run to
# 55 MB per platform and its source build to most of an hour — as east-c-std
# links the system libcurl: scripts/fetch-ortools.sh puts the pinned release at
# build-deps/or-tools, which is looked in first, and any other install is named
# through CMAKE_PREFIX_PATH or ortools_DIR. XGBoost builds from its release
# archive under third_party/, CPU only, as a static library, so no build
# downloads anything.
cmake_minimum_required(VERSION 3.24)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── OR-Tools ──────────────────────────────────────────────────────────
set(EAST_ORTOOLS_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/../../build-deps/or-tools"
    CACHE PATH "Where scripts/fetch-ortools.sh installs the pinned OR-Tools release")
# The archive's libraries sit under lib64/ (AlmaLinux) or lib/ (Debian,
# Ubuntu); the package's own config and its dependencies' (abseil, protobuf,
# re2, SCIP, HiGHS, Coin-OR, Boost) are found under the same directory.
foreach(_ortools_libdir lib64 lib)
    if(EXISTS "${EAST_ORTOOLS_PREFIX}/${_ortools_libdir}/cmake/ortools/ortoolsConfig.cmake")
        set(ortools_DIR "${EAST_ORTOOLS_PREFIX}/${_ortools_libdir}/cmake/ortools")
        list(APPEND CMAKE_PREFIX_PATH "${EAST_ORTOOLS_PREFIX}" "${EAST_ORTOOLS_PREFIX}/${_ortools_libdir}/cmake")
        # Debian's CMake does not search a prefix's lib64 (its multiarch has
        # none), and the config finds zlib and bzip2 through find_library.
        list(APPEND CMAKE_LIBRARY_PATH "${EAST_ORTOOLS_PREFIX}/${_ortools_libdir}")
        break()
    endif()
endforeach()
find_package(ortools CONFIG REQUIRED)

# libtorch (PyTorch's C++ distribution): the neural-network family runs on its
# kernels, CPU or CUDA by the build linked, from an install scripts/fetch-libtorch.sh
# pins by SHA-256 (nothing downloads here).
set(EAST_LIBTORCH_PREFIX "${CMAKE_CURRENT_SOURCE_DIR}/../../build-deps/libtorch" CACHE PATH
    "Where libtorch is installed (scripts/fetch-libtorch.sh)")
list(APPEND CMAKE_PREFIX_PATH "${EAST_LIBTORCH_PREFIX}")
find_package(Torch CONFIG REQUIRED)
message(STATUS "east-c-datascience: OR-Tools ${ORTOOLS_VERSION} (${ortools_DIR})")

# ── XGBoost ───────────────────────────────────────────────────────────
# Static, and position independent: it goes into a shared library.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
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

# ── The libraries ─────────────────────────────────────────────────────
# libeast-c-datascience is what `-p east-c-datascience` opens. Everything but
# the C surface (include/) is hidden; east-c's headers are used, its library is
# not. libeast-c-nn is the libtorch-linked half (src/nn/nn_entry.h), beside it
# — so OR-Tools and XGBoost work without libtorch installed, and an nn_* call
# without it says how to fetch it.
add_library(east-c-datascience SHARED
    src/google_or_linear.cc
    src/google_or_cpsat.cc
    src/google_or_routing.cc
    src/google_or_graph.cc
    src/xgboost.cc
    src/nn/nn_stub.cc
    src/register_all.cc
)
add_library(east-c-nn SHARED
    src/nn/plan.cc
    src/nn/torch_interp.cc
    src/nn/nn.cc
)
foreach(_lib east-c-datascience east-c-nn)
    target_include_directories(${_lib} PUBLIC include)
    target_include_directories(${_lib} PRIVATE
        $<TARGET_PROPERTY:east-c,INTERFACE_INCLUDE_DIRECTORIES>)
    set_target_properties(${_lib} PROPERTIES
        CXX_VISIBILITY_PRESET hidden
        VISIBILITY_INLINES_HIDDEN ON
        INSTALL_RPATH "$ORIGIN")
    target_compile_definitions(${_lib} PRIVATE
        EAST_DATASCIENCE_VERSION="${EAST_VERSION}"
        EAST_DATASCIENCE_ORTOOLS_VERSION="${ORTOOLS_VERSION}"
        EAST_DATASCIENCE_XGBOOST_VERSION="${EAST_XGBOOST_VERSION}")
    if(APPLE)
        # The runtime's symbols come from the executable that opens the library.
        target_link_options(${_lib} PRIVATE "LINKER:-undefined,dynamic_lookup")
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        # What the static archives linked in export (XGBoost's C API) stays
        # inside: only the C surface above is this library's.
        target_link_options(${_lib} PRIVATE "LINKER:--exclude-libs,ALL")
    endif()
endforeach()
target_include_directories(east-c-datascience SYSTEM PRIVATE
    ${xgboost_SOURCE_DIR}/include
    ${xgboost_SOURCE_DIR}/dmlc-core/include)
target_link_libraries(east-c-datascience PRIVATE ortools::ortools xgboost ${CMAKE_DL_LIBS})
target_link_libraries(east-c-nn PRIVATE ${TORCH_LIBRARIES})
separate_arguments(EAST_TORCH_CXX_FLAGS UNIX_COMMAND "${TORCH_CXX_FLAGS}")
target_compile_options(east-c-nn PRIVATE ${EAST_TORCH_CXX_FLAGS})
# In the build tree libtorch is where the fetch script put it; installed, it is
# the package's own libtorch/ directory, beside lib/ (fetched at install).
set_target_properties(east-c-nn PROPERTIES
    BUILD_RPATH "${EAST_LIBTORCH_PREFIX}/lib"
    INSTALL_RPATH "$ORIGIN;$ORIGIN/../libtorch/lib")

# `cmake --install <build> --component east-c-datascience --prefix <dir>` puts
# the two libraries at <dir>/lib with their installed rpaths;
# scripts/stage-datascience.sh completes the directory with the OR-Tools
# libraries they load.
install(TARGETS east-c-datascience east-c-nn
        LIBRARY DESTINATION lib
        COMPONENT east-c-datascience)

# The compliance runner: east-c-std's, opening this package as the CLI does —
# the build tree's library, or the one EAST_C_PACKAGE_PATH names (how the
# installed package is held to the suites) — and registering it beside std
# (`make test-east-c-datascience` runs it over the suites this package
# implements, exported by `make -C libs/east-py test-export`). As the CLI, it
# links the whole runtime and exports it for the library, and only the runtime.
add_executable(test_datascience_compliance
    ${CMAKE_CURRENT_SOURCE_DIR}/../east-c-std/tests/test_compliance.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../east-c-cli/src/package_loader.c)
target_include_directories(test_datascience_compliance PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../east-c-cli/src)
target_compile_definitions(test_datascience_compliance PRIVATE
    EAST_COMPLIANCE_DATASCIENCE=1
    EAST_RUNTIME_VERSION="${EAST_VERSION}")
target_link_libraries(test_datascience_compliance east-c-std ${CMAKE_DL_LIBS})
set_property(TARGET test_datascience_compliance PROPERTY
    LINK_LIBRARY_OVERRIDE "WHOLE_ARCHIVE,east-c-std,east-c")
set_target_properties(test_datascience_compliance PROPERTIES ENABLE_EXPORTS ON)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    # As the CLI: the runtime's third-party archives stay private, so nothing
    # of theirs interposes on the packages' own copies — libtorch's archive
    # reader carries a miniz of its own, which must bind to it, not to the
    # runtime's.
    target_link_options(test_datascience_compliance PRIVATE
        "LINKER:--exclude-libs,libpcre2-8.a:libpcre2-posix.a:libbtreec.a:libminiz.a:libdeflate.a")
endif()
add_dependencies(test_datascience_compliance east-c-datascience east-c-nn)
