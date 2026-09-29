struct Params {
    scale: f32,
    size_x: u32,
    size_y: u32,
    size_z: u32,
    clear_colour: vec4<f32>,
    mask_colour: vec4<f32>,
    z_slice: u32,
    value_min: f32,
    value_max: f32,
    _pad_0: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> camera: mat3x3<f32>;
@group(0) @binding(2) var<storage,read> x: array<f32>; // [x+1]
@group(0) @binding(3) var<storage,read> y: array<f32>; // [y+1]
@group(0) @binding(4) var<storage,read> Ix: array<f32>; // [z,y,x+1]
@group(0) @binding(5) var<storage,read> Iy: array<f32>; // [z,y+1,x]
@group(0) @binding(6) var<storage,read> Iz: array<f32>; // [z+1,y,x]

const AXIS_MODE_X: i32 = 0;
const AXIS_MODE_Y: i32 = 1;
const AXIS_MODE_Z: i32 = 2;
override axis_mode = AXIS_MODE_X;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) data: f32,
}

fn get_dx(i: i32) -> f32 {
    let Nx = params.size_x;
    let i_clamp = clamp(i, 0, i32(Nx-1));
    let dx = x[i_clamp+1]-x[i_clamp];
    return dx;
}

fn get_dy(j: i32) -> f32 {
    let Ny = params.size_y;
    let j_clamp = clamp(j, 0, i32(Ny-1));
    let dy = y[j_clamp+1]-y[j_clamp];
    return dy;
}

fn get_Ix(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Ix[k*(Mx*My) + j*Mx + i];
}

fn get_Iy(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Iy[k*(Mx*My) + j*Mx + i];
}

fn get_Iz(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Iz[k*(Mx*My) + j*Mx + i];
}

fn get_edge_current_shape() -> vec3<i32> {
    let Ny = i32(params.size_y);
    let Nx = i32(params.size_x);
    let Nz = i32(params.size_z);
    if (axis_mode == AXIS_MODE_X) {
        return vec3<i32>(Nx,Ny+1,Nz+1);
    } else if (axis_mode == AXIS_MODE_Y) {
        return vec3<i32>(Nx+1,Ny,Nz+1);
    } else if (axis_mode == AXIS_MODE_Z) {
        return vec3<i32>(Nx+1,Ny+1,Nz);
    } else {
        return vec3<i32>(0, 0, 0);
    }
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let Nx = params.size_x;
    let Ny = params.size_y;
    let Nz = params.size_z;

    var output : VertexOut;
    let M = get_edge_current_shape();
    let Mxy = M.x*M.y;

    let k = i32(params.z_slice);
    let j = i32(instance_index)/M.x;
    let i = i32(instance_index)-j*M.x;

    // get cell rectangular mesh
    var dx: f32 = 0.0;
    var dy: f32 = 0.0;
    var x_offset: f32 = 0.0;
    var y_offset: f32 = 0.0;

    if (axis_mode == AXIS_MODE_X) {
        dx = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dy = (dy0+dy1)/2.0;
        x_offset = x[i];
        y_offset = y[j]-dy0/2.0;
    } else if (axis_mode == AXIS_MODE_Y) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        dy = get_dy(j);
        dx = (dx0+dx1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j];
    } else if (axis_mode == AXIS_MODE_Z) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dx = (dx0+dx1)/2.0;
        dy = (dy0+dy1)/2.0;
        x_offset = x[i]-dx0/2.0;
        y_offset = y[j]-dy0/2.0;
    }
    var vertex_pos = vec3<f32>(
        dx*position.x+x_offset,
        dy*position.y+y_offset,
        1.0,
    );
    vertex_pos.x = clamp(vertex_pos.x, x[0], x[Nx]);
    vertex_pos.y = clamp(vertex_pos.y, y[0], y[Ny]);

    // calculate edge current
    // ijk = i,j,k
    // i0jk = i-0.5,j,k
    // i1jk = i+0.5,j,k
    let Ix_ij1k0 = get_Ix(i,j,k-1);
    let Ix_ij1k1 = get_Ix(i,j,k);
    let Ix_ij0k1 = get_Ix(i,j-1,k);
    let Iy_i0jk1 = get_Iy(i-1,j,k);
    let Iy_i1jk1 = get_Iy(i,j,k);
    let Iy_i1jk0 = get_Iy(i,j,k-1);
    let Iz_i0j1k = get_Iz(i-1,j,k);
    let Iz_i1j1k = get_Iz(i,j,k);
    let Iz_i1j0k = get_Iz(i,j-1,k);
    var I_edge: f32 = 0.0;
    if (axis_mode == AXIS_MODE_X) {
        // Equation 3.8
        let cIx_i1jk = Iz_i1j0k + Iy_i1jk1 - Iz_i1j1k - Iy_i1jk0;
        I_edge = cIx_i1jk;
    } else if (axis_mode == AXIS_MODE_Y) {
        // Equation 3.9
        let cIy_ij1k = Ix_ij1k0 + Iz_i1j1k - Ix_ij1k1 - Iz_i0j1k;
        I_edge = cIy_ij1k;
    } else if (axis_mode == AXIS_MODE_Z) {
        // Equation 3.10
        let cIz_ijk1 = Iy_i0jk1 + Ix_ij1k1 - Iy_i1jk1 - Ix_ij0k1;
        I_edge = cIz_ijk1;
    }

    output.vertex_position = vec4f((vertex_pos*camera).xy, 0.0, 1.0);
    output.data = clamp(I_edge*params.scale, params.value_min, params.value_max);
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
    let value = vertex.data;
    let alpha = abs(value);
    let rgb = red_green_cmap_with_mid(value, params.clear_colour.rgb);
    let colour = vec4(rgb, alpha);
    return colour;
}