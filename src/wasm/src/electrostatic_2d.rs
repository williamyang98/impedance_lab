use wasm_bindgen::prelude::*;

pub fn unpack_data(packed_data: u32) -> (usize, f32) {
    let index = (packed_data >> 16) as usize;
    let beta: f32 = (packed_data & 0xFFFF) as f32 / (0xFFFF as f32);
    return (index, beta);
} 

#[wasm_bindgen]
pub unsafe fn iterate_solver_2d(
    v: &mut [f32], e: &mut [f32],
    dx: &[f32], dy: &[f32],
    v_table: &[f32], v_index_beta: &[u32],
    total_steps: usize,
) {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    let total_voltages = (nx+1)*(ny+1);
    assert!(v.len() == total_voltages);

    for _ in 0..total_steps {
        // enforce voltage potential
        for i in 0..total_voltages {
            let packed_data = v_index_beta[i];
            let (index, beta) = unpack_data(packed_data);
            let voltage = v_table[index];
            v[i] += beta*(voltage - v[i]);
        }

        // calculate Ex = dV/dx, Ey = dV/dy
        const E_DIMS: usize = 2;
        for y in 0..ny {
            for x in 0..nx {
                let iv = x + y*(nx+1);
                let iv_dx = (x+1) + y*(nx+1);
                let iv_dy = x + (y+1)*(nx+1);

                let ie = E_DIMS*(x + y*nx);
                e[ie+0] = (v[iv]-v[iv_dx])/dx[x];
                e[ie+1] = (v[iv]-v[iv_dy])/dy[y];
            }
        }

        // Update V so that it satisfies ∇E = 0
        // ∇E = (Ex[x]-Ex[x-1])/(dx[x]+dx[x-1]) + (Ey[y]-E[y-1])/(dy[y]+dy[y-1])
        // ∇E = dEx[x]/(dx[x]+dx[x-1]) + dEy[y]/(dy[y]+dy[y-1])
        // Consider for an interval L ---> R
        // - increasing point R by dV gives dE = dV/dr
        // - increasing point L by dV gives dE = -dV/dr
        // ∇E - d∇E = ∇E - (dV/dx[x]+dV/dx[x-1])/(dx[x]+dx[x-1]) - (dV/dy[y]+dV/dy[y-1])/(dy[y]+dy[y-1])
        // Goal is to have ∇E - d∇E = 0, d∇E = ∇E
        // d∇E = dV*((1/dx[x]+1/dx[x-1])/(dx[x]+dx[x+1]) + (1/dy[y]+1/dy[y-1])/(dy[y]+dy[y-1]))
        //     = dV*(1/(dx[x]*dx[x-1]) + 1/(dy[y]+dy[y-1]))
        // d∇E = dV*norm = ∇E, norm = 1/(dx[x]*dx[x-1]) + 1/(dy[y]+dy[y-1])
        // dV = ∇E/norm
        for y in 1..ny {
            let dyi_1 = dy[y-1];
            let dyi = dy[y];

            for x in 1..nx {
                let dxi_1 = dx[x-1];
                let dxi = dx[x];

                let ie = E_DIMS*(x + y*nx);
                let ie_dy = E_DIMS*(x + (y-1)*nx);
                let ie_dx = E_DIMS*((x-1) + y*nx);

                let dex = e[ie_dx+0]-e[ie+0];
                let dey = e[ie_dy+1]-e[ie+1];
                let div_e = dex/(dxi+dxi_1) + dey/(dyi+dyi_1);
                let norm = 1.0/(dxi*dxi_1) + 1.0/(dyi*dyi_1);
                let dv = div_e/norm;

                let iv = x + y*(nx+1);
                // avoid enforcing div(E)=0 if there is a voltage source since div(E) must be finite
                let packed_data = v_index_beta[iv];
                let (_index, beta) = unpack_data(packed_data);
                let mask = 1.0-beta;
                v[iv] += mask*dv;
            }
        }
    }
}

// Source: https://en.wikipedia.org/wiki/Gauss%E2%80%93Legendre_quadrature
// 1. What is the Gauss-Legendre quadrature integral approximation 
// - Consider a finite approximation for the definite integral of a function
//      A = int [-1,+1] f(x) dx = sum_i wi*f(xi)
//      wi = weight term, xi = sampling point 
// - To measure the accuracy of the integral approximation we look at integrals of x^k
//      A = int [-1,+1] x^k dx
//      k = [0, 1, 2,   3, 4]
//      A = [2, 0, 2/3, 0, 2/5]
// - Regular sampling using midpoint is given by
//      A = int [a,b] f(x) dx = (b-a)*f([b-a]/2)
//      w0 = b-a, x0 = (b-a)/2
//      For b = 1,a = -1
//      A(n=1) = int [-1,+1] f(x) dx = 2*f(0) 
// - For two point sampling consider i=[0,1]
//      A = int [-1,+1] f(x) dx = sum_i wi*f(xi)
//      We are solving the terms for f(x) = x^k
//      k=0, A=2 = w0*(x0)^0+w1*(x1)^0, w0+w1=2
//      k=1, A=0, w0*x0+w1*x1=0
//      k=2, A=2/3, w0*(x0)^2+w1*(x1)^2=2/3
// - Since functions are odd or even, let x0 = -x1 for symmetrical sampling
//      k=0, w0+w1=2 
//      k=1, w0*x0-w1*x0=0, w0=w1, w0=w1=1
//      k=2, 2*x0^2=2/3, x0=1/sqrt(3), x1=-1/sqrt(3)
// - Hence this two point "quadrature" satisfies A = int [-1,+1] f(x) up to k <= 2
//      A(n=2) = int [-1,+1] f(x) dx = f(-1/sqrt(3)) + f(1/sqrt(3))
// - Comparing accuracy of integral approximations with n sampling points
//      k        = [0, 1, 2,   3, 4]
//      A(exact) = [2, 0, 2/3, 0, 2/5]
//      A(n=1)   = [2, 0, 0,   0, 0]
//      A(n=2)   = [2, 0, 2/3, 0, 2/9]
// - Hence the integral approximation is accurate for 
//      n=1, k<=1
//      n=2, k<=3
// - The equation describing the relation between n and k_max is:
//      n=N, k<=2N-1
//
// 2. What is the problem space?
// - We are approximating the energy calculation of an electric field in a dielectric discretely
// - We use a yee grid with the following structure
//   o -- x
//   |    |
//   x -- x
// - A yee grid cell consists of the following:
//  - "x": scalar voltage potential
//  - "--": electric field x-component
//  - "|": electric field y-component
//  - cell size of [dx,dy]
// - Basic discretisation involves calculating it as: dE = (Ex^2 + Ey^2)*dx*dy
//
// 3. Problems with discretization
// - This discretisation has the same properties as n=1 integral approximation
// - dE = Ex^2*dx*dy + Ey^2*dx*dy
// - We are sampling one point meaning we can only get an accurate integral approximation for k <= 1
// - However since our energy calculation function has Ex^2 and Ey^2 terms, it is at least k <= 2
// - This in itself is optimistic since that assumes Ex and Ey are k <= 1 (either linear or constant)
// - Therefore the integral is only accurate for Ex and Ey when k <= 0 so Ex^2, Ey^2 has k <= 0 < 1
// - Only accurate if electric field is uniform along (x,y) coordinates which is unlikely outside of a
//   uniform electric field. Fields that bend will produce large energy integral errors.
//
// 4. What happens with a Gauss-Legendre quadrature integral approximation
// - Using n=2 quadrature sampling we get accurate integrals for k <= 3
// - This means if Ex and Ey have order k <= 1, Ex^2 and Ey^2 are k <= 2 
// - We can therefore accurately integrate if Ex,Ey is a linear function of (x,y)
// - Not perfect but better than only being able to integral over a constant electric field
//
// 5. Implementing Gauss-Legendre integral for yee grid
// - 1d Gauss-Legendre integral is given by:
//      A(n=2) = int [-1,+1] f(e) de = f(-1/sqrt(3)) + f(1/sqrt(3))
// - 2d Gauss-Legendre integral is give by:
//      E0 = -1/sqrt(3), E1 = 1/sqrt(3)
//      A(n=2) = int [-1,+1] int [-1,+1] f(ex,ey) dex*dey 
//             = f(E0,E0) + f(E0,E1) + f(E1,E0) + f(E1,E1)
// - Since integral is not over ex=ey=[-1,+1] but rather of x=[0,Dx] and y=[0,Dy] in 2D we need to do the following
//      ex=[-1,+1], x=[0,dx]   ey=[-1,+1], y=[0,dy]
//       x=Dx*(ex+1)/2          y=Dy*(ey+1)/2
//      dx=Dx/2*dex            dy=Dy/2*dey
//      Xi=Dx*(Ei+1)/2         Yi=Dy*(Ei+1)/2
// - We actually want to solve for:
//      dE = int [0,dy] int [0,dx] f(x,y) dx*dy
//      A(n=2) = int [-1,+1] int [-1,+1] f(ex,ey) dex*dey
//             = int [0,dy] int [0,dy] f(x,y) 4/(Dx*Dy) dx*dy
//      A(n=2) = 4/(Dx*Dy) * dE
//             = f(X0,Y0) + f(X1,Y0) + f(X0,Y1) + f(X1,Y1)
//          dE = (Dx*Dy)/4 * [f(X0,Y0) + f(X1,Y0) + f(X0,Y1) + f(X1,Y1)]
// - To sample f(x,y) for x != dx/2 and y != dy/2 we linearly interpolate assuming Ex,Ey are k <= 1
//      Xi=Dx*(Ei+1)/2 and Yi=Dy*(Ei+1)/2
//      Since Dx and Dy are the distance between our adjacent Ex,Ey components in the yee-grid 
//      (Ei+1)/2 is the relative position within our yee grid [Dx,Dy] sized cell
//      E0=-1/sqrt(3), A0=0.21132
//      E1=+1/sqrt(3), A1=0.78868
#[inline]
pub fn get_gauss_legendre_integral(ex0: f32, ex1: f32, ey0: f32, ey1: f32, dx: f32, dy: f32) -> f32 {
    const A0: f32 = 0.21132;
    const A1: f32 = 0.78868;

    // We approximate Ex and Ey as linearly changing along dy and dx inside the cell
    // which under our Gauss Legendre integral will have a low error integral (not true for non-linear fields)
    //  o -- x
    //  |    |
    //  x -- x
    let ex0_sample = ex0*A1 + ex1*A0;
    let ex1_sample = ex0*A0 + ex1*A1;
    let ey0_sample = ey0*A1 + ey1*A0;
    let ey1_sample = ey0*A0 + ey1*A1;

    let f00_sample = ex0_sample.powi(2) + ey0_sample.powi(2);
    let f01_sample = ex0_sample.powi(2) + ey1_sample.powi(2);
    let f10_sample = ex1_sample.powi(2) + ey0_sample.powi(2);
    let f11_sample = ex1_sample.powi(2) + ey1_sample.powi(2);

    let integral = (f00_sample+f01_sample+f10_sample+f11_sample)*(dx*dy)/4.0;
    return integral;
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
    for y in 0..ny-1 {
        let dy = dy[y];
        for x in 0..nx-1 {
            let dx = dx[x];

            let i00 = E_DIMS*(x+y*nx);
            let i01 = E_DIMS*((x+1)+y*nx);
            let i10 = E_DIMS*(x+(y+1)*nx);
            let ex0 = e[i00+0];
            let ey0 = e[i00+1];
            let ex1 = e[i10+0];
            let ey1 = e[i01+1];
            let sum = get_gauss_legendre_integral(ex0,ex1,ey0,ey1,dx,dy);

            energy += sum;
        }
    }
    return energy;
}

#[wasm_bindgen]
pub unsafe fn calculate_inhomogenous_energy_2d(
    e: &[f32], 
    er_table: &[f32], er_index_beta: &[u32],
    dx: &[f32], dy: &[f32],
) -> f32 {
    let nx: usize = dx.len();
    let ny: usize = dy.len();
    const E_DIMS: usize = 2;

    let er0 = er_table[0];

    let mut energy = 0.0;
    for y in 0..ny-1 {
        let dy = dy[y];
        for x in 0..nx-1 {
            let dx = dx[x];

            let i00 = E_DIMS*(x+y*nx);
            let i01 = E_DIMS*((x+1)+y*nx);
            let i10 = E_DIMS*(x+(y+1)*nx);
            let ex0 = e[i00+0];
            let ey0 = e[i00+1];
            let ex1 = e[i10+0];
            let ey1 = e[i01+1];
            let sum = get_gauss_legendre_integral(ex0,ex1,ey0,ey1,dx,dy);

            let packed_data = er_index_beta[x+y*nx];
            let (index, beta) = unpack_data(packed_data);
            let er_cell = (1.0-beta)*er0 + beta*er_table[index];

            energy += er_cell*sum;
        }
    }
    return energy;
}
