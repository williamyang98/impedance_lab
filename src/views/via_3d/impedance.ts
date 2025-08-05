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

function calculate_energy_homogenous(stackup_grid: StackupGrid): number {
  const v_buf = stackup_grid.cpu_grid.Xin.cast(Float32Array);
  const dx_buf = stackup_grid.cpu_grid.dx.cast(Float32Array);
  const dy_buf = stackup_grid.cpu_grid.dy.cast(Float32Array);
  const dz_buf = stackup_grid.cpu_grid.dz.cast(Float32Array);
  const size = stackup_grid.size;
  const Nz = size.z;
  const Ny = size.y;
  const Nx = size.x;
  const Nxy = Nx*Ny;

  const Mx = Nx-1;
  const My = Ny-1;
  const Mz = Nz-1;

  let energy = 0;
  for (let z = 0; z < Mz; z++) {
    const dz = dz_buf[z];
    for (let y = 0; y < My; y++) {
      const dy = dy_buf[y];
      for (let x = 0; x < Mx; x++) {
        const iv = x + y*Nx + z*Nxy;
        const dx = dx_buf[x];
        const dA = dx*dy*dz;
        const Ex = (v_buf[iv+1]-v_buf[iv])/dx;
        const Ey = (v_buf[iv+Nx]-v_buf[iv])/dy;
        const Ez = (v_buf[iv+Nxy]-v_buf[iv])/dz;
        energy += (Ex*Ex+Ey*Ey+Ez*Ez)*dA;
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
  const Nz = size.z;
  const Ny = size.y;
  const Nx = size.x;
  const Nxy = Nx*Ny;

  const Mx = Nx-1;
  const My = Ny-1;
  const Mz = Nz-1;
  const Mxy = Mx*My;

  let energy = 0;
  for (let z = 0; z < Mz; z++) {
    const dz = dz_buf[z];
    for (let y = 0; y < My; y++) {
      const dy = dy_buf[y];
      for (let x = 0; x < Mx; x++) {
        const iv = x + y*Nx + z*Nxy;
        const ier = x + y*Mx + z*Mxy;
        const dx = dx_buf[x];
        const dA = dx*dy*dz;
        const Ex = (v_buf[iv+1]-v_buf[iv])/dx;
        const Ey = (v_buf[iv+Nx]-v_buf[iv])/dy;
        const Ez = (v_buf[iv+Nxy]-v_buf[iv])/dz;
        const er = er_buf[ier];
        energy += (Ex*Ex+Ey*Ey+Ez*Ez)*dA*er;
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

