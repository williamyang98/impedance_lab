#include "./convert_f32_to_f16.hpp"
#include <stdint.h>

template <typename T>
static inline T clamp(T v, T v_min, T v_max) {
    if (v < v_min) return v_min;
    if (v > v_max) return v_max;
    return v;
}

void convert_f32_to_f16(TypedPinnedArray<float> X, TypedPinnedArray<uint16_t> Y) {
    auto Z = static_cast<TypedPinnedArray<uint32_t>>(X);
    const int N = X.get_length();

    for (int i = 0; i < N; i++) {
        // IEEE.754 32bit floating point format
        // sign: 1, exponent: 8, mantissa: 23
        // value = (-1)^sign * 2^(exponent-127) * (1 + mantissa*2^-23)
        const uint32_t z = Z[i];
        const uint32_t f32_sign = z >> 31;
        const int32_t f32_exponent = int32_t((z >> 23) & 0xFF) - 127;
        const uint32_t f32_mantissa = z & 0x7FFFFF;

        // IEEE.754 16bit floating point
        // sign: 1, exponent: 5, mantissa: 10
        // value = (-1)^sign * 2^(exponent-15) * (1 + mantissa*2^-10)
        const uint16_t f16_sign = uint16_t(f32_sign);
        const uint16_t f16_exponent = uint16_t(clamp<int32_t>(f32_exponent+15, 0, 31));
        const uint16_t f16_mantissa = uint16_t(f32_mantissa >> 13);
        Y[i] = (f16_sign << 15) | (f16_exponent << 10) | f16_mantissa;
    }
}