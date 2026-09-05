struct Params {
    grid_size_x: u32,
    grid_size_y: u32,
    grid_size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
// Av=b
@group(0) @binding(1) var<storage,read_write> r_out: array<f32>;
@group(0) @binding(2) var<storage,read> v_in: array<f32>;
@group(0) @binding(3) var<storage,read> b: array<f32>;
@group(0) @binding(4) var<storage,read> mask: array<u32>;
// grid spline
@group(0) @binding(5) var<storage,read> dx: array<f32>;
@group(0) @binding(6) var<storage,read> dy: array<f32>;
@group(0) @binding(7) var<storage,read> dz: array<f32>;

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 1;

fn get_v_in(i: i32, j: i32, k: i32) -> f32 {
    let Nx = i32(params.grid_size_x);
    let Ny = i32(params.grid_size_y);
    let Mx = Nx+1;
    let My = Ny+1;
    let Mxy = Mx*My;
    let ijk: i32 = i + j*Mx + k*Mxy;
    return v_in[ijk];
}

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _index: vec3<u32>) {
    let Nx = i32(params.grid_size_x);
    let Ny = i32(params.grid_size_y);
    let Nz = i32(params.grid_size_z);
    let Mx = Nx+1;
    let My = Ny+1;
    let Mz = Nz+1;

    let i = i32(_index.x);
    let j = i32(_index.y);
    let k = i32(_index.z);

    if (i >= Mx) { return; }
    if (j >= My) { return; }
    if (k >= Mz) { return; }

    let Mxy = Mx*My;
    let ijk: i32 = i + j*Mx + k*Mxy;

    // mask is packed into 1bit within 32bit buffer
    const mask_total_bits: u32 = 32;
    let mask_index: u32 = u32(ijk)/mask_total_bits;
    let mask_offset: u32 = u32(ijk)-mask_index*mask_total_bits;
    let mask_ijk = (mask[mask_index] >> mask_offset) & 0x01;
    let b_ijk: f32 = b[ijk];

    // a_n = A[m,n] where m = i + j*Mx + k*Mxy
    // forcing voltage potential constraint at node
    if (mask_ijk == 1) {
        // Av=b
        // a_ijk = 1 (Equation 2.3)
        // v_ijk = b (Equation 2.4)
        r_out[ijk] = 0;
        return;
    }

    // ijk = i,j,k
    // i0jk = i-0.5,j,k
    // i1jk = i+0.5,j,k
    let dx_i0 = dx[clamp(i-1,0,Nx-1)];
    let dx_i1 = dx[clamp(i,0,Nx-1)];
    let dy_j0 = dy[clamp(j-1,0,Ny-1)];
    let dy_j1 = dy[clamp(j,0,Ny-1)];
    let dz_k0 = dz[clamp(k-1,0,Nz-1)];
    let dz_k1 = dz[clamp(k,0,Nz-1)];
    let dx_i = (dx_i0+dx_i1)/2.0;
    let dy_j = (dy_j0+dy_j1)/2.0;
    let dz_k = (dz_k0+dz_k1)/2.0;

    // Ax=b
    // Ax = div(E) = b (Equation 2.1)
    let a_ijk = -1.0/(dx_i*dx_i1)-1.0/(dy_j*dy_j1)-1.0/(dz_k*dz_k1)-1.0/(dx_i*dx_i0)-1.0/(dy_j*dy_j0)-1.0/(dz_k*dz_k0);
    let v_ijk = v_in[ijk];

    var sum_avk: f32 = 0;
    sum_avk += a_ijk*v_ijk;
    if (i > 0) {
        let a_i0jk = 1.0/(dx_i*dx_i0);
        let v_i0jk = get_v_in(i-1,j,k);
        sum_avk += a_i0jk*v_i0jk;
    }
    if (i < Nx) {
        let a_i1jk = 1.0/(dx_i*dx_i1);
        let v_i1jk = get_v_in(i+1,j,k);
        sum_avk += a_i1jk*v_i1jk;
    }
    if (j > 0) {
        let a_ij0k = 1.0/(dy_j*dy_j0);
        let v_ij0k = get_v_in(i,j-1,k);
        sum_avk += a_ij0k*v_ij0k;
    }
    if (j < Ny) {
        let a_ij1k = 1.0/(dy_j*dy_j1);
        let v_ij1k = get_v_in(i,j+1,k);
        sum_avk += a_ij1k*v_ij1k;
    }
    if (k > 0) {
        let a_ijk0 = 1.0/(dz_k*dz_k0);
        let v_ijk0 = get_v_in(i,j,k-1);
        sum_avk += a_ijk0*v_ijk0;
    }
    if (k < Nz) {
        let a_ijk1 = 1.0/(dz_k*dz_k1);
        let v_ijk1 = get_v_in(i,j,k+1);
        sum_avk += a_ijk1*v_ijk1;
    }

    // b_ijk = 0 for zero charge regions (Equation 2.2)
    // r_ijk = b_ijk - sum_avk (Equation 2.5)
    // r_ijk = -sum_avk
    r_out[ijk] = -sum_avk;
}
