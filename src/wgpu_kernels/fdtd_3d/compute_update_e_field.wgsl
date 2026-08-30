struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> dx: array<f32>; // [x]
@group(0) @binding(2) var<storage,read> dy: array<f32>; // [y]
@group(0) @binding(3) var<storage,read> dz: array<f32>; // [z]
@group(0) @binding(4) var<storage,read_write> Ex: array<f32>; // [z+1,y+1,x]
@group(0) @binding(5) var<storage,read_write> Ey: array<f32>; // [z+1,y,x+1]
@group(0) @binding(6) var<storage,read_write> Ez: array<f32>; // [z,y+1,x+1]
@group(0) @binding(7) var<storage,read> Hx: array<f32>; // [z,y,x+1]
@group(0) @binding(8) var<storage,read> Hy: array<f32>; // [z,y+1,x]
@group(0) @binding(9) var<storage,read> Hz: array<f32>; // [z+1,y,x]
@group(0) @binding(10) var<storage,read> alpha: array<f32>; // [z,y,x]
@group(0) @binding(11) var<storage,read> beta: array<f32>; // [z,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

fn get_Hx(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x+1);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Hx[k*(Mx*My) + j*Mx + i];
}

fn get_Hy(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y+1);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Hy[k*(Mx*My) + j*Mx + i];
}

fn get_Hz(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z+1);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return Hz[k*(Mx*My) + j*Mx + i];
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

    let dx_i = (dx[clamp(i-1,0,Nx-1)] + dx[clamp(i,0,Nx-1)])/2.0;
    let dy_j = (dy[clamp(j-1,0,Ny-1)] + dy[clamp(j,0,Ny-1)])/2.0;
    let dz_k = (dz[clamp(k-1,0,Nz-1)] + dz[clamp(k,0,Nz-1)])/2.0;

    let alpha_ijk = alpha[get_clamped_index(i,j,k,Nx,Ny,Nz)];
    let beta_ijk = beta[get_clamped_index(i,j,k,Nx,Ny,Nz)];

    let Hx_ij1k0 = get_Hx(i,j,k-1);
    let Hx_ij1k1 = get_Hx(i,j,k);
    let Hx_ij0k1 = get_Hx(i,j-1,k);

    let Hy_i0jk1 = get_Hy(i-1,j,k);
    let Hy_i1jk1 = get_Hy(i,j,k);
    let Hy_i1jk0 = get_Hy(i,j,k-1);

    let Hz_i0j1k = get_Hz(i-1,j,k);
    let Hz_i1j1k = get_Hz(i,j,k);
    let Hz_i1j0k = get_Hz(i,j-1,k);

    let cHx_i1jk = Hz_i1j0k/dy_j + Hy_i1jk1/dz_k - Hz_i1j1k/dy_j - Hy_i1jk0/dz_k;
    let cHy_ij1k = Hx_ij1k0/dz_k + Hz_i1j1k/dx_i - Hx_ij1k1/dz_k - Hz_i0j1k/dx_i;
    let cHz_ijk1 = Hy_i0jk1/dx_i + Hx_ij1k1/dy_j - Hy_i1jk1/dx_i - Hx_ij0k1/dy_j;

    if (i < Nx) {
        let index_Ex_i1jk = get_clamped_index(i,j,k,Nx,Ny+1,Nz+1);
        Ex[index_Ex_i1jk] = alpha_ijk*(Ex[index_Ex_i1jk] + beta_ijk*cHx_i1jk);
    }

    if (j < Ny) {
        let index_Ey_ij1k = get_clamped_index(i,j,k,Nx+1,Ny,Nz+1);
        Ey[index_Ey_ij1k] = alpha_ijk*(Ey[index_Ey_ij1k] + beta_ijk*cHy_ij1k);
    }

    if (k < Nz) {
        let index_Ez_ijk1 = get_clamped_index(i,j,k,Nx+1,Ny+1,Nz);
        Ez[index_Ez_ijk1] = alpha_ijk*(Ez[index_Ez_ijk1] + beta_ijk*cHz_ijk1);
    }
}