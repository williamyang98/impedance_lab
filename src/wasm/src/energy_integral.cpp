#include "./energy_integral.hpp"

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
static inline float fsquare(float x) {
    return x*x;
}

static inline float get_gauss_legendre_integral(
    float ex0, float ex1, 
    float ey0, float ey1, 
    float dx, float dy
) {
    constexpr float A0 = 0.21132;
    constexpr float A1 = 0.78868;

    // We approximate Ex and Ey as linearly changing along dy and dx inside the cell
    // which under our Gauss Legendre integral will have a low error integral (not true for non-linear fields)
    //  o -- x
    //  |    |
    //  x -- x
    const float ex0_sample = ex0*A1 + ex1*A0;
    const float ex1_sample = ex0*A0 + ex1*A1;
    const float ey0_sample = ey0*A1 + ey1*A0;
    const float ey1_sample = ey0*A0 + ey1*A1;

    const float f00_sample = fsquare(ex0_sample) + fsquare(ey0_sample);
    const float f01_sample = fsquare(ex0_sample) + fsquare(ey1_sample);
    const float f10_sample = fsquare(ex1_sample) + fsquare(ey0_sample);
    const float f11_sample = fsquare(ex1_sample) + fsquare(ey1_sample);

    const float integral = (f00_sample+f01_sample+f10_sample+f11_sample)*(dx*dy)/4.0;
    return integral;
}

float calculate_homogenous_energy_2d(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field,
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
) {
    const int Nx = dx_arr.get_length();
    const int Ny = dy_arr.get_length();

    float energy = 0.0f;
    for (int y = 0; y < Ny; y++) {
        const float dy = dy_arr[y];
        for (int x = 0; x < Nx; x++) {
            const float dx = dx_arr[x];

            const float ex0 = ex_field[x + y*Nx];
            const float ey0 = ey_field[x + y*(Nx+1)];
            const float ex1 = ex_field[x + (y+1)*Nx];
            const float ey1 = ey_field[(x+1) + y*(Nx+1)];
            const float sum = get_gauss_legendre_integral(ex0,ex1,ey0,ey1,dx,dy);
            energy += sum;
        }
    }
    return energy;
}

float calculate_inhomogenous_energy_2d(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field,
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr,
    TypedPinnedArray<float> er_table, TypedPinnedArray<uint32_t> er_index_beta
) {
    const int Nx = dx_arr.get_length();
    const int Ny = dy_arr.get_length();

    const float er0 = er_table[0];

    float energy = 0.0;
    for (int y = 0; y < Ny-1; y++) {
        const float dy = dy_arr[y];
        for (int x = 0; x < Nx-1; x++) {
            const float dx = dx_arr[x];

            const float ex0 = ex_field[x + y*Nx];
            const float ey0 = ey_field[x + y*(Nx+1)];
            const float ex1 = ex_field[x + (y+1)*Nx];
            const float ey1 = ey_field[(x+1) + y*(Nx+1)];
            const float sum = get_gauss_legendre_integral(ex0,ex1,ey0,ey1,dx,dy);

            const uint32_t index_beta = er_index_beta[x+y*Nx];
            const int index = int(index_beta >> 16);
            const float beta = float(index_beta & 0xFFFF) / float(0xFFFF);
            const float er_cell = (1.0-beta)*er0 + beta*er_table[index];
            energy += er_cell*sum;
        }
    }
    return energy;
}

void calculate_e_field(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field, 
    TypedPinnedArray<float> v_field, 
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr
) {
    const int Nx = dx_arr.get_length();
    const int Ny = dy_arr.get_length();

    for (int y = 0; y < Ny+1; y++) {
        for (int x = 0; x < Nx; x++) {
            const float dx = dx_arr[x];
            const int ie = x + y*Nx;
            const int iv = x + y*(Nx+1);
            const int iv_dx = x+1 + y*(Nx+1);
            // Ex = -dV/dx
            ex_field[ie] = -(v_field[iv_dx]-v_field[iv])/dx;
        }
    }

    for (int y = 0; y < Ny; y++) {
        const float dy = dy_arr[y];
        for (int x = 0; x < Nx+1; x++) {
            const int ie = x + y*(Nx+1);
            const int iv = x + y*(Nx+1);
            const int iv_dy = x + (y+1)*(Nx+1);
            // Ey = -dV/dy
            ey_field[ie] = -(v_field[iv_dy]-v_field[iv])/dy;
        }
    }
}