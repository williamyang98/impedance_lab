import { type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import { Profiler } from "../../utility/profiler.ts";
import { StackupGrid } from "./grid.ts";

export interface SingleEndedMeasurement {
  type: "single";
  masked: ImpedanceResult;
  unmasked?: ImpedanceResult;
  effective_er: number;
}

export interface DifferentialMeasurement {
  type: "differential";
  odd_masked: ImpedanceResult;
  even_masked: ImpedanceResult;
  odd_unmasked?: ImpedanceResult;
  coupling_factor: number;
  effective_er: number;
}

export type Measurement = SingleEndedMeasurement | DifferentialMeasurement;

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
    let unmasked = undefined;
    if (stackup.has_soldermask()) {
      stackup.configure_single_ended_voltage();
      stackup.configure_unmasked_dielectric();
      unmasked = calculate("unmasked");
    }

    stackup.configure_single_ended_voltage();
    stackup.configure_masked_dielectric();
    const masked = calculate("masked");

    const effective_er = masked.Cih/masked.Ch;

    measurement = {
      type: "single",
      masked,
      unmasked,
      effective_er,
    }
  } else {
    let odd_unmasked = undefined;
    if (stackup.has_soldermask()) {
      stackup.configure_odd_mode_diffpair_voltage();
      stackup.configure_unmasked_dielectric();
      odd_unmasked = calculate("odd_unmasked");
    }

    stackup.configure_even_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const even_masked = calculate("even_masked");

    // NOTE: do this last so that final grid setup has expected differential voltage and soldermask
    stackup.configure_odd_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const odd_masked = calculate("odd_masked");

    const Z_odd = odd_masked.Z0;
    const Z_even = even_masked.Z0;
    const coupling_factor = (Z_even-Z_odd)/(Z_even+Z_odd);

    const effective_er = odd_masked.Cih/odd_masked.Ch;

    measurement = {
      type: "differential",
      odd_masked,
      even_masked,
      odd_unmasked,
      coupling_factor,
      effective_er,
    }
  }
  profiler?.end();

  return measurement;
}
