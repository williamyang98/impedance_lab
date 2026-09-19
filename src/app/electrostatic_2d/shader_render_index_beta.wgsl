struct Params {
    scale: f32,
    alpha_scale: f32,
    grid_size_x: u32,
    grid_size_y: u32,
    clear_colour: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> camera: mat3x3<f32>;
@group(0) @binding(2) var<storage, read> x: array<f32>; // [x+1]
@group(0) @binding(3) var<storage, read> y: array<f32>; // [y+1]
@group(0) @binding(4) var<storage, read> index_beta: array<u32>;
@group(0) @binding(5) var<storage, read> table: array<f32>;

const DATA_MODE_VOLTAGE: i32 = 0;
const DATA_MODE_DIELECTRIC: i32 = 1;
override data_mode = DATA_MODE_VOLTAGE;

const COLOUR_MODE_INDEX: i32 = 0;
const COLOUR_MODE_BETA: i32 = 1;
const COLOUR_MODE_VALUE: i32 = 2;
override colour_mode = COLOUR_MODE_INDEX;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) value: f32,
    @location(1) beta: f32,
    @location(2) index: f32,
}

fn get_dx(i: i32) -> f32 {
    let Nx = params.grid_size_x;
    let i_clamp = clamp(i, 0, i32(Nx-1));
    let dx = x[i_clamp+1]-x[i_clamp];
    return dx;
}

fn get_dy(j: i32) -> f32 {
    let Ny = params.grid_size_y;
    let j_clamp = clamp(j, 0, i32(Ny-1));
    let dy = y[j_clamp+1]-y[j_clamp];
    return dy;
}

fn get_data_size() -> vec2<i32> {
    let Nx = i32(params.grid_size_x);
    let Ny = i32(params.grid_size_y);
    if (data_mode == DATA_MODE_VOLTAGE) {
        return vec2<i32>(Nx+1,Ny+1);
    } else if (data_mode == DATA_MODE_DIELECTRIC) {
        return vec2<i32>(Nx,Ny);
    } else {
        return vec2<i32>(0,0);
    }
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;

    var output : VertexOut;
    let M = get_data_size();
    let Mxy = M.x*M.y;

    let j = i32(instance_index)/M.x;
    let i = i32(instance_index)-j*M.x;

    var dx: f32 = 0.0;
    var dy: f32 = 0.0;
    var x_offset: f32 = 0.0;
    var y_offset: f32 = 0.0;

    if (data_mode == DATA_MODE_VOLTAGE) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dx = (dx0+dx1)/2.0;
        dy = (dy0+dy1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j]-dy0/2.0;
    } else if (data_mode == DATA_MODE_DIELECTRIC) {
        dx = get_dx(i);
        dy = get_dy(j);
        x_offset = x[i];
        y_offset = y[j];
    }

    var vertex_pos = vec3<f32>(
        dx*position.x+x_offset,
        dy*position.y+y_offset,
        1.0,
    );
    vertex_pos.x = clamp(vertex_pos.x, x[0], x[Nx]);
    vertex_pos.y = clamp(vertex_pos.y, y[0], y[Ny]);

    let data_index = i + j*M.x;
    let data_index_beta: u32 = index_beta[data_index];
    let index: u32 = (data_index_beta >> 16) & 0xFFFF;
    let beta: f32 = f32(data_index_beta & 0xFFFF) / f32(0xFFFF);
    let value = table[index];

    output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
    output.value = value;
    output.beta = beta;
    output.index = f32(index);

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

fn index_cmap(index: f32) -> vec3<f32> {
    let hue = fract(index*0.13);
    let saturation = 1.0;
    let value = 1.0;
    let hsv = vec3(hue, saturation, value);
    return hsv_to_rgb(hsv);
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let value = vertex.value;
    let beta = vertex.beta;
    let index = vertex.index;
    let alpha: f32 = params.alpha_scale*beta;

    var colour = vec4(0.0, 0.0, 0.0, 0.0);
    if (colour_mode == COLOUR_MODE_INDEX) {
        colour = vec4(index_cmap(index), alpha);
    } else if (colour_mode == COLOUR_MODE_BETA) {
        colour = vec4(red_green_cmap(beta), alpha);
    } else if (colour_mode == COLOUR_MODE_VALUE) {
        colour = vec4(red_green_cmap(value*params.scale), alpha);
    }
    return colour;
}