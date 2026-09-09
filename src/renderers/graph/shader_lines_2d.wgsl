struct Params {
    colour: vec4<f32>,
    thickness: f32,
    depth: f32,
    zoom: f32,
    _pad_0: u32,
};

const AXIS_MODE_X: i32 = 0;
const AXIS_MODE_Y: i32 = 1;
override axis_mode = AXIS_MODE_X;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> lines: array<f32>;

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    var output: VertexOut;
    let line: f32 = lines[instance_index];
    let thickness: f32 = params.thickness;
    if (axis_mode == AXIS_MODE_X) {
        let x: f32 = line*params.zoom + (position.x*thickness) - thickness/2.0;
        let y: f32 = position.y*2.0 - 1.0;
        output.vertex_position = vec4f(x, y, params.depth, 1.0);
    } else if (axis_mode == AXIS_MODE_Y) {
        let y: f32 = line*params.zoom + (position.y*thickness) - thickness/2.0;
        let x: f32 = position.x*2.0 - 1.0;
        output.vertex_position = vec4f(x, y, params.depth, 1.0);
    }
    return output;
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    return params.colour;
}