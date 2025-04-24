export function convert_f32_to_f16(f32_data: Float32Array, f16_data: Uint16Array) {
  if (f32_data.length != f16_data.length) {
    throw Error(`Mismatch between f32 buffer with length ${f32_data.length} and f16 buffer with length ${f16_data.length}`);
  }
  const N = f32_data.length;
  const u32_view = new Uint32Array(f32_data.buffer);
  for (let i = 0; i < N; i++) {
    // IEEE.754 32bit floating point format
    // sign: 1, exponent: 8, mantissa: 23
    // value = (-1)^sign * 2^(exponent-127) * (1 + mantissa*2^-23)
    const f32_x = u32_view[i];
    const f32_sign = (f32_x >> 31) & 0x1;
    const f32_exponent = ((f32_x >> 23) & 0xFF) - 127;
    const f32_mantissa = f32_x & 0x7FFFFF;

    // IEEE.754 16bit floating point
    // sign: 1, exponent: 5, mantissa: 10
    // value = (-1)^sign * 2^(exponent-15) * (1 + mantissa*2^-10)
    let f16_y = 0;
    const f16_sign = f32_sign << 15;
    // clamp exponent to displayable values
    const f16_exponent = Math.min(Math.max(f32_exponent + 15, 0), 31);
    const f16_mantissa = f32_mantissa >> 13;
    f16_y = f16_sign | (f16_exponent << 10) | f16_mantissa;
    f16_data[i] = f16_y;
  }
}
