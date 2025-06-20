struct Params {
    scale: f32,
    quiver_count_x: u32,
    quiver_count_y: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var grid_sampler: sampler;
@group(0) @binding(2) var e_field: texture_2d<f32>;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) frag_position: vec2f,
    @location(1) magnitude: f32,
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOut {
    // get [x,y] index of arrow
    let y_index = instance_index/params.quiver_count_x;
    let x_index = instance_index - y_index*params.quiver_count_x;

    // normalise coordinates to [0,1]
    let y_coord = f32(y_index)/f32(params.quiver_count_y-1);
    let x_coord = f32(x_index)/f32(params.quiver_count_x-1);
    let coord = vec2<f32>(x_coord, y_coord);

    // sample field value at arrow midpoint
    let E = textureSampleLevel(e_field, grid_sampler, coord, 0.0).rg;
    let angle = atan2(-E.x, E.y);
    let mag = length(E);

    // create arrow
    var arrow_x = position.x;
    var arrow_y = position.y;
    // scale to magnitude of field
    let scale = min(1.0, params.scale*mag);
    arrow_x *= min(1.0, scale*1.5); // make the arrow shorter faster than it is skinny
    arrow_y *= min(1.0, scale);
    // rotate based on orientation
    var rot_arrow_x = arrow_x*cos(angle) - arrow_y*sin(angle);
    var rot_arrow_y = arrow_x*sin(angle) + arrow_y*cos(angle);
    // resize to fit grid (we do this after rotation to adjust for aspect ratio)
    rot_arrow_x *= 0.5/f32(params.quiver_count_x);
    rot_arrow_y *= 0.5/f32(params.quiver_count_y);
    // translate to location on grid
    let vertex_x = rot_arrow_x + x_coord + 0.5/f32(params.quiver_count_x);
    let vertex_y = rot_arrow_y + y_coord + 0.5/f32(params.quiver_count_y);

    var output : VertexOut;
    // normalise [0,1] to [-1,+1] display coordinates
    output.vertex_position = vec4f(vertex_x*2.0-1.0, vertex_y*2.0-1.0, 0.0, 1.0);
    output.frag_position = vec2f(x_coord, y_coord);
    output.magnitude = scale;
    return output;
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let magnitude = min(vertex.magnitude, 1.0);
    let alpha = sqrt(magnitude);
    const low_colour = vec3<f32>(0.4,0.0,0.1);
    const high_colour = vec3<f32>(0.2,0.0,0.6);
    let colour = mix(low_colour, high_colour, magnitude);
    return vec4<f32>(colour.rgb, alpha);
}