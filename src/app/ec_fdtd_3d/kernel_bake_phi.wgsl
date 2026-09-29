struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    dt: f32,
    max_L: f32,
    _pad_0: u32,
    _pad_1: u32,
    _pad_2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> Lx: array<f32>; // [z,y,x+1]
@group(0) @binding(2) var<storage,read_write> Ly: array<f32>; // [z,y+1,x]
@group(0) @binding(3) var<storage,read_write> Lz: array<f32>; // [z+1,y,x]
@group(0) @binding(4) var<storage,read_write> phi_x: array<f32>; // [z,y,x+1]
@group(0) @binding(5) var<storage,read_write> phi_y: array<f32>; // [z,y+1,x]
@group(0) @binding(6) var<storage,read_write> phi_z: array<f32>; // [z+1,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _index: vec3<u32>) {
    let i = i32(_index.x);
    let j = i32(_index.y);
    let k = i32(_index.z);
    let Nx = i32(params.size_x);
    let Ny = i32(params.size_y);
    let Nz = i32(params.size_z);

    if (i >= (Nx+1)) { return; }
    if (j >= (Ny+1)) { return; }
    if (k >= (Nz+1)) { return; }

    // ijk = i,j,k
    // i0jk = i-0.5,j,k
    // i1jk = i+0.5,j,k

    // Face components: phi
    // phi = dt/L (Equation 3.12)
    if (j < Ny && k < Nz) {
        let index_Ix_ij1k1 = get_clamped_index(i,j,k,Nx+1,Ny,Nz);
        let L = Lx[index_Ix_ij1k1];
        var phi = 0.0;
        if (L < params.max_L) {
            phi = params.dt/L;
        }
        phi_x[index_Ix_ij1k1] = phi;
    }

    if (i < Nx && k < Nz) {
        let index_Iy_i1jk1 = get_clamped_index(i,j,k,Nx,Ny+1,Nz);
        let L = Ly[index_Iy_i1jk1];
        var phi = 0.0;
        if (L < params.max_L) {
            phi = params.dt/L;
        }
        phi_y[index_Iy_i1jk1] = phi;
    }

    if (i < Nx && j < Ny) {
        let index_Iz_i1j1k = get_clamped_index(i,j,k,Nx,Ny,Nz+1);
        let L = Lz[index_Iz_i1j1k];
        var phi = 0.0;
        if (L < params.max_L) {
            phi = params.dt/L;
        }
        phi_z[index_Iz_i1j1k] = phi;
    }
}