#include "./energy_integral.hpp"
#define _USE_MATH_DEFINES
#include <math.h>

// NOTE: kind of the opposite of a conventional lerp
// meant for linear sampling between 0 to 1 where v0 and v1 are the boundary values
static inline float lerp(float v0, float v1, float x) {
    return v0*(1.0f-x) + v1*x;
}

// Source: https://en.wikipedia.org/wiki/Gauss%E2%80%93Legendre_quadrature
// We can get the integral of a function of order 2*n-1 exactly by summing specific points with n weights
// f(x) = sum [0,2n-1] Ai*x^i = sum [1,n] Wi*f(xi)
static inline float get_cell_energy_2d(
    float ex0, float ex1, 
    float ey0, float ey1, 
    float dx, float dy
) {
    //  o -- x
    //  |    |
    //  x -- x
    // I = int [0,Dx] int [0,Dy] |E(x,y)|^2*dx*dy
    // I = int [0,Dx] int [0,Dy] [Ex(y)^2+Ey(x)^2]*dx*dy 
    // Since Ex varies with y and Ey varies with x within the cell we can split integral
    // I = int [0,Dx] Dy*Ey(x)^2*dx + int [0,Dy] Dx*Ex(y)^2*dy

    // Use a n=2 Gauss-Legendre integral which can support k=2n-1=3rd order polynomials
    // Since f0(x) = Ey(x)^2 and f1(y) = Ex(y)^2, Ex and Ey can be accurate to 1st order polynomials
    // Therefore we can use linear interpolation for sampling Ex and Ey
    // NOTE: normalise coefficients from [-1,+1] to [0,+1]
    constexpr float A0 = 0.21132f;
    constexpr float A1 = 0.78868f;
    constexpr float W0 = 0.5f;
    constexpr float W1 = 0.5f;

    const auto f_Ey = [=](float x) {
        const float ey = lerp(ey0,ey1,x);
        return ey*ey; 
    };
    const auto f_Ex = [=](float y) {
        const float ex = lerp(ex0,ex1,y);
        return ex*ex; 
    };
    const float Ix0 = f_Ey(A0)*W0;
    const float Ix1 = f_Ey(A1)*W1;
    const float Iy0 = f_Ex(A0)*W0;
    const float Iy1 = f_Ex(A1)*W1;

    const float integral = (Ix0+Ix1+Iy0+Iy0)*dx*dy;
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
            const float sum = get_cell_energy_2d(ex0,ex1,ey0,ey1,dx,dy);
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
            const float sum = get_cell_energy_2d(ex0,ex1,ey0,ey1,dx,dy);

            const uint32_t index_beta = er_index_beta[x+y*Nx];
            const int index = int(index_beta >> 16);
            const float beta = float(index_beta & 0xFFFF) / float(0xFFFF);
            const float er_cell = (1.0-beta)*er0 + beta*er_table[index];
            energy += er_cell*sum;
        }
    }
    return energy;
}

static inline float get_cell_energy_cylindrical(
    float ex0, float ex1, 
    float ey0, float ey1, 
    float dx, float dy,
    float x0
) {
    //  o -- x
    //  |    |
    //  x -- x
    // I = int [0,Dx] int [0,Dy] |E(x,y)|^2*pi|x|*dx*dy, r=|x| and pi*r is the half revolution cylindrical integral
    // I = int [0,Dx] int [0,Dy] [Ex(y)^2+Ey(x)^2]*pi*|x|*dx*dy 

    // Use a n=2 Gauss-Legendre integral which can support k=2n-1=3rd order polynomials
    // Since f0(x) = Ey(x)^2 and f1(y) = Ex(y)^2, Ex and Ey can be accurate to 1st order polynomials
    // Therefore we can use linear interpolation for sampling Ex and Ey
    // NOTE: normalise coefficients from [-1,+1] to [0,+1]
    constexpr float A0 = 0.21132f;
    constexpr float A1 = 0.78868f;
    constexpr float W0 = 0.5f;
    constexpr float W1 = 0.5f;

    const float x1 = x0+dx;
    const auto f = [=](float x, float y) { 
        const float ex = lerp(ex0,ex1,y);
        const float ey = lerp(ey0,ey0,x);
        const float r = fabsf(lerp(x0,x1,x));
        return (ex*ex + ey*ey)*float(M_PI)*r;
    };
    const float Ix0y0 = f(A0,A0)*W0*W0;
    const float Ix1y0 = f(A1,A0)*W1*W0;
    const float Ix0y1 = f(A0,A1)*W0*W1;
    const float Ix1y1 = f(A1,A1)*W1*W1;

    const float integral = (Ix0y0+Ix1y0+Ix0y1+Ix1y1)*dx*dy;
    return integral;
}

float calculate_homogenous_energy_cylindrical(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field,
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr,
    TypedPinnedArray<float> x_arr
) {
    const int Nx = dx_arr.get_length();
    const int Ny = dy_arr.get_length();

    float energy = 0.0f;
    for (int y = 0; y < Ny; y++) {
        const float dy = dy_arr[y];
        for (int x = 0; x < Nx; x++) {
            const float dx = dx_arr[x];
            const float x0 = x_arr[x];

            const float ex0 = ex_field[x + y*Nx];
            const float ey0 = ey_field[x + y*(Nx+1)];
            const float ex1 = ex_field[x + (y+1)*Nx];
            const float ey1 = ey_field[(x+1) + y*(Nx+1)];
            const float sum = get_cell_energy_cylindrical(ex0,ex1,ey0,ey1,dx,dy,x0);
            energy += sum;
        }
    }
    return energy;
}

float calculate_inhomogenous_energy_cylindrical(
    TypedPinnedArray<float> ex_field, TypedPinnedArray<float> ey_field,
    TypedPinnedArray<float> dx_arr, TypedPinnedArray<float> dy_arr,
    TypedPinnedArray<float> x_arr,
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
            const float x0 = x_arr[x];

            const float ex0 = ex_field[x + y*Nx];
            const float ey0 = ey_field[x + y*(Nx+1)];
            const float ex1 = ex_field[x + (y+1)*Nx];
            const float ey1 = ey_field[(x+1) + y*(Nx+1)];
            const float sum = get_cell_energy_cylindrical(ex0,ex1,ey0,ey1,dx,dy,x0);

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