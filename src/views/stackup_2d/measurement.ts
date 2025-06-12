import { type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import { Profiler } from "../../utility/profiler.ts";
import { StackupGrid } from "./grid.ts";

export interface SingleEndedMeasurement {
  masked: ImpedanceResult;
  unmasked: ImpedanceResult;
}

export interface DifferentialMeasurement {
  odd_masked: ImpedanceResult;
  even_masked: ImpedanceResult;
  odd_unmasked: ImpedanceResult;
  coupling_factor: number;
}

export type Measurement =
  { type: "single" } & SingleEndedMeasurement |
  { type: "differential" } & DifferentialMeasurement;

export function perform_measurement(stackup: StackupGrid, profiler?: Profiler): Measurement {
  const grid = stackup.grid;
  profiler?.begin("bake");
  grid.bake(profiler);
  profiler?.end();

  const calculate = (label: string): ImpedanceResult => {
    profiler?.begin(label, `Calculating with setup ${label}`);

    profiler?.begin("grid.run");
    grid.run(profiler);
    profiler?.end();

    profiler?.begin("grid.calculate_impedance");
    const impedance = grid.calculate_impedance(profiler);
    profiler?.end();

    profiler?.end();
    return impedance;
  };

  profiler?.begin("calculate_setups");
  const is_single_ended = !stackup.is_differential_pair();
  let measurement: Measurement | undefined = undefined;
  if (is_single_ended) {
    stackup.configure_single_ended_voltage();
    stackup.configure_masked_dielectric();
    const masked = calculate("masked");

    stackup.configure_single_ended_voltage();
    stackup.configure_unmasked_dielectric();
    const unmasked = calculate("unmasked");

    measurement = {
      type: "single",
      masked,
      unmasked,
    }
  } else {
    stackup.configure_odd_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const odd_masked = calculate("odd_masked");

    stackup.configure_even_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const even_masked = calculate("even_masked");

    stackup.configure_odd_mode_diffpair_voltage();
    stackup.configure_unmasked_dielectric();
    const odd_unmasked = calculate("odd_unmasked");

    const Z_odd = odd_masked.Z0;
    const Z_even = even_masked.Z0;
    const coupling_factor = (Z_even-Z_odd)/(Z_even+Z_odd);

    measurement = {
      type: "differential",
      odd_masked,
      even_masked,
      odd_unmasked,
      coupling_factor,
    }
  }
  profiler?.end();

  return measurement;
}
