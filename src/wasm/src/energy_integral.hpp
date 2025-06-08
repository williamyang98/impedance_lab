#pragma once

#include "./PinnedArray.hpp"
#include <stdint.h>

float calculate_homogenous_energy_2d(
    TypedPinnedArray<float> e_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
);

float calculate_inhomogenous_energy_2d(
    TypedPinnedArray<float> e_field, 
    TypedPinnedArray<float> er_table, TypedPinnedArray<uint32_t> er_index_beta, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
);

void calculate_e_field(
    TypedPinnedArray<float> e_field, 
    TypedPinnedArray<float> v_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
);