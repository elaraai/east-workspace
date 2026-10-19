add_executable(east-c-cli src/main.c src/package_loader.c)
set_target_properties(east-c-cli PROPERTIES OUTPUT_NAME east-c)
target_link_libraries(east-c-cli east-c-std ${CMAKE_DL_LIBS})
# east-c-datascience is a shared library the binary opens at run time
# (src/package_loader.c) that links none of east-c: its east_* calls bind to
# the runtime this binary carries. So the whole of east-c and east-c-std is
# linked in and exported — not only what the CLI itself reaches — with the
# third-party archives kept private, so nothing of theirs can interpose on a
# package's own libraries. One published binary then serves every package
# (docs/npm-runner-distribution.md). Not on Windows, where the package is not
# published and an executable exports nothing.
if(WIN32)
    target_link_libraries(east-c-cli psapi)
else()
    if(CMAKE_VERSION VERSION_LESS 3.24)
        message(FATAL_ERROR "east-c needs CMake 3.24 or newer to export the runtime for its "
                            "loadable packages (LINK_LIBRARY_OVERRIDE); found ${CMAKE_VERSION}")
    endif()
    set_property(TARGET east-c-cli PROPERTY LINK_LIBRARY_OVERRIDE "WHOLE_ARCHIVE,east-c-std,east-c")
    set_target_properties(east-c-cli PROPERTIES ENABLE_EXPORTS ON)
    if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        target_link_options(east-c-cli PRIVATE
            "LINKER:--exclude-libs,libpcre2-8.a:libpcre2-posix.a:libbtreec.a:libminiz.a:libdeflate.a")
    endif()
endif()
target_compile_definitions(east-c-cli PRIVATE
    EAST_CLI_VERSION="${EAST_VERSION}"
    EAST_RUNTIME_VERSION="${EAST_VERSION}"
)

# CLI lifeline gate (issue #770): `exec --exit-with-parent` on a unit whose
# program never returns exits once its stdin pipe closes — on Windows over a
# synchronous pipe and an overlapped one. The unit is built from the
# protocol's type (hence the east-c link) around a checked-in program. Runs
# in the ASan tree too (leak-check's ctest pass), where the spawned CLI is
# instrumented and the gate fails on a sanitizer report in its stderr.
add_executable(test_cli_lifeline tests/test_cli_lifeline.c)
target_link_libraries(test_cli_lifeline east-c)
add_test(NAME cli_lifeline COMMAND test_cli_lifeline $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_lifeline PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI lazy paged-input gate (#516, #1033): spawns the binary over checked-in
# fixtures, every collection input opened lazily unless `--decode whole` or a
# unit's `decode` says otherwise, and pins the lazy contract end to end — the
# nested shape gate opening frozen, the residency of a mapped input, what the
# verbose account says of a keyed read, of a whole decode an operation forces,
# of reads that decode segments again and of an input decoded whole, and a
# manifest-rooted input paging over its directory, run and exec alike (wide
# fixtures the gate writes itself, hence the east-c link).
add_executable(test_cli_paged tests/test_cli_paged.c)
target_link_libraries(test_cli_paged east-c)
add_test(NAME cli_paged COMMAND test_cli_paged $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_paged PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI --profile gate: spawns the binary over a fixture whose helper is
# called 100 times and pins the epilogue — the helper listed with its call
# count and its source location, nothing printed without the flag, and the
# program's answer unchanged either way.
add_executable(test_cli_profile tests/test_cli_profile.c)
target_link_libraries(test_cli_profile east-c)
add_test(NAME cli_profile COMMAND test_cli_profile $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_profile PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI exec gate: the runner protocol's conformance corpus, which TypeScript
# exports beside the compliance IR (east/test/runner_corpus.spec.ts) — every
# unit copied into a scratch directory and executed with `exec`, its exit
# status, its result's outcome and every output byte held to the corpus.
# Skips (exit 77) unless `make test-export` has produced
# $EAST_TEST_IR_DIR/runner_corpus — the root paths.mk sets EAST_TEST_IR_DIR
# when ctest runs through make (`make -C libs/east-c unit`). Runs in the ASan
# tree too. Whatever the corpus, it first runs a checked-in unit given no
# platform, whose program calls one (#1031).
add_executable(test_cli_exec tests/test_cli_exec.c)
target_link_libraries(test_cli_exec east-c)
target_compile_definitions(test_cli_exec PRIVATE
    EAST_CLI_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
add_test(NAME cli_exec COMMAND test_cli_exec $<TARGET_FILE:east-c-cli>)
set_tests_properties(cli_exec PROPERTIES SKIP_RETURN_CODE 77 TIMEOUT 600
                     WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI `ir` toolbox gate (#627): spawns the binary over checked-in IR fixtures
# and pins normalize (a fixed point, loc_ids zero, no map), diff (exit code +
# path, --raw) and convert (json <-> beast2 with the source map intact).
add_executable(test_cli_ir tests/test_cli_ir.c)
target_link_libraries(test_cli_ir east-c)
add_test(NAME cli_ir COMMAND test_cli_ir $<TARGET_FILE:east-c-cli>
         ${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures)
set_tests_properties(cli_ir PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})

# CLI package gate: east-c-datascience is opened at run time. A binary copied
# to a directory of its own, told by EAST_C_PACKAGE_PATH to look in an empty
# one, reports the package as not installed (and how to install it) from
# `version`, and refuses `run -p east-c-datascience` before reading anything;
# with the package built, the build tree's binary opens it and `version` names
# it, and EAST_C_PACKAGE_PATH set to its directory opens it from there.
add_executable(test_cli_packages tests/test_cli_packages.c)
target_compile_definitions(test_cli_packages PRIVATE EAST_RUNTIME_VERSION="${EAST_VERSION}")
if(TARGET east-c-datascience)
    add_test(NAME cli_packages COMMAND test_cli_packages $<TARGET_FILE:east-c-cli>
             ${CMAKE_CURRENT_BINARY_DIR}/packages-scratch $<TARGET_FILE:east-c-datascience>)
else()
    add_test(NAME cli_packages COMMAND test_cli_packages $<TARGET_FILE:east-c-cli>
             ${CMAKE_CURRENT_BINARY_DIR}/packages-scratch)
endif()
set_tests_properties(cli_packages PROPERTIES WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
