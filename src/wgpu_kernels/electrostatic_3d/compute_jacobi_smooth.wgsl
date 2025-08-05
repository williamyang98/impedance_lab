struct Params {
    grid_size_x: u32,
    grid_size_y: u32,
    grid_size_z: u32,
    beta: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
// Ax=b
@group(0) @binding(1) var<storage,read_write> xout_buf: array<f32>;
@group(0) @binding(2) var<storage,read> xin_buf: array<f32>;
@group(0) @binding(3) var<storage,read> b_buf: array<f32>;
@group(0) @binding(4) var<storage,read> mask_buf: array<u32>;
// grid spline
@group(0) @binding(5) var<storage,read> dx_buf: array<f32>;
@group(0) @binding(6) var<storage,read> dy_buf: array<f32>;
@group(0) @binding(7) var<storage,read> dz_buf: array<f32>;

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 1;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
    let Nx = params.grid_size_x;
    let Ny = params.grid_size_y;
    let Nz = params.grid_size_z;

    // out bounds
    let ix = _j.x;
    let iy = _j.y;
    let iz = _j.z;
    if (ix >= Nx) { return; }
    if (iy >= Ny) { return; }
    if (iz >= Nz) { return; }

    let Nxy = Nx*Ny;
    let i: u32 = ix + iy*Nx + iz*Nxy;

    // mask is packed into 1bit within 32bit buffer
    const mask_pack: u32 = 32;
    let imask: u32 = i/mask_pack;
    let imask_offset: u32 = i-imask*mask_pack;

    let b: f32 = b_buf[i];

    let is_dirchlet_boundary: u32 = (mask_buf[imask] >> imask_offset) & 0x01;
    if (is_dirchlet_boundary == 1) {
        // Ax=b, A=1
        // x=b
        xout_buf[i] = b;
        return;
    }

    // Ax=b
    // Ax = div(E) = b, div(E) = sum (V-Vi)/ds
    // sum (V/ds) = b + sum Vi/ds
    // V = (b + sum Vi/ds) / sum 1/ds
    var div_E: f32 = b; // b + sum Vi/ds
    var denom: f32 = 0; // sum 1/ds
    if (ix > 0 && ix < Nx-1) {
        // enforce div(Ex) only if there are Ex field lines on both sides of voltage grid point
        div_E += xin_buf[i-1]/dx_buf[ix-1];
        div_E += xin_buf[i+1]/dx_buf[ix];
    }
    if (ix > 0) { denom += 1.0/dx_buf[ix-1]; }
    if (ix < Nx-1) { denom += 1.0/dx_buf[ix]; }

    if (iy > 0 && iy < Ny-1) {
        // enforce div(Ey) only if there are Ey field lines on both sides of voltage grid point
        div_E += xin_buf[i-Nx]/dy_buf[iy-1];
        div_E += xin_buf[i+Nx]/dy_buf[iy];
    }
    if (iy > 0) { denom += 1.0/dy_buf[iy-1]; }
    if (iy < Ny-1) { denom += 1.0/dy_buf[iy]; }

    if (iz > 0 && iz < Nz-1) {
        // enforce div(Ez) onlz if there are Ez field lines on both sides of voltage grid point
        div_E += xin_buf[i-Nxy]/dz_buf[iz-1];
        div_E += xin_buf[i+Nxy]/dz_buf[iz];
    }
    if (iz > 0) { denom += 1.0/dz_buf[iz-1]; }
    if (iz < Nz-1) { denom += 1.0/dz_buf[iz]; }

    let x_next: f32 = div_E/denom;
    let beta: f32 = params.beta;
    xout_buf[i] = (1.0-beta)*xin_buf[i] + beta*x_next;
}
