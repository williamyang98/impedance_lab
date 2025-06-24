cmake_minimum_required(VERSION 3.15)
project(superlu_testing)

# superlu
option(enable_internal_blaslib "" ON)
option(enable_single "" ON)
option(enable_double "" OFF)
option(enable_complex "" OFF)
option(enable_matlabmex "" OFF)
option(enable_doc "" OFF)
option(enable_fortran "" OFF)
option(enable_tests "" OFF)
option(enable_examples "" OFF)
option(enable_complex16 "" OFF)
add_subdirectory(${CMAKE_SOURCE_DIR}/vendor/superlu)
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    message(STATUS "Turning on debug level for superlu")
    target_compile_definitions(superlu PUBLIC DEBUGlevel=1)
endif()

# zip
option(CMAKE_DISABLE_TESTING "" ON)
option(CMAKE_ENABLE_SANITIZERS "" OFF)
option(ZIP_STATIC_PIC "" OFF)
option(ZIP_BUILD_DOCS "" OFF)
option(ZIP_BUILD_FUZZ "" OFF)
add_subdirectory(${CMAKE_SOURCE_DIR}/vendor/zip)

set(SRC_DIR ${CMAKE_SOURCE_DIR}/src)
add_executable(wasm_module
    ${SRC_DIR}/lib.cpp
    ${SRC_DIR}/LU_Solver.cpp
    ${SRC_DIR}/ZipFile.cpp
    ${SRC_DIR}/energy_integral.cpp
    ${SRC_DIR}/convert_f32_to_f16.cpp
)
target_include_directories(wasm_module PRIVATE ${SRC_DIR})
target_link_libraries(wasm_module PRIVATE superlu embind zip)
target_link_options(wasm_module PUBLIC
    -std=c++17 -ffast-math -march=native
    # export es6 module with typescript bindings
    -sMODULARIZE -sEXPORT_ES6
    --bind --emit-tsd wasm_module.d.ts
    # malloc/free to wasm module's own heap
    -sALLOW_MEMORY_GROWTH=1
    -sEXPORTED_FUNCTIONS=_malloc,_free
    -sEXPORTED_RUNTIME_METHODS=HEAP8
)
