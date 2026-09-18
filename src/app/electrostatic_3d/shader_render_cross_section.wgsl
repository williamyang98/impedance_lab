struct Params {
    scale: f32,
    grid_size_x: u32,
    grid_size_y: u32,
    grid_size_z: u32,
    clear_colour: vec4<f32>,
    mask_colour: vec4<f32>,
    z_slice: u32,
    _pad_0: u32,
    _pad_1: u32,
    _pad_2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> camera: mat3x3<f32>;
@group(0) @binding(2) var<storage, read> x: array<f32>; // [x+1]
@group(0) @binding(3) var<storage, read> y: array<f32>; // [y+1]
@group(0) @binding(4) var<storage, read> data: array<f32>; // node: [x+1,y+1], face: [x,y]

const DATA_MODE_NODE: i32 = 0; // node values
const DATA_MODE_FACE: i32 = 1; // face values
override data_mode = 0;

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

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Nz = params.grid_size_z;

    var output : VertexOut;
    if (data_mode == DATA_MODE_NODE) {
        let Mx = Nx+1;
        let My = Ny+1;
        let Mz = Nz+1;
        let Mxy = Mx*My;

        let j = i32(instance_index/Mx);
        let i = i32(instance_index)-j*i32(Mx);

        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        let dy0 = get_dx(j-1);
        let dy1 = get_dx(j);
        let dx = (dx0+dx1)/2.0;
        let dy = (dy0+dy1)/2.0;
        let x_offset = x[i]-dx0/2.0;
        let y_offset = y[j]-dy0/2.0;

        var vertex_pos = vec3<f32>(
            dx*position.x+x_offset,
            dy*position.y+y_offset,
            1.0,
        );
        vertex_pos.x = clamp(vertex_pos.x, x[0], x[Nx]);
        vertex_pos.y = clamp(vertex_pos.y, y[0], y[Ny]);

        let data_index = i + j*i32(Mx) + i32(params.z_slice*Mxy);
        let data_value = data[data_index];

        output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
        output.data = data_value*params.scale;
    } else if (data_mode == DATA_MODE_FACE) {
        let Nxy = Nx*Ny;
        let j = i32(instance_index/Nx);
        let i = i32(instance_index)-j*i32(Nx);

        let dx = get_dx(i);
        let dy = get_dy(j);
        let x_offset = x[i];
        let y_offset = y[j];

        var vertex_pos = vec3<f32>(
            dx*position.x+x_offset,
            dy*position.y+y_offset,
            1.0,
        );

        let data_index = i + j*i32(Nx) + i32(params.z_slice*Nxy);
        let data_value = data[data_index];

        output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
        output.data = data_value*params.scale;
    }

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
    let scale = 1.0;
    let value = vertex.data*scale;
    let alpha = abs(value);
    let colour = red_green_cmap_with_mid(value, params.clear_colour.rgb);
    return vec4(colour, alpha);
}