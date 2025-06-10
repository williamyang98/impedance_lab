import { type RunResult, type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import { StackupGrid } from "./grid.ts";

export interface Measurement {
  run: RunResult;
  impedance: ImpedanceResult;
}

function perform_measurement(stackup: StackupGrid): Measurement {
  const grid = stackup.region_grid.grid;
  const run = grid.run();
  const impedance = grid.calculate_impedance();
  return { run, impedance };
};

export interface SingleEndedMeasurement {
  masked: Measurement;
  unmasked: Measurement;
}

export interface DifferentialMeasurement {
  odd_masked: Measurement;
  even_masked: Measurement;
  odd_unmasked: Measurement;
  coupling_factor: number;
}

export type TransmissionLineMeasurement =
  { type: "single" } & SingleEndedMeasurement |
  { type: "differential" } & DifferentialMeasurement;

export function perform_transmission_line_measurement(stackup: StackupGrid): TransmissionLineMeasurement {
  const grid = stackup.region_grid.grid;
  grid.bake();

  const is_single_ended = !stackup.is_differential_pair();

  if (is_single_ended) {
    stackup.configure_single_ended_voltage();
    stackup.configure_masked_dielectric();
    const masked = perform_measurement(stackup);

    stackup.configure_single_ended_voltage();
    stackup.configure_unmasked_dielectric();
    const unmasked = perform_measurement(stackup);
    return {
      type: "single",
      masked,
      unmasked,
    }
  } else {
    stackup.configure_odd_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const odd_masked = perform_measurement(stackup);

    stackup.configure_even_mode_diffpair_voltage();
    stackup.configure_masked_dielectric();
    const even_masked = perform_measurement(stackup);

    stackup.configure_odd_mode_diffpair_voltage();
    stackup.configure_unmasked_dielectric();
    const odd_unmasked = perform_measurement(stackup);

    const Z_odd = odd_masked.impedance.Z0;
    const Z_even = even_masked.impedance.Z0;
    const coupling_factor = (Z_even-Z_odd)/(Z_even+Z_odd);

    return {
      type: "differential",
      odd_masked,
      even_masked,
      odd_unmasked,
      coupling_factor,
    }
  }
}
