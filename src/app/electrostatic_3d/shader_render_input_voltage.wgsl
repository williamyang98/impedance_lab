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
@group(0) @binding(4) var<storage, read> b: array<f32>; // [x+1,y+1]
@group(0) @binding(5) var<storage, read> mask: array<u32>; // ceil[(x+1)*(y+1)/32]

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) data: f32,
    @location(1) mask: f32,
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
    let data_value = b[data_index];

    const mask_total_bits: i32 = 32;
    let mask_index: i32 = data_index / mask_total_bits;
    let mask_offset: u32 = u32(data_index - mask_index*mask_total_bits);
    let mask_value: u32 = (mask[mask_index] >> mask_offset) & 0x01;

    output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
    output.data = data_value*params.scale;
    output.mask = f32(mask_value); // cast to float for fragment shader

    return output;
}

fn red_green_cmap_with_mid(value: f32, mid_colour: vec4<f32>) -> vec4<f32> {
    const neg_colour = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    const pos_colour = vec4<f32>(0.0, 1.0, 0.0, 1.0);
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
    let alpha = f32(vertex.mask);
    let colour = red_green_cmap_with_mid(value, params.mask_colour.rgba);
    return vec4(colour.rgb, colour.a*alpha);
}