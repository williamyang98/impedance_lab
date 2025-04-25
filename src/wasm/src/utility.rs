use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub unsafe fn convert_f32_to_f16(x_arr: &[f32], y_arr: &mut [u16]) {
    assert!(x_arr.len() == y_arr.len());
    let z_arr = unsafe {
        std::slice::from_raw_parts(x_arr.as_ptr() as *const u32, x_arr.len())
    };

    for (z, y) in z_arr.iter().zip(y_arr.iter_mut()) {
        // IEEE.754 32bit floating point format
        // sign: 1, exponent: 8, mantissa: 23
        // value = (-1)^sign * 2^(exponent-127) * (1 + mantissa*2^-23)
        let f32_sign: u32 = z >> 31;
        let f32_exponent: i32 = ((z >> 23) & 0xFF) as i32 - 127;
        let f32_mantissa: u32 = z & 0x7FFFFF;

        // IEEE.754 16bit floating point
        // sign: 1, exponent: 5, mantissa: 10
        // value = (-1)^sign * 2^(exponent-15) * (1 + mantissa*2^-10)
        let f16_sign: u16 = f32_sign as u16;
        let f16_exponent: u16 = (f32_exponent+15).max(0).min(31) as u16;
        let f16_mantissa: u16 = (f32_mantissa >> 13) as u16;
        *y = (f16_sign << 15) | (f16_exponent << 10) | f16_mantissa;
    }
}
