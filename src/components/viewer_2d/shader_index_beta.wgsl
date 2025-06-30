struct Params {
    scale: f32,
    alpha_scale: f32,
    texture_width: u32,
    texture_height: u32,
    table_size: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var table: texture_2d<f32>;
@group(0) @binding(2) var index_beta: texture_2d<u32>;

override colour_mode = 0;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) frag_position: vec2f,
}

@vertex
fn vertex_main(@location(0) position: vec2f) -> VertexOut {
    var output : VertexOut;
    output.vertex_position = vec4f(position.x*2.0 - 1.0, position.y*2.0 - 1.0, 0.0, 1.0);
    output.frag_position = vec2f(position.x, position.y);
    return output;
}

fn red_green_cmap(value: f32) -> vec3<f32> {
    const neg_colour = vec3<f32>(1.0, 0.0, 0.0);
    const mid_colour = vec3<f32>(1.0, 1.0, 1.0);
    const pos_colour = vec3<f32>(0.0, 1.0, 0.0);
    let alpha = clamp(value, -1.0, 1.0);
    if (alpha < 0.0) {
        return mix(neg_colour, mid_colour, alpha+1);
    } else {
        return mix(mid_colour, pos_colour, alpha);
    }
}

// https://stackoverflow.com/a/17897228
fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn index_cmap(index: u32) -> vec3<f32> {
    let hue = fract(f32(index)*0.13);
    let saturation = 1.0;
    let value = 1.0;
    let hsv = vec3(hue, saturation, value);
    return hsv_to_rgb(hsv);
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    // grab texture coordintes
    let Nx: f32 = f32(params.texture_width);
    let Ny: f32 = f32(params.texture_height);
    let rx: f32 = vertex.frag_position.x;
    let ry: f32 = vertex.frag_position.y;
    let x = i32(rx*Nx);
    let y = i32(ry*Ny);

    // sample value from table
    let index_beta: u32 = textureLoad(index_beta, vec2(x, y), 0).r;
    let index: u32 = clamp(index_beta >> 16, 0, params.table_size-1);
    let beta: f32 = f32(index_beta & 0xFFFF) / f32(0xFFFF);
    let value: f32 = textureLoad(table, vec2(index, 0), 0).r;
    let alpha: f32 = params.alpha_scale*beta;

    var colour = vec4(0.0, 0.0, 0.0, 0.0);
    // index
    if (colour_mode == 0) {
        colour = vec4(index_cmap(index), alpha);
    // beta
    } else if (colour_mode == 1) {
        colour = vec4(red_green_cmap(beta), alpha);
    // signed value
    } else if (colour_mode == 2) {
        colour = vec4(red_green_cmap(value*params.scale), alpha);
    // absolute value
    } else if (colour_mode == 3) {
        colour = vec4(vec3(abs(value*params.scale)), alpha);
    }
    return colour;
}