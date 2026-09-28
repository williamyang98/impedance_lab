struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> Ix: array<f32>; // [z,y,x+1]
@group(0) @binding(2) var<storage,read_write> Iy: array<f32>; // [z,y+1,x]
@group(0) @binding(3) var<storage,read_write> Iz: array<f32>; // [z+1,y,x]
@group(0) @binding(4) var<storage,read> Vx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(5) var<storage,read> Vy: array<f32>; // [z+1,y,x+1]
@group(0) @binding(6) var<storage,read> Vz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(7) var<storage,read> phi_x: array<f32>; // [z,y,x+1]
@group(0) @binding(8) var<storage,read> phi_y: array<f32>; // [z,y+1,x]
@group(0) @binding(9) var<storage,read> phi_z: array<f32>; // [z+1,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

fn get_Vx(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Vx[k*(Mx*My) + j*Mx + i];
}

fn get_Vy(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Vy[k*(Mx*My) + j*Mx + i];
}

fn get_Vz(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Vz[k*(Mx*My) + j*Mx + i];
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
    // i2jk = i+1,j,k
    let Vx_i1jk = get_Vx(i,j,k);
    let Vx_i1jk2 = get_Vx(i,j,k+1);
    let Vx_i1j2k = get_Vx(i,j+1,k);

    let Vy_ij1k = get_Vy(i,j,k);
    let Vy_ij1k2 = get_Vy(i,j,k+1);
    let Vy_i2j1k = get_Vy(i+1,j,k);

    let Vz_ijk1 = get_Vz(i,j,k);
    let Vz_i2jk1 = get_Vz(i+1,j,k);
    let Vz_ij2k1 = get_Vz(i,j+1,k);

    if (j < Ny && k < Nz) {
        // Equation 3.13
        let cVx_ij1k1 = Vz_ijk1 + Vy_ij1k2 - Vz_ij2k1 - Vy_ij1k;
        let index_Ix_ij1k1 = get_clamped_index(i,j,k,Nx+1,Ny,Nz);
        Ix[index_Ix_ij1k1] = Ix[index_Ix_ij1k1] + phi_x[index_Ix_ij1k1]*cVx_ij1k1;
    }

    if (i < Nx && k < Nz) {
        // Equation 1.8
        let cVy_i1jk1 = Vx_i1jk + Vz_i2jk1 - Vx_i1jk2 - Vz_ijk1;
        let index_Iy_i1jk1 = get_clamped_index(i,j,k,Nx,Ny+1,Nz);
        Iy[index_Iy_i1jk1] = Iy[index_Iy_i1jk1] + phi_y[index_Iy_i1jk1]*cVy_i1jk1;
    }

    if (i < Nx && j < Ny) {
        // Equation 1.9
        let cVz_i1j1k = Vy_ij1k + Vx_i1j2k - Vy_i2j1k - Vx_i1jk;
        let index_Iz_i1j1k = get_clamped_index(i,j,k,Nx,Ny,Nz+1);
        Iz[index_Iz_i1j1k] = Iz[index_Iz_i1j1k] + phi_z[index_Iz_i1j1k]*cVz_i1j1k;
    }
}