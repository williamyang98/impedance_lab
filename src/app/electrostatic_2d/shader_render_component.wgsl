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
@group(0) @binding(4) var<storage, read> data: array<f32>;

const DATA_MODE_VOLTAGE: i32 = 0;
const DATA_MODE_EX: i32 = 1;
const DATA_MODE_EY: i32 = 2;
override data_mode = DATA_MODE_VOLTAGE;

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

fn get_data_size() -> vec2<i32> {
    let Nx = i32(params.grid_size_x);
    let Ny = i32(params.grid_size_y);
    if (data_mode == DATA_MODE_VOLTAGE) {
        return vec2<i32>(Nx+1,Ny+1);
    } else if (data_mode == DATA_MODE_EX) {
        return vec2<i32>(Nx,Ny+1);
    } else if (data_mode == DATA_MODE_EY) {
        return vec2<i32>(Nx+1,Ny);
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
    } else if (data_mode == DATA_MODE_EX) {
        dx = get_dx(i);
        let dy0 = get_dy(j-1);
        let dy1 = get_dy(j);
        dy = (dy0+dy1)/2.0;
        x_offset = x[i];
        y_offset = y[j]-dy0/2.0;
    } else if (data_mode == DATA_MODE_EY) {
        let dx0 = get_dx(i-1);
        let dx1 = get_dx(i);
        dy = get_dy(j);
        dx = (dx0+dx1)/2.0;
        x_offset = x[i]-dx0/2.0;
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
    let data_value = data[data_index];
    output.vertex_position = vec4f((camera*vertex_pos).xy, 0.0, 1.0);
    output.data = data_value*params.scale;

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
    let alpha = abs(value)*params.alpha_scale;
    let colour = red_green_cmap_with_mid(value, params.clear_colour.rgb);
    return vec4(colour, alpha);
}