cmake_minimum_required(VERSION 3.15)
project(superlu_testing)

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

set(SRC_DIR ${CMAKE_SOURCE_DIR}/src)
add_executable(lu_solver
    ${SRC_DIR}/lib.cpp
    ${SRC_DIR}/LU_Solver.cpp
    ${SRC_DIR}/energy_integral.cpp
)
target_include_directories(lu_solver PRIVATE ${SRC_DIR})
target_link_libraries(lu_solver PRIVATE superlu embind)
target_link_options(lu_solver PUBLIC
    -std=c++17 -ffast-math -march=native
    # export es6 module with typescript bindings
    -sMODULARIZE -sEXPORT_ES6
    --bind --emit-tsd lu_solver.d.ts
    # malloc/free to wasm module's own heap
    -sALLOW_MEMORY_GROWTH=1
    -sEXPORTED_FUNCTIONS=_malloc,_free
    -sEXPORTED_RUNTIME_METHODS=HEAP8,HEAP16,HEAP32,HEAPU8,HEAPU16,HEAPU32,HEAPF32,HEAPF64,HEAP64,HEAPU64
)
