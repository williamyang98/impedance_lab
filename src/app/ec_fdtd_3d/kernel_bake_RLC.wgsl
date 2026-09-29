struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    max_R: f32,
    max_L: f32,
    _pad_0: u32,
    _pad_1: u32,
    _pad_2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> dx: array<f32>; // [x]
@group(0) @binding(2) var<storage,read> dy: array<f32>; // [y]
@group(0) @binding(3) var<storage,read> dz: array<f32>; // [z]
@group(0) @binding(4) var<storage,read> epsilon_r: array<f32>; // [z,y,x]
@group(0) @binding(5) var<storage,read> sigma_k: array<f32>; // [z,y,x]
@group(0) @binding(6) var<storage,read> mu_r: array<f32>; // [z,y,x]
@group(0) @binding(7) var<storage,read_write> Rx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(8) var<storage,read_write> Ry: array<f32>; // [z+1,y,x+1]
@group(0) @binding(9) var<storage,read_write> Rz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(10) var<storage,read_write> Cx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(11) var<storage,read_write> Cy: array<f32>; // [z+1,y,x+1]
@group(0) @binding(12) var<storage,read_write> Cz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(13) var<storage,read_write> Lx: array<f32>; // [z,y,x+1]
@group(0) @binding(14) var<storage,read_write> Ly: array<f32>; // [z,y+1,x]
@group(0) @binding(15) var<storage,read_write> Lz: array<f32>; // [z+1,y,x]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

const epsilon_0: f32 = 8.85e-12;
const mu_0: f32 = 1.26e-6;
const max_mu_r: f32 = 1.0e14; // simulate boundary

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
}

fn get_epsilon_r(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return epsilon_r[k*(Mx*My) + j*Mx + i];
}

fn get_sigma_k(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return 0.0; }
    if (j < 0 || j >= My) { return 0.0; }
    if (k < 0 || k >= Mz) { return 0.0; }
    return sigma_k[k*(Mx*My) + j*Mx + i];
}

fn get_mu_r(i: i32, j: i32, k: i32) -> f32 {
    let Mx = i32(params.size_x);
    let My = i32(params.size_y);
    let Mz = i32(params.size_z);
    if (i < 0 || i >= Mx) { return max_mu_r; }
    if (j < 0 || j >= My) { return max_mu_r; }
    if (k < 0 || k >= Mz) { return max_mu_r; }
    return mu_r[k*(Mx*My) + j*Mx + i];
}

fn get_dx(i: i32) -> f32 {
    return dx[clamp(i, 0, i32(params.size_x-1))];
}

fn get_dy(j: i32) -> f32 {
    return dy[clamp(j, 0, i32(params.size_y-1))];
}

fn get_dz(k: i32) -> f32 {
    return dz[clamp(k, 0, i32(params.size_z-1))];
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

    // Edge components R,C
    // R = L/(sigma*A) (Equation 3.3)
    // C = epsilon*A/d (Equation 3.1)
    // R_parallel = 1/sum(1/R) = 1/sum(sigma*A/L) = 1/[1/L*sum(sigma*A)] = L/sum(sigma*A)
    // C_parallel = sum(C) = sum(epsilon*A)/d
    if (i < Nx) {
        let dx_i = get_dx(i);
        let dy_j = get_dy(j);
        let dy_j0 = get_dy(j-1);
        let dz_k = get_dz(k);
        let dz_k0 = get_dz(k-1);
        // area
        let A_jk = dy_j*dz_k*0.25;
        let A_j0k = dy_j0*dz_k*0.25;
        let A_jk0 = dy_j*dz_k0*0.25;
        let A_j0k0 = dy_j0*dz_k0*0.25;
        // capacitance
        let epsilon_r_jk = get_epsilon_r(i,j,k);
        let epsilon_r_j0k = get_epsilon_r(i,j-1,k);
        let epsilon_r_jk0 = get_epsilon_r(i,j,k-1);
        let epsilon_r_j0k0 = get_epsilon_r(i,j-1,k-1);
        let C = (epsilon_r_jk*A_jk + epsilon_r_j0k*A_j0k + epsilon_r_jk0*A_jk0 + epsilon_r_j0k0*A_j0k0)*epsilon_0/dx_i;
        // resistance
        let sigma_k_jk = get_sigma_k(i,j,k);
        let sigma_k_j0k = get_sigma_k(i,j-1,k);
        let sigma_k_jk0 = get_sigma_k(i,j,k-1);
        let sigma_k_j0k0 = get_sigma_k(i,j-1,k-1);
        let sigma = sigma_k_jk*A_jk + sigma_k_j0k*A_j0k + sigma_k_jk0*A_jk0 + sigma_k_j0k0*A_j0k0;
        let R = min(dx_i/sigma, params.max_R);
        // bake
        let index_Vx_i1jk = get_clamped_index(i,j,k,Nx,Ny+1,Nz+1);
        Rx[index_Vx_i1jk] = R;
        Cx[index_Vx_i1jk] = C;
    }

    if (j < Ny) {
        let dx_i = get_dx(i);
        let dx_i0 = get_dx(i-1);
        let dy_j = get_dy(j);
        let dz_k = get_dz(k);
        let dz_k0 = get_dz(k-1);
        // area
        let A_ik = dx_i*dz_k*0.25;
        let A_i0k = dx_i0*dz_k*0.25;
        let A_ik0 = dx_i*dz_k0*0.25;
        let A_i0k0 = dx_i0*dz_k0*0.25;
        // capacitance
        let epsilon_r_ik = get_epsilon_r(i,j,k);
        let epsilon_r_i0k = get_epsilon_r(i-1,j,k);
        let epsilon_r_ik0 = get_epsilon_r(i,j,k-1);
        let epsilon_r_i0k0 = get_epsilon_r(i-1,j,k-1);
        let C = (epsilon_r_ik*A_ik + epsilon_r_i0k*A_i0k + epsilon_r_ik0*A_ik0 + epsilon_r_i0k0*A_i0k0)*epsilon_0/dy_j;
        // resistance
        let sigma_k_ik = get_sigma_k(i,j,k);
        let sigma_k_i0k = get_sigma_k(i-1,j,k);
        let sigma_k_ik0 = get_sigma_k(i,j,k-1);
        let sigma_k_i0k0 = get_sigma_k(i-1,j,k-1);
        let sigma = sigma_k_ik*A_ik + sigma_k_i0k*A_i0k + sigma_k_ik0*A_ik0 + sigma_k_i0k0*A_i0k0;
        let R = min(dy_j/sigma, params.max_R);
        // bake
        let index_Vy_ij1k = get_clamped_index(i,j,k,Nx+1,Ny,Nz+1);
        Ry[index_Vy_ij1k] = R;
        Cy[index_Vy_ij1k] = C;
    }

    if (k < Nz) {
        let dx_i = get_dx(i);
        let dx_i0 = get_dx(i-1);
        let dy_j = get_dy(j);
        let dy_j0 = get_dy(j-1);
        let dz_k = get_dz(k);
        // area
        let A_ij = dx_i*dy_j*0.25;
        let A_i0j = dx_i0*dy_j*0.25;
        let A_ij0 = dx_i*dy_j0*0.25;
        let A_i0j0 = dx_i0*dy_j0*0.25;
        // capacitance
        let epsilon_r_ij = get_epsilon_r(i,j,k);
        let epsilon_r_i0j = get_epsilon_r(i-1,j,k);
        let epsilon_r_ij0 = get_epsilon_r(i,j-1,k);
        let epsilon_r_i0j0 = get_epsilon_r(i-1,j-1,k);
        let C = (epsilon_r_ij*A_ij + epsilon_r_i0j*A_i0j + epsilon_r_ij0*A_ij0 + epsilon_r_i0j0*A_i0j0)*epsilon_0/dz_k;
        // resistance
        let sigma_k_ij = get_sigma_k(i,j,k);
        let sigma_k_i0j = get_sigma_k(i-1,j,k);
        let sigma_k_ij0 = get_sigma_k(i,j-1,k);
        let sigma_k_i0j0 = get_sigma_k(i-1,j-1,k);
        let sigma = sigma_k_ij*A_ij + sigma_k_i0j*A_i0j + sigma_k_ij0*A_ij0 + sigma_k_i0j0*A_i0j0;
        let R = min(dz_k/sigma, params.max_R);
        // bake
        let index_Vz_ijk1 = get_clamped_index(i,j,k,Nx+1,Ny+1,Nz);
        Rz[index_Vz_ijk1] = R;
        Cz[index_Vz_ijk1] = C;
    }

    // Face components: L
    // L = mu*A/d (Equation 3.2)
    // L_parallel = 1/sum(1/L) = 1/sum(d/(mu*A)) = 1/[1/A*sum(d/mu)] = A/sum(d/mu)
    if (j < Ny && k < Nz) {
        let dx_i = get_dx(i);
        let dx_i0 = get_dx(i-1);
        let dy_j = get_dy(j);
        let dz_k = get_dz(k);
        // area
        let A_jk = dy_j*dz_k;
        // inductance
        let mu_r_i = get_mu_r(i,j,k);
        let mu_r_i0 = get_mu_r(i-1,j,k);
        let L = min(A_jk/(dx_i/mu_r_i + dx_i0/mu_r_i0)*mu_0, params.max_L);
        // bake
        let index_Ix_ij1k1 = get_clamped_index(i,j,k,Nx+1,Ny,Nz);
        Lx[index_Ix_ij1k1] = L;
    }

    if (i < Nx && k < Nz) {
        let dx_i = get_dx(i);
        let dy_j = get_dy(j);
        let dy_j0 = get_dy(j-1);
        let dz_k = get_dz(k);
        // area
        let A_ik = dx_i*dz_k;
        // inductance
        let mu_r_j = get_mu_r(i,j,k);
        let mu_r_j0 = get_mu_r(i,j-1,k);
        let L = min(A_ik/(dy_j/mu_r_j + dy_j0/mu_r_j0)*mu_0, params.max_L);
        // bake
        let index_Iy_i1jk1 = get_clamped_index(i,j,k,Nx,Ny+1,Nz);
        Ly[index_Iy_i1jk1] = L;
    }

    if (i < Nx && j < Ny) {
        let dx_i = get_dx(i);
        let dy_j = get_dy(j);
        let dz_k = get_dz(k);
        let dz_k0 = get_dz(k-1);
        // area
        let A_ij = dx_i*dy_j;
        // inductance
        let mu_r_k = get_mu_r(i,j,k);
        let mu_r_k0 = get_mu_r(i,j,k-1);
        let L = min(A_ij/(dz_k/mu_r_k + dz_k0/mu_r_k0)*mu_0, params.max_L);
        // bake
        let index_Iz_i1j1k = get_clamped_index(i,j,k,Nx,Ny,Nz+1);
        Lz[index_Iz_i1j1k] = L;
    }
}