struct Params {
    scale: f32,
    grid_size_x: u32,
    grid_size_y: u32,
    _pad_0: u32,
    low_colour: vec4<f32>,
    high_colour: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> camera: mat3x3<f32>;
@group(0) @binding(2) var<storage, read> x_arr: array<f32>; // [x+1]
@group(0) @binding(3) var<storage, read> y_arr: array<f32>; // [y+1]
@group(0) @binding(4) var<storage, read> ex_arr: array<f32>; // [y+1,x]
@group(0) @binding(5) var<storage, read> ey_arr: array<f32>; // [y,x+1]

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) magnitude: f32,
}

fn get_dx(i: u32) -> f32 {
    return x_arr[i+1]-x_arr[i];
}

fn get_dy(j: u32) -> f32 {
    return y_arr[j+1]-y_arr[j];
}

fn get_x(i: u32) -> f32 {
    return (x_arr[i]+x_arr[i+1])/2.0;
}

fn get_y(j: u32) -> f32 {
    return (y_arr[j]+y_arr[j+1])/2.0;
}

fn get_ex(i: u32, j: u32) -> f32 {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Mx = Nx;
    let My = Ny+1;
    let ij0 = i+j*Mx;
    let ij1 = i+(j+1)*Mx;
    return (ex_arr[ij0]+ex_arr[ij1])/2.0;
}

fn get_ey(i: u32, j: u32) -> f32 {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Mx = Nx+1;
    let My = Ny;
    let i0j = i+j*Mx;
    let i1j = (i+1)+j*Mx;
    return (ey_arr[i0j]+ey_arr[i1j])/2.0;
}

fn get_max_arrow_length(dx: f32, dy: f32, theta_abs: f32) -> f32 {
    // get maximum length for given x and y bounds
    // sin(theta) = dy/Ly
    // Ly = dy/sin(theta)
    // cos(theta) = dx/Lx
    // Lx = dx/cos(theta)
    const epsilon: f32 = 1.0e-12;
    let max_lx = dx/max(cos(theta_abs), epsilon);
    let max_ly = dy/max(sin(theta_abs), epsilon);
    let max_length = min(max_lx, max_ly);
    return max_length;
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOut {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;

    let j = instance_index/Nx;
    let i = instance_index-j*Nx;

    let ex = get_ex(i,j);
    let ey = get_ey(i,j);
    let theta = atan2(-ex, ey);
    let theta_horizontal = atan2(abs(ey), abs(ex));
    let mag = length(vec2(ex, ey));

    let x_offset = get_x(i);
    let y_offset = get_y(j);
    let dx = get_dx(i);
    let dy = get_dy(j);

    // create arrow
    var arrow_x = position.x;
    var arrow_y = position.y;
    // scale to magnitude of field
    let max_arrow_length = get_max_arrow_length(dx, dy, theta_horizontal);
    let scale = params.scale*mag;
    let arrow_length = clamp(scale, 0.0, max_arrow_length*0.5);
    arrow_x *= arrow_length*0.25;
    arrow_y *= arrow_length;
    // rotate based on orientation
    var rot_arrow_x = arrow_x*cos(theta) - arrow_y*sin(theta);
    var rot_arrow_y = arrow_x*sin(theta) + arrow_y*cos(theta);
    // translate to location on grid
    let vertex_x = rot_arrow_x + x_offset;
    let vertex_y = rot_arrow_y + y_offset;
    let vertex_pos = vec3<f32>(
        vertex_x,
        vertex_y,
        1.0,
    );

    var output : VertexOut;
    output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
    output.magnitude = scale;
    return output;
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let magnitude = clamp(vertex.magnitude, 0.0, 1.0);
    let alpha = sqrt(magnitude);
    let colour = mix(params.low_colour, params.high_colour, magnitude);
    return vec4<f32>(colour.rgb, alpha);
}