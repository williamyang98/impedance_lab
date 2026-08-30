struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    copy_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> grid: array<f32>;
@group(0) @binding(2) var grid_tex: texture_storage_2d<r32float, write>;

override workgroup_size_x = 16;
override workgroup_size_y = 16;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y)
fn main(@builtin(global_invocation_id) _i: vec3<u32>) {
    let width = textureDimensions(grid_tex).x;
    let height = textureDimensions(grid_tex).y;
    let ix = _i.x;
    let iy = _i.y;
    if (ix >= width) { return; }
    if (iy >= height) { return; }

    let Nx = params.size_x;
    let Ny = params.size_y;
    let Nz = params.size_z;
    let Nxy = Nx*Ny;
    let src_z = params.copy_z;

    let src_i = src_z*Nxy + iy*Nx + ix;
    let dst_i = vec2<u32>(u32(ix), u32(iy));

    let value: f32 = grid[src_i+0];
    let colour = vec4<f32>(value);
    textureStore(grid_tex, dst_i, colour);
}