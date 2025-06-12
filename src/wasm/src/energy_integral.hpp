#pragma once

#include "./PinnedArray.hpp"
#include <stdint.h>

float calculate_homogenous_energy_2d(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
);

float calculate_inhomogenous_energy_2d(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr,
    TypedPinnedArray<float> er_table, TypedPinnedArray<uint32_t> er_index_beta
);

void calculate_e_field(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field,
    TypedPinnedArray<float> v_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
);