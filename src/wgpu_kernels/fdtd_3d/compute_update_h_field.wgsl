struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    // b0 = 1/(mu_k*d_xyz) * dt
    b0: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read_write> H: array<f32>;
@group(0) @binding(2) var<storage,read> E: array<f32>;

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

    var dEz_dy = E[i+2];
    var dEy_dz = E[i+1];
    var dEx_dz = E[i+0];
    var dEz_dx = E[i+2];
    var dEy_dx = E[i+1];
    var dEx_dy = E[i+0];

    if (iz > 0) {
        let dz = n_dims*((iz-1) + iy*Nz + ix*Nzy);
        dEy_dz -= E[dz+1];
        dEx_dz -= E[dz+0];
    }

    if (iy > 0) {
        let dy = n_dims*(iz + (iy-1)*Nz + ix*Nzy);
        dEz_dy -= E[dy+2];
        dEx_dy -= E[dy+0];
    }

    if (ix > 0) {
        let dx = n_dims*(iz + iy*Nz + (ix-1)*Nzy);
        dEz_dx -= E[dx+2];
        dEy_dx -= E[dx+1];
    }

    let cEx = dEz_dy-dEy_dz;
    let cEy = dEx_dz-dEz_dx;
    let cEz = dEy_dx-dEx_dy;

    let b0 = params.b0;
    H[i+0] = H[i+0] - b0*cEx;
    H[i+1] = H[i+1] - b0*cEy;
    H[i+2] = H[i+2] - b0*cEz;
}