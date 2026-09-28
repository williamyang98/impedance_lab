struct Params {
    data_size_x: u32,
    data_size_y: u32,
    data_size_z: u32,
    source_offset_x: u32, // 16 bytes
    source_offset_y: u32,
    source_offset_z: u32,
    source_size_x: u32,
    source_size_y: u32, // 32 bytes
    source_size_z: u32,
    i_source: f32,
    _pad_0: u32,
    _pad_1: u32, // 48 bytes
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> V: array<f32>; // [data_size_z, data_size_y, data_size_x]
@group(0) @binding(2) var<storage,read> beta: array<f32>; // [data_size_z, data_size_y, data_size_x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _index: vec3<u32>) {
    let i = _index.x;
    let j = _index.y;
    let k = _index.z;
    if (i >= params.source_size_x) { return; }
    if (j >= params.source_size_y) { return; }
    if (k >= params.source_size_z) { return; }

    let io = i + params.source_offset_x;
    let jo = j + params.source_offset_y;
    let ko = k + params.source_offset_z;

    let Nx = params.data_size_x;
    let Ny = params.data_size_y;
    let Nz = params.data_size_z;

    if (io >= Nx) { return; }
    if (jo >= Ny) { return; }
    if (ko >= Nz) { return; }

    let index_ijk = ko*(Nx*Ny) + jo*Nx + io;
    let I_source = params.i_source;
    // Equation 3.8,3.9,3.10
    V[index_ijk] += beta[index_ijk]*I_source;
}