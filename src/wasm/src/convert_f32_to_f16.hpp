#pragma once
#include "./PinnedArray.hpp"

void convert_f32_to_f16(TypedPinnedArray<float> X, TypedPinnedArray<uint16_t> Y);