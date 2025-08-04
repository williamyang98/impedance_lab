struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    copy_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_buf: array<f32>;
@group(0) @binding(2) var<storage, read> r_buf: array<f32>;
@group(0) @binding(3) var x_texture: texture_storage_2d<rgba16float, write>;

override workgroup_size_x = 16;
override workgroup_size_y = 16;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, 1)
fn main(@builtin(global_invocation_id) _i: vec3<u32>) {
    let width = textureDimensions(x_texture).x;
    let height = textureDimensions(x_texture).y;

    let ix = _i.x;
    let iy = _i.y;

    if (ix >= width) { return; }
    if (iy >= height) { return; }

    let Nx = params.size_x;
    let Ny = params.size_y;
    let Nz = params.size_z;
    let Nxy = Ny*Nx;
    let iz = params.copy_z;

    let src_i = ix + iy*Nx + iz*Nxy;
    let dst_i = vec2<u32>(u32(ix), u32(iy));

    let x: f32 = x_buf[src_i];
    let r: f32 = r_buf[src_i];
    let colour = vec4<f32>(x,r,0.0,0.0);
    textureStore(x_texture, dst_i, colour);
}