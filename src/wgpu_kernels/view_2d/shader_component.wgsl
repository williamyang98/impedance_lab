struct Params {
    scale: f32,
    alpha_scale: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var grid_sampler: sampler;
@group(0) @binding(2) var grid: texture_2d<f32>;

override axis_mode = 0;
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

fn get_1d_colour(value: f32) -> vec4<f32> {
    var colour = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    if (colour_mode == 0) {
        let mag: f32 = value*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(-mag, mag, 0.0, alpha);
    } else if (colour_mode == 1) {
        let mag: f32 = value*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(red_green_cmap(mag), alpha);
    } else if (colour_mode == 2) {
        let mag: f32 = value*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(mag, mag, mag, alpha);
    }
    return colour;
}

fn get_2d_colour(value: vec2<f32>) -> vec4<f32> {
    var colour = vec4(0.0, 0.0, 0.0, 0.0);
    if (colour_mode == 0) {
        let mag: f32 = length(value)*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(-mag, mag, 0.0, alpha);
    } else if (colour_mode == 1) {
        let mag = length(value)*params.scale;
        let alpha = mag*params.alpha_scale;

        let angle = atan2(value.r, -value.g);
        let hue = angle / (2.0*3.1415) + 0.5;
        let saturation = 1.0;
        let rgb = hsv_to_rgb(vec3<f32>(hue, saturation, mag));
        colour = vec4<f32>(rgb.r, rgb.g, rgb.b, alpha);
    } else if (colour_mode == 2) {
        let mag: f32 = length(value)*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(mag, mag, mag, alpha);
    } else if (colour_mode == 16) {
        let mag = value.r*params.scale;
        let beta = value.g*params.scale;
        let alpha = abs(beta)*params.alpha_scale;
        colour = vec4f(red_green_cmap(mag), alpha);
    }
    return colour;
}

fn get_3d_colour(value: vec3<f32>) -> vec4<f32> {
    var colour = vec4(0.0, 0.0, 0.0, 0.0);
    if (colour_mode == 0) {
        let mag: f32 = length(value)*params.scale;
        let alpha = mag*params.alpha_scale;
        colour = vec4f(-mag, mag, 0.0, alpha);
    } else if (colour_mode == 1) {
        let mag: f32 = length(value)*params.scale;
        let alpha = mag*params.alpha_scale;
        colour = vec4f(abs(value.r), abs(value.g), abs(value.b), alpha);
    } else if (colour_mode == 2) {
        let mag: f32 = length(value)*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(mag, mag, mag, alpha);
    }
    return colour;
}

fn get_4d_colour(value: vec4<f32>) -> vec4<f32> {
    var colour = vec4(0.0, 0.0, 0.0, 0.0);
    if (colour_mode == 0) {
        let mag: f32 = length(value)*params.scale;
        let alpha = mag*params.alpha_scale;
        colour = vec4f(-mag, mag, 0.0, alpha);
    } else if (colour_mode == 1) {
        let mag: f32 = length(value)*params.scale;
        colour = vec4f(abs(value.r), abs(value.g), abs(value.b), abs(value.a));
    } else if (colour_mode == 2) {
        let mag: f32 = length(value)*params.scale;
        let alpha = abs(mag)*params.alpha_scale;
        colour = vec4f(mag, mag, mag, alpha);
    }
    return colour;
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let sample = textureSampleLevel(grid, grid_sampler, vertex.frag_position, 0.0);
    var colour = vec4(0.0, 0.0, 0.0, 0.0);

    // 4d
    if (axis_mode == (1 | 2 | 4 | 8)) {
        colour = get_4d_colour(sample.rgba);
    // 3d
    } else if (axis_mode == (1 | 2 | 4)) {
        colour = get_3d_colour(sample.rgb);
    } else if (axis_mode == (1 | 2 | 8)) {
        colour = get_3d_colour(sample.rga);
    } else if (axis_mode == (1 | 4 | 8)) {
        colour = get_3d_colour(sample.rba);
    } else if (axis_mode == (2 | 4 | 8)) {
        colour = get_3d_colour(sample.gba);
    // 2d
    } else if (axis_mode == (1 | 2)) {
        colour = get_2d_colour(sample.rg);
    } else if (axis_mode == (1 | 4)) {
        colour = get_2d_colour(sample.rb);
    } else if (axis_mode == (1 | 8)) {
        colour = get_2d_colour(sample.ra);
    } else if (axis_mode == (2 | 4)) {
        colour = get_2d_colour(sample.gb);
    } else if (axis_mode == (2 | 8)) {
        colour = get_2d_colour(sample.ga);
    } else if (axis_mode == (4 | 8)) {
        colour = get_2d_colour(sample.ba);
    // 1d
    } else if (axis_mode == (1)) {
        colour = get_1d_colour(sample.r);
    } else if (axis_mode == (2)) {
        colour = get_1d_colour(sample.g);
    } else if (axis_mode == (4)) {
        colour = get_1d_colour(sample.b);
    } else if (axis_mode == (8)) {
        colour = get_1d_colour(sample.a);
    }
    return colour;
}