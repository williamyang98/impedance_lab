use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub unsafe fn bake_2d(
    dx: &[f32], dy: &[f32],
    dx_mid: &mut [f32], dy_mid: &mut [f32],
    dxy_norm: &mut [f32],
) {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    assert!(dx_mid.len() == nx-1);
    assert!(dy_mid.len() == ny-1);
    assert!(dxy_norm.len() == (nx-1)*(ny-1));

    for i in 0..nx-1 {
        dx_mid[i] = (dx[i]+dx[i+1])/2.0;
    }
    for i in 0..ny-1 {
        dy_mid[i] = (dy[i]+dy[i+1])/2.0;
    }
    for y in 0..ny-1 {
        for x in 0..nx-1 {
            let i = x + y*(nx-1);
            dxy_norm[i] = (1.0/dx[x] + 1.0/dx[x+1])/dx_mid[x] + (1.0/dy[y] + 1.0/dy[y+1])/dy_mid[y];
        }
    }
}

#[wasm_bindgen]
pub unsafe fn iterate_solver_2d(
    v: &mut [f32], e: &mut [f32],
    dx: &[f32], dy: &[f32],
    dx_mid: &[f32], dy_mid: &[f32], dxy_norm: &[f32],
    v_force: &[u32], v_table: &[f32],
    total_steps: usize,
) {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    let total_cells: usize = nx*ny;

    // create forcing potential
    let mut v_beta = vec![0.0; total_cells];
    let mut v_source = vec![0.0; total_cells];
    for (i, &data) in v_force.iter().enumerate() {
        let index = (data >> 16) as usize;
        let beta: f32 = (data & 0xFFFF) as f32 / (0xFFFF as f32);
        let voltage = v_table[index];
        v_beta[i] = beta;
        v_source[i] = voltage;
    }

    for _ in 0..total_steps {
        // enforce voltage potential
        for i in 0..total_cells {
            v[i] += v_beta[i]*(v_source[i] - v[i]);
        }

        // update e
        const E_DIMS: usize = 2;
        for y in 0..ny-1 {
            for x in 0..nx-1 {
                let iv = x + y*nx;
                let iv_dx = (x+1) + y*nx;
                let iv_dy = x + (y+1)*nx;

                let ie = E_DIMS*iv;
                e[ie+0] = (v[iv]-v[iv_dx])/dx[x];
                e[ie+1] = (v[iv]-v[iv_dy])/dy[y];
            }
        }

        // update v
        for y in 1..ny {
            for x in 1..nx {
                let ie = E_DIMS*(x + y*nx);
                let ie_dy = E_DIMS*(x + (y-1)*nx);
                let ie_dx = E_DIMS*((x-1) + y*nx);

                let dex = (e[ie_dx+0]-e[ie+0])/dx_mid[x-1];
                let dey = (e[ie_dy+1]-e[ie+1])/dy_mid[y-1];

                let iv = x + y*nx;
                let inorm = (x-1) + (y-1)*(nx-1);
                v[iv] += (dex+dey)/dxy_norm[inorm];
            }
        }
    }
}

#[wasm_bindgen]
pub unsafe fn calculate_homogenous_energy_2d(
    e: &[f32],
    dx: &[f32], dy: &[f32],
) -> f32 {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    const E_DIMS: usize = 2;
    let mut energy = 0.0;
    for y in 0..ny {
        for x in 0..nx {
            let ie = E_DIMS*(x + y*nx);
            let ex = e[ie+0];
            let ey = e[ie+1];
            // let e2 = ex.powi(2) + ey.powi(2);
            // let da = dx[x]*dy[y];
            // energy += e2*da;
            let dy_avg = (dy[y.max(1)-1]+dy[y])/2.0;
            let dx_avg = (dx[x.max(1)-1]+dx[x])/2.0;
            let energy_x = ex.powi(2)*dx[x]*dy_avg;
            let energy_y = ey.powi(2)*dy[y]*dx_avg;
            energy += energy_x + energy_y;
        }
    }
    return energy;
}

#[wasm_bindgen]
pub unsafe fn calculate_inhomogenous_energy_2d(
    e: &[f32], er: &[f32],
    dx: &[f32], dy: &[f32],
) -> f32 {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    const E_DIMS: usize = 2;
    let mut energy = 0.0;
    for y in 0..ny {
        for x in 0..nx {
            let ie = E_DIMS*(x + y*nx);
            let iv = x + y*nx;
            let ex = e[ie+0];
            let ey = e[ie+1];
            // let e2 = ex.powi(2) + ey.powi(2);
            // let da = dx[x]*dy[y];
            // energy += er[iv]*e2*da;
            let dy_avg = (dy[y.max(1)-1]+dy[y])/2.0;
            let dx_avg = (dx[x.max(1)-1]+dx[x])/2.0;
            let energy_x = ex.powi(2)*dx[x]*dy_avg;
            let energy_y = ey.powi(2)*dy[y]*dx_avg;
            energy += er[iv]*(energy_x + energy_y);
        }
    }
    return energy;
}
