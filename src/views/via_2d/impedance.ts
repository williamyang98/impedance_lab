import { Profiler } from "../../utility/profiler.ts";
import type { StackupGrid } from "./stackup_to_grid.ts";

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

export function calculate_via_impedance(stackup_grid: StackupGrid, profiler?: Profiler): ImpedanceResult {
  const grid = stackup_grid.grid;
  profiler?.begin("energy_homogenous", "Calculate energy stored without dielectric material");
  let energy_homogenous = grid.module.calculate_homogenous_energy_cylindrical(
    grid.ex_field, grid.ey_field,
    grid.dx, grid.dy,
    grid.x,
  );
  profiler?.end();

  profiler?.begin("energy_inhomogenous", "Calculate energy stored with dielectric material");
  let energy_inhomogenous = grid.module.calculate_inhomogenous_energy_cylindrical(
    grid.ex_field, grid.ey_field,
    grid.dx, grid.dy,
    grid.x,
    grid.ek_table, grid.ek_index_beta,
  );
  profiler?.end();

  // Need to rescale energy of simulation by simulation scale for 3d electrostatics
  // dE = |E(x,y)|^2 *(pi*x)*dx*dy
  // let x = Ax', y = Ay'
  // Voltage distribution stays the same, E = V/d, E' = V/(Ad') = E/A
  // dE' = [Ex'^2/A^2  + Ey'^2/A^2]*pi*A*x'*A*dx'*A*dy'
  // dE' = A * [Ex'^2 + Ey'^2]*(pi*x')*dx'*dy'
  // dE' = A * dE
  // dE = dE'/A
  energy_homogenous /= stackup_grid.energy_integral_scale;
  energy_inhomogenous /= stackup_grid.energy_integral_scale;

  const epsilon_0 = 8.85e-12
  const v0: number = grid.v_input;
  const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
  const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;


  // we only consider the inductance caused by the barrel part of the inductor
  const via = stackup_grid.via_barrel_parameters;
  const calculate_inductance = (mode: 0 | 1 | 2 | 3 | 4 | 5): number => {
    const mu_0 = Math.PI*4e-7;
    const c_0 = 3e8;
    switch (mode) {
      case 0: {
        // https://www.allaboutcircuits.com/tools/wire-self-inductance-calculator/
        const h = via.height*100; // cm
        const d = via.outer_diameter*100; // cm
        const a0 = d/(2*h);
        const a1 = Math.sqrt(1+a0*a0);
        return 2*h*(Math.log((1+a1)/a0) - a1 + mu_0/4 + a0)*1e-9;
      }
      case 1: {
        // https://resources.system-analysis.cadence.com/blog/msa2021-is-there-a-via-inductance-rule-of-thumb
        const h = via.height;
        const r = via.outer_diameter/2;
        const a0 = Math.sqrt(r**2 + h**2);
        return mu_0/(2*Math.PI)*(h*Math.log((h+a0)/r) + 1.5*(r-a0));
      }
      case 2: {
        // https://upcommons.upc.edu/server/api/core/bitstreams/928a71c0-b0a3-49ad-bf73-6f7a02ad2609/content
        // Equation 11 - DC partial self inductance (How is DC involved in inductance???)
        const h = via.height;
        const r1 = via.inner_diameter/2;
        const r2 = via.outer_diameter/2;
        const a0 = r2**2 - r1**2;
        return h*mu_0/(2*Math.PI)*((r1**4)/(a0**2)*Math.log(r2/r1) + (3*r1**2 - r2**2)/(4*a0));
      }
      case 3: {
        // https://upcommons.upc.edu/server/api/core/bitstreams/928a71c0-b0a3-49ad-bf73-6f7a02ad2609/content
        // Equation 9 - Wu
        const h = via.height;
        const r = via.outer_diameter/2;
        const a0 = Math.sqrt(1 + h**2/r**2);
        const a1 = Math.sqrt(1 + r**2/h**2);
        return mu_0/(2*Math.PI)*(Math.log(1/r+a0) - a1 + r/h + 1/4);
      }
      case 4: {
        // https://upcommons.upc.edu/server/api/core/bitstreams/928a71c0-b0a3-49ad-bf73-6f7a02ad2609/content
        // Equation 13 - Thin wall approximation
        const h = via.height;
        const r1 = via.inner_diameter/2;
        const r2 = via.outer_diameter/2;
        const a0 = r1/r2;
        const a1 = a0**2;
        const R = Math.max(h,r1,r2)*10; // some wierd virtual cylinder we need???
        return h*mu_0/(4*Math.PI)*((1-a1+2*a1*Math.log(a0))/(1-a1) + 2*Math.log(R/r2));
      }
      case 5: {
        // dodgy approximation which converts to distributed capacitance and inductance (along height of via)
        const h = via.height;
        const C0 = Ch/h;
        const L0 = 1/(c_0**2 * C0);
        return L0*h;
      }
    }
  };

  const Lh = calculate_inductance(2);
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
