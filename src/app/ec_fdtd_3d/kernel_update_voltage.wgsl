struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> Vx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(2) var<storage,read_write> Vy: array<f32>; // [z+1,y,x+1]
@group(0) @binding(3) var<storage,read_write> Vz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(4) var<storage,read> Ix: array<f32>; // [z,y,x+1]
@group(0) @binding(5) var<storage,read> Iy: array<f32>; // [z,y+1,x]
@group(0) @binding(6) var<storage,read> Iz: array<f32>; // [z+1,y,x]
@group(0) @binding(7) var<storage,read> alpha_x: array<f32>; // [z+1,y+1,x]
@group(0) @binding(8) var<storage,read> alpha_y: array<f32>; // [z+1,y,x+1]
@group(0) @binding(9) var<storage,read> alpha_z: array<f32>; // [z,y+1,x+1]
@group(0) @binding(10) var<storage,read> beta_x: array<f32>; // [z,y,x+1]
@group(0) @binding(11) var<storage,read> beta_y: array<f32>; // [z,y+1,x]
@group(0) @binding(12) var<storage,read> beta_z: array<f32>; // [z+1,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

fn get_Ix(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Ix[k*(Mx*My) + j*Mx + i];
}

fn get_Iy(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Iy[k*(Mx*My) + j*Mx + i];
}

fn get_Iz(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Iz[k*(Mx*My) + j*Mx + i];
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
    let Ix_ij1k0 = get_Ix(i,j,k-1);
    let Ix_ij1k1 = get_Ix(i,j,k);
    let Ix_ij0k1 = get_Ix(i,j-1,k);

    let Iy_i0jk1 = get_Iy(i-1,j,k);
    let Iy_i1jk1 = get_Iy(i,j,k);
    let Iy_i1jk0 = get_Iy(i,j,k-1);

    let Iz_i0j1k = get_Iz(i-1,j,k);
    let Iz_i1j1k = get_Iz(i,j,k);
    let Iz_i1j0k = get_Iz(i,j-1,k);

    if (i < Nx) {
        // Equation 3.8
        let cIx_i1jk = -Iz_i1j0k - Iy_i1jk1 + Iz_i1j1k + Iy_i1jk0;
        let index_Vx_i1jk = get_clamped_index(i,j,k,Nx,Ny+1,Nz+1);
        Vx[index_Vx_i1jk] = alpha_x[index_Vx_i1jk]*(Vx[index_Vx_i1jk] + beta_x[index_Vx_i1jk]*cIx_i1jk);
    }

    if (j < Ny) {
        // Equation 3.9
        let cIy_ij1k = -Ix_ij1k0 - Iz_i1j1k + Ix_ij1k1 + Iz_i0j1k;
        let index_Vy_ij1k = get_clamped_index(i,j,k,Nx+1,Ny,Nz+1);
        Vy[index_Vy_ij1k] = alpha_y[index_Vy_ij1k]*(Vy[index_Vy_ij1k] + beta_y[index_Vy_ij1k]*cIy_ij1k);
    }

    if (k < Nz) {
        // Equation 3.10
        let cIz_ijk1 = -Iy_i0jk1 - Ix_ij1k1 + Iy_i1jk1 + Ix_ij0k1;
        let index_Vz_ijk1 = get_clamped_index(i,j,k,Nx+1,Ny+1,Nz);
        Vz[index_Vz_ijk1] = alpha_z[index_Vz_ijk1]*(Vz[index_Vz_ijk1] + beta_z[index_Vz_ijk1]*cIz_ijk1);
    }
}