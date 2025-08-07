import { Profiler } from "../../utility/profiler.ts";
import { type StackupGrid } from "./stackup_to_grid.ts";
import { calculate_via_inductance } from "../via_2d/impedance.ts";

export interface ImpedanceResult {
  voltage: number;
  energy_homogenous: number;
  energy_inhomogenous: number;
  Z0: number;
  Ch: number;
  Cih: number;
  Lh: number;
  propagation_speed: number;
  propagation_delay: number;
  resonant_frequency: number;
  effective_er: number;
  dc_resistance: number;
}

function lerp(v0: number, v1: number, x: number): number {
  return v0*(1-x) + v1*x;
}

function calculate_cell_energy(
  v_buf: Float32Array, iv: number, Mx: number, Mxy: number,
  dx: number, dy: number, dz: number,
): number {
  // Use a n=2 Gauss-Legendre integral which can support k=2n-1=3rd order polynomials
  const X0: number = 0.21132;
  const X1: number = 0.78868;
  const W0: number = 0.5;
  const W1: number = 0.5;

  // v(z,y,x)
  const v000 = v_buf[iv];
  const v001 = v_buf[iv+1];
  const v010 = v_buf[iv+Mx];
  const v011 = v_buf[iv+Mx+1];
  const v100 = v_buf[iv+Mxy];
  const v101 = v_buf[iv+Mxy+1];
  const v110 = v_buf[iv+Mxy+Mx];
  const v111 = v_buf[iv+Mxy+Mx+1];

  // Ex(z,y)
  const ex00 = (v001-v000)/dx;
  const ex01 = (v011-v010)/dx;
  const ex10 = (v101-v100)/dx;
  const ex11 = (v111-v110)/dx;

  // Ey(z,x)
  const ey00 = (v010-v000)/dy;
  const ey01 = (v011-v001)/dy;
  const ey10 = (v110-v100)/dy;
  const ey11 = (v111-v101)/dy;

  // Ez(y,x)
  const ez00 = (v100-v000)/dz;
  const ez01 = (v101-v001)/dz;
  const ez10 = (v110-v010)/dz;
  const ez11 = (v111-v011)/dz;


  function f(x: number, y: number, z: number): number {
    const ex = lerp(lerp(ex00, ex01, y), lerp(ex10, ex11, y), z);
    const ey = lerp(lerp(ey00, ey01, x), lerp(ey10, ey11, x), z);
    const ez = lerp(lerp(ez00, ez01, x), lerp(ez10, ez11, x), y);
    return ex*ex + ey*ey + ez*ez;
  }

  const dA = dx*dy*dz;
  const gauss_integral =
    f(X0,X0,X0)*W0*W0*W0 +
    f(X0,X0,X1)*W0*W0*W1 +
    f(X0,X1,X0)*W0*W1*W0 +
    f(X0,X1,X1)*W0*W1*W1 +
    f(X1,X0,X0)*W1*W0*W0 +
    f(X1,X0,X1)*W1*W0*W1 +
    f(X1,X1,X0)*W1*W1*W0 +
    f(X1,X1,X1)*W1*W1*W1;
  return gauss_integral*dA;
}

function calculate_energy_homogenous(stackup_grid: StackupGrid): number {
  const v_buf = stackup_grid.cpu_grid.Xin.cast(Float32Array);
  const dx_buf = stackup_grid.cpu_grid.dx.cast(Float32Array);
  const dy_buf = stackup_grid.cpu_grid.dy.cast(Float32Array);
  const dz_buf = stackup_grid.cpu_grid.dz.cast(Float32Array);
  const size = stackup_grid.size;

  const Nx = size.x;
  const Ny = size.y;
  const Nz = size.z;

  const My = size.y+1;
  const Mx = size.x+1;
  const Mxy = Mx*My;

  let energy = 0;
  for (let z = 0; z < Nz; z++) {
    const dz = dz_buf[z];
    for (let y = 0; y < Ny; y++) {
      const dy = dy_buf[y];
      for (let x = 0; x < Nx; x++) {
        const dx = dx_buf[x];
        const iv = x + y*Mx + z*Mxy;
        energy += calculate_cell_energy(v_buf, iv, Mx, Mxy, dx, dy, dz);
      }
    }
  }
  return energy;
}

function calculate_energy_inhomogenous(stackup_grid: StackupGrid): number {
  const v_buf = stackup_grid.cpu_grid.Xin.cast(Float32Array);
  const dx_buf = stackup_grid.cpu_grid.dx.cast(Float32Array);
  const dy_buf = stackup_grid.cpu_grid.dy.cast(Float32Array);
  const dz_buf = stackup_grid.cpu_grid.dz.cast(Float32Array);
  const er_buf = stackup_grid.cpu_grid.er.cast(Float32Array);
  const size = stackup_grid.size;

  const Nx = size.x;
  const Ny = size.y;
  const Nz = size.z;
  const Nxy = Nx*Ny;

  const My = size.y+1;
  const Mx = size.x+1;
  const Mxy = Mx*My;

  let energy = 0;
  for (let z = 0; z < Nz; z++) {
    const dz = dz_buf[z];
    for (let y = 0; y < Ny; y++) {
      const dy = dy_buf[y];
      for (let x = 0; x < Nx; x++) {
        const dx = dx_buf[x];
        const iv = x + y*Mx + z*Mxy;
        const ier = x + y*Nx + z*Nxy;
        const er = er_buf[ier];
        energy += calculate_cell_energy(v_buf, iv, Mx, Mxy, dx, dy, dz)*er;
      }
    }
  }
  return energy;
}

export function calculate_via_impedance(stackup_grid: StackupGrid, profiler?: Profiler): ImpedanceResult {
  profiler?.begin("energy_homogenous", "Calculate energy stored without dielectric material");
  let energy_homogenous = calculate_energy_homogenous(stackup_grid);
  profiler?.end();

  profiler?.begin("energy_inhomogenous", "Calculate energy stored with dielectric material");
  let energy_inhomogenous = calculate_energy_inhomogenous(stackup_grid);
  profiler?.end();

  // Need to rescale energy of simulation by simulation scale for 3d electrostatics
  // dE = |E(x,y,z)|^2 * dx*dy*dz
  // let x = Ax', y = Ay', z = Az'
  // Voltage distribution stays the same, E = V/d, E' = V/(Ad') = E/A
  // dE' = [Ex'^2/A^2  + Ey'^2/A^2 + Ez'^2/A^2] * A*dx'*A*dy'*A*dz'
  // dE' = A * [Ex'^2 + Ey'^2 + Ez'^2] * dx'*dy'*dz'
  // dE' = A * dE
  // dE = dE'/A
  energy_homogenous /= stackup_grid.grid_scale;
  energy_inhomogenous /= stackup_grid.grid_scale;

  const epsilon_0 = 8.85e-12
  const v0: number = stackup_grid.v_input;
  const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
  const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;

  // we only consider the inductance caused by the barrel part of the inductor
  const via = stackup_grid.via_barrel_parameters;
  let Lh = undefined as (number | undefined);
  if (via.inner_diameter/via.outer_diameter < 0.05) {
    // solid core approximation
    Lh = calculate_via_inductance(via, "solid_wu");
  } else if (via.inner_diameter/via.outer_diameter > 0.95) {
    // thin wall approximation
    Lh = calculate_via_inductance(via, "tube_thin_sapongin_prokopenko");
  } else {
    // tube approximation
    Lh = calculate_via_inductance(via, "tube_sapongin_prokopenko");
  }
  // round trip inductance
  // M1. assume copper plane doubles it
  // M2. assuume copper plane has negligible inductance???
  // Lh *= 2;

  const Z0 = (Lh/Cih)**0.5;
  const propagation_speed = 1/(Cih*Lh)**0.5;
  const propagation_delay = 1/propagation_speed;
  const effective_er = Cih/Ch;
  const resonant_frequency = 1/(2*Math.PI*Math.sqrt(Lh*Cih));

  // Include this in a more specialised tool
  const cross_sectional_area = Math.PI*(via.outer_diameter**2 - via.inner_diameter**2)/4;
  const rho_copper = 1.68e-8; // handle temperature dependence
  const dc_resistance = rho_copper*via.height/cross_sectional_area;

  // // https://engineering.stackexchange.com/a/35835
  // // https://www.protoexpress.com/blog/how-to-design-via-with-current-carrying-capacity/
  // // https://www.protoexpress.com/tools/via-current-capacity-temperature-rise-calculator/
  // // NOTE: this is VERY wrong, the answer is based on a mix of many constraints:
  // // - max temperature rise
  // // - max voltage drop
  // // - max power dissipation
  // // - max signal attentuation (dc???)
  // const maximum_current = 15.774*Math.pow(cross_sectional_area, 0.6077);

  return {
    voltage: v0,
    energy_homogenous,
    energy_inhomogenous,
    Z0,
    Ch,
    Cih,
    Lh,
    propagation_speed,
    propagation_delay,
    effective_er,
    resonant_frequency,
    dc_resistance,
  };
}

