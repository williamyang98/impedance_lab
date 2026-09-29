struct Params {
    scale: f32,
    grid_size_x: u32,
    grid_size_y: u32,
    grid_size_z: u32,
    clear_colour: vec4<f32>,
    mask_colour: vec4<f32>,
    z_slice: u32,
    value_min: f32,
    value_max: f32,
    _pad_0: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> camera: mat3x3<f32>;
@group(0) @binding(2) var<storage, read> x: array<f32>; // [x+1]
@group(0) @binding(3) var<storage, read> y: array<f32>; // [y+1]
@group(0) @binding(4) var<storage, read> data: array<f32>; // get_data_size()

const COMPONENT_MODE_EDGE_X: i32 = 0;
const COMPONENT_MODE_EDGE_Y: i32 = 1;
const COMPONENT_MODE_EDGE_Z: i32 = 2;
const COMPONENT_MODE_FACE_X: i32 = 3;
const COMPONENT_MODE_FACE_Y: i32 = 4;
const COMPONENT_MODE_FACE_Z: i32 = 5;
const COMPONENT_MODE_CELL: i32 = 6;
override component_mode = COMPONENT_MODE_EDGE_X;

const COLOUR_MODE_POSITIVE_NEGATIVE: i32 = 0;
const COLOUR_MODE_INVERSE_POSITIVE: i32 = 1;
const COLOUR_MODE_POSITIVE: i32 = 2;
override colour_mode = COLOUR_MODE_POSITIVE_NEGATIVE;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) data: f32,
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

fn get_data_size() -> vec3<i32> {
    let Ny = i32(params.grid_size_y);
    let Nx = i32(params.grid_size_x);
    let Nz = i32(params.grid_size_z);
    if (component_mode == COMPONENT_MODE_EDGE_X) {
        return vec3<i32>(Nx,Ny+1,Nz+1);
    } else if (component_mode == COMPONENT_MODE_EDGE_Y) {
        return vec3<i32>(Nx+1,Ny,Nz+1);
    } else if (component_mode == COMPONENT_MODE_EDGE_Z) {
        return vec3<i32>(Nx+1,Ny+1,Nz);
    } else if (component_mode == COMPONENT_MODE_FACE_X) {
        return vec3<i32>(Nx+1,Ny,Nz);
    } else if (component_mode == COMPONENT_MODE_FACE_Y) {
        return vec3<i32>(Nx,Ny+1,Nz);
    } else if (component_mode == COMPONENT_MODE_FACE_Z) {
        return vec3<i32>(Nx,Ny,Nz+1);
    } else if (component_mode == COMPONENT_MODE_CELL) {
        return vec3<i32>(Nx,Ny,Nz);
    } else {
        return vec3<i32>(0, 0, 0);
    }
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Nz = params.grid_size_z;

    var output : VertexOut;
    let M = get_data_size();
    let Mxy = M.x*M.y;

    let j = i32(instance_index)/M.x;
    let i = i32(instance_index)-j*M.x;

    var dx: f32 = 0.0;
    var dy: f32 = 0.0;
    var x_offset: f32 = 0.0;
    var y_offset: f32 = 0.0;

    if (component_mode == COMPONENT_MODE_EDGE_X) {
        dx = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dy = (dy0+dy1)/2.0;
        x_offset = x[i];
        y_offset = y[j]-dy0/2.0;
    } else if (component_mode == COMPONENT_MODE_EDGE_Y) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        dy = get_dy(j);
        dx = (dx0+dx1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j];
    } else if (component_mode == COMPONENT_MODE_EDGE_Z) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dx = (dx0+dx1)/2.0;
        dy = (dy0+dy1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j]-dy0/2.0;
    } else if (component_mode == COMPONENT_MODE_FACE_X) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        dy = get_dy(j);
        dx = (dx0+dx1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j];
    } else if (component_mode == COMPONENT_MODE_FACE_Y) {
        dx = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dy = (dy0+dy1)/2.0;
        x_offset = x[i];
        y_offset = y[j]-dy0/2.0;
    } else if (component_mode == COMPONENT_MODE_FACE_Z) {
        dx = get_dx(i);
        dy = get_dy(j);
        x_offset = x[i];
        y_offset = y[j];
    } else if (component_mode == COMPONENT_MODE_CELL) {
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

    let data_index = i + j*M.x + i32(params.z_slice)*Mxy;
    let data_value = data[data_index];
    output.vertex_position = vec4f((vertex_pos*camera).xy, 0.0, 1.0);
    output.data = clamp(data_value*params.scale, params.value_min, params.value_max);

    return output;
}

fn red_green_cmap_with_mid(value: f32, mid_colour: vec3<f32>) -> vec3<f32> {
    const neg_colour = vec3<f32>(1.0, 0.0, 0.0);
    const pos_colour = vec3<f32>(0.0, 1.0, 0.0);
    let alpha = clamp(value, -1.0, 1.0);
    if (alpha < 0.0) {
        return mix(neg_colour, mid_colour, alpha+1);
    } else {
        return mix(mid_colour, pos_colour, alpha);
    }
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    var colour = vec4<f32>(0.0);
    let value = vertex.data;

    if (colour_mode == COLOUR_MODE_POSITIVE_NEGATIVE) {
        let alpha = abs(value);
        let rgb = red_green_cmap_with_mid(value, params.clear_colour.rgb);
        colour = vec4(rgb, alpha);
    } else if (colour_mode == COLOUR_MODE_INVERSE_POSITIVE) {
        let alpha = max(1.0 - value, 0.0); // higher means less visible
        const pos_colour = vec4<f32>(0.0, 1.0, 0.0, 1.0);
        let beta = clamp(value, 0, 1);
        let rgb = mix(pos_colour, params.mask_colour, beta).rgb;
        colour = vec4(rgb, alpha);
    } else if (colour_mode == COLOUR_MODE_POSITIVE) {
        const pos_colour = vec4<f32>(0.0, 1.0, 0.0, 1.0);
        let alpha = clamp(value, 0, 1);
        colour = mix(params.mask_colour, pos_colour, alpha);
    }
    return colour;
}