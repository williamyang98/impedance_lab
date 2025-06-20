struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> E: array<f32>;
@group(0) @binding(2) var<storage,read> H: array<f32>;
@group(0) @binding(3) var<storage,read> A0: array<f32>;
@group(0) @binding(4) var<storage,read> A1: array<f32>;
// a0 = 1/(1+sigma_k/e_k*dt)
// a1 = 1/(e_k*d_xyz) * dt

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

@compute
@workgroup_size(workgroup_size_x, workgroup_size_y, workgroup_size_z)
fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
    let _i = vec3<u32>(_j.z, _j.y, _j.x);
    let Nx = params.size_x;
    let Ny = params.size_y;
    let Nz = params.size_z;
    let n_dims: u32 = u32(3);
    let Nzy = Nz*Ny;

    let ix = _i.x;
    let iy = _i.y;
    let iz = _i.z;
    if (ix >= Nx) { return; }
    if (iy >= Ny) { return; }
    if (iz >= Nz) { return; }

    let i0 = iz + iy*Nz + ix*Nzy;
    let i = n_dims*i0;

    // curl(H) with dirchlet boundary condition
    var dHz_dy = -H[i+2];
    var dHy_dz = -H[i+1];
    var dHx_dz = -H[i+0];
    var dHz_dx = -H[i+2];
    var dHy_dx = -H[i+1];
    var dHx_dy = -H[i+0];

    if (iz < (Nz-1)) {
        let dz = n_dims*((iz+1) + iy*Nz + ix*Nzy);
        dHy_dz += H[dz+1];
        dHx_dz += H[dz+0];
    }

    if (iy < (Ny-1)) {
        let dy = n_dims*(iz + (iy+1)*Nz + ix*Nzy);
        dHz_dy += H[dy+2];
        dHx_dy += H[dy+0];
    }

    if (ix < (Nx-1)) {
        let dx = n_dims*(iz + iy*Nz + (ix+1)*Nzy);
        dHz_dx += H[dx+2];
        dHy_dx += H[dx+1];
    }

    let cHx = dHz_dy-dHy_dz;
    let cHy = dHx_dz-dHz_dx;
    let cHz = dHy_dx-dHx_dy;

    let a0 = A0[i0];
    let a1 = A1[i0];

    E[i+0] = a0*(E[i+0] + a1*cHx);
    E[i+1] = a0*(E[i+1] + a1*cHy);
    E[i+2] = a0*(E[i+2] + a1*cHz);
}