struct Params {
    grid_size_x: u32,
    grid_size_y: u32,
    grid_size_z: u32,
    source_offset_x: u32,
    source_offset_y: u32,
    source_offset_z: u32,
    source_size_x: u32,
    source_size_y: u32,
    source_size_z: u32,
    e0: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> E: array<f32>;

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
    let _i = vec3<u32>(_j.z, _j.y, _j.x);
    if (_i.x >= params.source_size_x) { return; }
    if (_i.y >= params.source_size_y) { return; }
    if (_i.z >= params.source_size_z) { return; }

    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Nz = params.grid_size_z;
    let n_dims: u32 = u32(3);
    let Nzy = Nz*Ny;
    let ix = _i.x + params.source_offset_x;
    let iy = _i.y + params.source_offset_y;
    let iz = _i.z + params.source_offset_z;
    if (ix >= Nx) { return; }
    if (iy >= Ny) { return; }
    if (iz >= Nz) { return; }

    let i0 = iz + iy*Nz + ix*Nzy;
    let i = n_dims*i0;

    let ex = params.e0;
    E[i+0] += ex;
}