import { Profiler } from "../../utility/profiler.ts";
import { Grid } from "./grid.ts";

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
}

export function calculate_impedance(grid: Grid, profiler?: Profiler): ImpedanceResult {
  profiler?.begin("energy_homogenous", "Calculate energy stored without dielectric material");
  const energy_homogenous = grid.module.calculate_homogenous_energy_2d(
    grid.ex_field, grid.ey_field,
    grid.dx, grid.dy,
  );
  profiler?.end();

  profiler?.begin("energy_inhomogenous", "Calculate energy stored with dielectric material");
  const energy_inhomogenous = grid.module.calculate_inhomogenous_energy_2d(
    grid.ex_field, grid.ey_field,
    grid.dx, grid.dy,
    grid.ek_table, grid.ek_index_beta,
  );
  profiler?.end();

  const epsilon_0 = 8.85e-12
  const c_0 = 3e8;
  const v0: number = grid.v_input;
  const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
  const Lh = 1/((c_0**2) * Ch);
  const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;
  const Z0 = (Lh/Cih)**0.5;
  const propagation_speed = 1/(Cih*Lh)**0.5;
  const propagation_delay = 1/propagation_speed;

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
  };
}
