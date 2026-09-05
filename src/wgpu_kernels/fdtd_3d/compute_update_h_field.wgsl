struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> dx: array<f32>; // [x]
@group(0) @binding(2) var<storage,read> dy: array<f32>; // [y]
@group(0) @binding(3) var<storage,read> dz: array<f32>; // [z]
@group(0) @binding(4) var<storage,read_write> Hx: array<f32>; // [z,y,x+1]
@group(0) @binding(5) var<storage,read_write> Hy: array<f32>; // [z,y+1,x]
@group(0) @binding(6) var<storage,read_write> Hz: array<f32>; // [z+1,y,x]
@group(0) @binding(7) var<storage,read> Ex: array<f32>; // [z+1,y+1,x]
@group(0) @binding(8) var<storage,read> Ey: array<f32>; // [z+1,y,x+1]
@group(0) @binding(9) var<storage,read> Ez: array<f32>; // [z,y+1,x+1]
@group(0) @binding(10) var<storage,read> phi: array<f32>; // [z,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

fn get_Ex(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Ex[k*(Mx*My) + j*Mx + i];
}

fn get_Ey(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Ey[k*(Mx*My) + j*Mx + i];
}

fn get_Ez(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Ez[k*(Mx*My) + j*Mx + i];
}

fn get_phi(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    let index = get_clamped_index(i, j, k, Mx, My, Mz);
    return phi[index];
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

    let dx_i1 = dx[clamp(i,0,Nx-1)];
    let dy_j1 = dy[clamp(j,0,Ny-1)];
    let dz_k1 = dz[clamp(k,0,Nz-1)];

    let phi_ijk = phi[get_clamped_index(i,j,k,Nx,Ny,Nz)];

    let Ex_i1jk = get_Ex(i,j,k);
    let Ex_i1jk2 = get_Ex(i,j,k+1);
    let Ex_i1j2k = get_Ex(i,j+1,k);

    let Ey_ij1k = get_Ey(i,j,k);
    let Ey_ij1k2 = get_Ey(i,j,k+1);
    let Ey_i2j1k = get_Ey(i+1,j,k);

    let Ez_ijk1 = get_Ez(i,j,k);
    let Ez_i2jk1 = get_Ez(i+1,j,k);
    let Ez_ij2k1 = get_Ez(i,j+1,k);

    let cEx_ij1k1 = Ez_ijk1/dy_j1 + Ey_ij1k2/dz_k1 - Ez_ij2k1/dy_j1 - Ey_ij1k/dz_k1;
    let cEy_i1jk1 = Ex_i1jk/dz_k1 + Ez_i2jk1/dx_i1 - Ex_i1jk2/dz_k1 - Ez_ijk1/dx_i1;
    let cEz_i1j1k = Ey_ij1k/dx_i1 + Ex_i1j2k/dy_j1 - Ey_i2j1k/dx_i1 - Ex_i1jk/dy_j1;

    let phi_i1j1k1 = get_phi(i,j,k);
    let phi_i0j1k1 = get_phi(i-1,j,k);
    let phi_i1j0k1 = get_phi(i,j-1,k);
    let phi_i1j1k0 = get_phi(i,j,k-1);

    let phi_ij1k1 = (phi_i1j1k1+phi_i0j1k1)/2.0;
    let phi_i1jk1 = (phi_i1j1k1+phi_i1j0k1)/2.0;
    let phi_i1j1k = (phi_i1j1k1+phi_i1j1k0)/2.0;

    if (j < Ny && k < Nz) {
        // Equation 1.7
        let index_Hx_ij1k1 = get_clamped_index(i,j,k,Nx+1,Ny,Nz);
        Hx[index_Hx_ij1k1] = Hx[index_Hx_ij1k1] - phi_ij1k1*cEx_ij1k1;
    }

    if (i < Nx && k < Nz) {
        // Equation 1.8
        let index_Hy_i1jk1 = get_clamped_index(i,j,k,Nx,Ny+1,Nz);
        Hy[index_Hy_i1jk1] = Hy[index_Hy_i1jk1] - phi_i1jk1*cEy_i1jk1;
    }

    if (i < Nx && j < Ny) {
        // Equation 1.9
        let index_Hz_i1j1k = get_clamped_index(i,j,k,Nx,Ny,Nz+1);
        Hz[index_Hz_i1j1k] = Hz[index_Hz_i1j1k] - phi_i1j1k*cEz_i1j1k;
    }
}