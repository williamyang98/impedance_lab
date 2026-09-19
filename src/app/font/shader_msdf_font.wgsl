struct Params {
    scale: f32,
    zoom: f32,
    atlas_width: f32,
    atlas_height: f32,
    atlas_distance_range: f32,
    _pad_0: u32,
    _pad_1: u32,
    _pad_2: u32,
}

struct AtlasCoord {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

struct GlyphCoord {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    atlas_index: u32,
    // _pad_0: u32,
    // _pad_1: u32,
    // _pad_2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var atlas_sampler: sampler;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> atlas_coords: array<AtlasCoord>;
@group(0) @binding(4) var<storage, read> glyph_coords: array<GlyphCoord>;

struct VertexOut {
    @builtin(position) vertex_position : vec4f,
    @location(0) atlas_coord: vec2f,
}

@vertex
fn vertex_main(
    @location(0) position: vec2f,
    @builtin(instance_index) instance_index: u32,
) -> VertexOut {
    let glyph_coord: GlyphCoord = glyph_coords[instance_index];
    let atlas_coord: AtlasCoord = atlas_coords[glyph_coord.atlas_index];

    var output: VertexOut;
    let vertex_x = glyph_coord.x + glyph_coord.width*position.x;
    let vertex_y = glyph_coord.y + glyph_coord.height*position.y;
    let vertex_pos = vec2f(vertex_x, vertex_y);

    let atlas_x = atlas_coord.x + atlas_coord.width*position.x;
    let atlas_y = atlas_coord.y + atlas_coord.height*position.y;

    output.vertex_position = vec4f(vertex_pos*params.zoom*2.0 - 1.0, 0.0, 1.0);
    output.atlas_coord = vec2f(atlas_x, atlas_y);
    return output;
}

fn median(r: f32, g: f32, b: f32) -> f32 {
    return max(min(r, g), min(max(r, g), b));
}

// https://stackoverflow.com/q/71988257
fn get_screen_pixel_range(atlas_coord: vec2<f32>) -> f32 {
    let unit_range = vec2f(params.atlas_distance_range)/vec2f(params.atlas_width, params.atlas_height);
    let screen_texture_size = vec2f(1.0)/fwidth(atlas_coord);
    return max(0.5*dot(unit_range, screen_texture_size), 1.0);
}

@fragment
fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
    let sdf = textureSample(atlas, atlas_sampler, vertex.atlas_coord);
    let distance = median(sdf.r, sdf.g, sdf.b);
    let screen_pixel_range = get_screen_pixel_range(vertex.atlas_coord)*params.scale;
    let screen_pixel_distance = screen_pixel_range*(distance-0.5);
    let opacity: f32 = clamp(screen_pixel_distance + 0.5, 0.0, 1.0);
    const background_colour: vec4f = vec4f(0.0, 0.0, 0.0, 1.0);
    const text_colour: vec4f = vec4f(1.0, 1.0, 1.0, 1.0);
    let colour = mix(background_colour, text_colour, opacity);
    return colour;
}