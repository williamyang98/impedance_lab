struct Params {
    size_x: u32,
    size_y: u32,
    size_z: u32,
    dt: f32,
    max_R: f32,
    _pad_0: u32,
    _pad_1: u32,
    _pad_2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage,read> Rx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(2) var<storage,read> Ry: array<f32>; // [z+1,y,x+1]
@group(0) @binding(3) var<storage,read> Rz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(4) var<storage,read> Cx: array<f32>; // [z+1,y+1,x]
@group(0) @binding(5) var<storage,read> Cy: array<f32>; // [z+1,y,x+1]
@group(0) @binding(6) var<storage,read> Cz: array<f32>; // [z,y+1,x+1]
@group(0) @binding(7) var<storage,read_write> alpha_x: array<f32>; // [z+1,y+1,x]
@group(0) @binding(8) var<storage,read_write> alpha_y: array<f32>; // [z+1,y,x+1]
@group(0) @binding(9) var<storage,read_write> alpha_z: array<f32>; // [z,y+1,x+1]
@group(0) @binding(10) var<storage,read_write> beta_x: array<f32>; // [z+1,y+1,x]
@group(0) @binding(11) var<storage,read_write> beta_y: array<f32>; // [z+1,y,x+1]
@group(0) @binding(12) var<storage,read_write> beta_z: array<f32>; // [z,y+1,x+1]

override workgroup_size_x = 16;
override workgroup_size_y = 16;
override workgroup_size_z = 16;

fn get_clamped_index(_i: i32, _j: i32, _k: i32, Mx: i32, My: i32, Mz: i32) -> i32 {
    let i = clamp(_i, 0, Mx-1);
    let j = clamp(_j, 0, My-1);
    let k = clamp(_k, 0, Mz-1);
    return k*(Mx*My) + j*Mx + i;
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

    // alpha = 1/(1+dt/RC) (Equation 3.6)
    // beta = dt/C (Equation 3.7)
    if (i < Nx) {
        let index_Vx_i1jk = get_clamped_index(i,j,k,Nx,Ny+1,Nz+1);
        let C = Cx[index_Vx_i1jk];
        let R = Rx[index_Vx_i1jk];
        var alpha = 1.0;
        if (R < params.max_R) {
            let tau = R*C;
            alpha = tau/(tau + params.dt);
        }
        let beta = params.dt/C;
        // bake
        alpha_x[index_Vx_i1jk] = alpha;
        beta_x[index_Vx_i1jk] = beta;
    }

    if (j < Ny) {
        let index_Vy_ij1k = get_clamped_index(i,j,k,Nx+1,Ny,Nz+1);
        let C = Cy[index_Vy_ij1k];
        let R = Ry[index_Vy_ij1k];
        var alpha = 1.0;
        if (R < params.max_R) {
            let tau = R*C;
            alpha = tau/(tau + params.dt);
        }
        let beta = params.dt/C;
        // bake
        alpha_y[index_Vy_ij1k] = alpha;
        beta_y[index_Vy_ij1k] = beta;
    }

    if (k < Nz) {
        let index_Vz_ijk1 = get_clamped_index(i,j,k,Nx+1,Ny+1,Nz);
        let C = Cz[index_Vz_ijk1];
        let R = Rz[index_Vz_ijk1];
        var alpha = 1.0;
        if (R < params.max_R) {
            let tau = R*C;
            alpha = tau/(tau + params.dt);
        }
        let beta = params.dt/C;
        // bake
        alpha_z[index_Vz_ijk1] = alpha;
        beta_z[index_Vz_ijk1] = beta;
    }
}