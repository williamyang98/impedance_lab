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
    // Ax = div(E) = b
    // div(E) = - (V[z,y,x+1]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[z,y,x]
    //          + (V[z,y,x+0]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[z,y,x]
    //          + (V[z,y,x+0]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[z,y,x-1]
    //          - (V[z,y,x-1]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[z,y,x-1]
    //          - (V[z,y+1,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[z,y,x]
    //          + (V[z,y+0,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[z,y,x]
    //          + (V[z,y+0,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[z,y-1,x]
    //          - (V[z,y-1,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[z,y-1,x]
    //          - (V[z+1,y,x]/dz[z+0])/(dz[z]+dz[z-1]) # Ez[z,y,x]
    //          + (V[z+0,y,x]/dz[z+0])/(dz[z]+dz[z-1]) # Ez[z,y,x]
    //          + (V[z+0,y,x]/dz[z-1])/(dz[z]+dz[z-1]) # Ez[z-1,y,x]
    //          - (V[z-1,y,x]/dz[z-1])/(dz[z]+dz[z-1]) # Ez[z-1,y,x]

    var rhs: f32 = b;
    var denom: f32 = 0;
    var has_div: bool = false;
    if (ix > 0 && ix < Nx-1) {
        let dx0 = dx_buf[ix-1];
        let dx1 = dx_buf[ix];
        let norm = dx0+dx1;
        rhs += (xin_buf[i-1]/dx0)/norm;
        rhs += (xin_buf[i+1]/dx1)/norm;
        denom += (1.0/dx0+1.0/dx1)/norm;
        has_div = true;
    }

    if (iy > 0 && iy < Ny-1) {
        let dy0 = dy_buf[iy-1];
        let dy1 = dy_buf[iy];
        let norm = dy0+dy1;
        rhs += (xin_buf[i-Nx]/dy0)/norm;
        rhs += (xin_buf[i+Nx]/dy1)/norm;
        denom += (1.0/dy0+1.0/dy1)/norm;
        has_div = true;
    }

    if (iz > 0 && iz < Nz-1) {
        let dz0 = dz_buf[iz-1];
        let dz1 = dz_buf[iz];
        let norm = dz0+dz1;
        rhs += (xin_buf[i-Nxy]/dz0)/norm;
        rhs += (xin_buf[i+Nxy]/dz1)/norm;
        denom += (1.0/dz0+1.0/dz1)/norm;
        has_div = true;
    }

    if (!has_div) {
        rhs = 0;
        denom = 1;
    }

    let x_next: f32 = rhs/denom;
    let beta: f32 = params.beta;
    xout_buf[i] = (1.0-beta)*xin_buf[i] + beta*x_next;
}
