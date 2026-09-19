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
@group(0) @binding(4) var<storage, read> ex: array<f32>; // [y+1,x]
@group(0) @binding(5) var<storage, read> ey: array<f32>; // [y,x+1]

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) data: f32,
}

fn get_dx(i: u32) -> f32 {
    let Nx = params.grid_size_x;
    let i_clamp = clamp(i, 0, Nx-1);
    let dx = x[i_clamp+1]-x[i_clamp];
    return dx;
}

fn get_dy(j: u32) -> f32 {
    let Ny = params.grid_size_y;
    let j_clamp = clamp(j, 0, Ny-1);
    let dy = y[j_clamp+1]-y[j_clamp];
    return dy;
}

fn get_ex(i: u32, j: u32) -> f32 {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Mx = Nx;
    let My = Ny+1;
    let ij0 = i+j*Mx;
    let ij1 = i+(j+1)*Mx;
    return (ex[ij0]+ex[ij1])/2.0;
}

fn get_ey(i: u32, j: u32) -> f32 {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Mx = Nx+1;
    let My = Ny;
    let i0j = i+j*Mx;
    let i1j = (i+1)+j*Mx;
    return (ey[i0j]+ey[i1j])/2.0;
}

fn get_e_mag(i: u32, j: u32) -> f32 {
    return length(vec2(get_ex(i,j), get_ey(i,j)));
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;

    var output : VertexOut;

    let j = instance_index/Nx;
    let i = instance_index-j*Nx;

    let dx = get_dx(i);
    let dy = get_dy(j);
    let x_offset = x[i];
    let y_offset = y[j];

    var vertex_pos = vec3<f32>(
        dx*position.x+x_offset,
        dy*position.y+y_offset,
        1.0,
    );
    vertex_pos.x = clamp(vertex_pos.x, x[0], x[Nx]);
    vertex_pos.y = clamp(vertex_pos.y, y[0], y[Ny]);

    let value = get_e_mag(i,j);
    output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
    output.data = value*params.scale;

    return output;
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let scale = 1.0;
    let value = vertex.data*scale;
    let alpha = abs(value)*params.alpha_scale;
    let colour = vec3(value);
    return vec4(colour, alpha);
}