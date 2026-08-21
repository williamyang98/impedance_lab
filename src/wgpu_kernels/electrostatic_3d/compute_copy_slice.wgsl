struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    copy_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> x_buf: array<f32>;
@group(0) @binding(2) var<storage, read> r_buf: array<f32>;
@group(0) @binding(3) var<storage, read> b_buf: array<f32>;
@group(0) @binding(4) var<storage, read> mask_buf: array<u32>;
@group(0) @binding(5) var x_texture: texture_storage_2d<rgba16float, write>;

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

    let Mx = params.size_x+1;
    let My = params.size_y+1;
    let Mz = params.size_z+1;
    let Mxy = My*Mx;
    let iz = params.copy_z;

    let src_i = ix + iy*Mx + iz*Mxy;
    let dst_i = vec2<u32>(u32(ix), u32(iy));

    const mask_pack: u32 = 32;
    let imask = src_i/mask_pack;
    let imask_offset: u32 = src_i-imask*mask_pack;
    let mask_value = (mask_buf[imask] >> imask_offset) & 0x01;

    let x: f32 = x_buf[src_i];
    let r: f32 = r_buf[src_i];
    let b: f32 = b_buf[src_i];
    let colour = vec4<f32>(x,r,b,f32(mask_value));
    textureStore(x_texture, dst_i, colour);
}