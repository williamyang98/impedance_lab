struct Params {
    scale: f32,
    axis: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var grid_sampler: sampler;
@group(0) @binding(2) var grid_texture: texture_2d<f32>;

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

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let data = textureSampleLevel(grid_texture, grid_sampler, vertex.frag_position, 0.0);
    var color: vec4f = vec4f(0.0, 0.0, 0.0, 0.0);
    if (params.axis == 0) {
        let value = data.r*params.scale;
        color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
    } else if (params.axis == 1) {
        let value = data.g*params.scale;
        color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
    } else if (params.axis == 2) {
        let value = data.b*params.scale;
        color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
    } else if (params.axis == 3) {
        let value = data.a*params.scale;
        color = vec4f(value, value, value, 1.0);
    }
    return color;
}