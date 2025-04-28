import { Grid, type ImpedanceResult, type RunResult } from "../engine/electrostatic_2d.ts";
import { DifferentialMicrostrip } from "../app/transmission_line_2d.ts";

export interface TransmissionLineParameters {
  dielectric_bottom_epsilon: number;
  dielectric_bottom_height: number;
  signal_separation: number;
  signal_width: number;
  signal_height: number;
  dielectric_top_epsilon: number;
  dielectric_top_height: number;
}

export class Setup {
  grid?: Grid;
  params?: TransmissionLineParameters;

  constructor() {}

  reset() {
    if (this.grid) {
      const { v_field, e_field } = this.grid;
      v_field.fill(0);
      e_field.fill(0);
    }
  }

  update_params(params: TransmissionLineParameters) {
    this.params = params;

    const transmission_line = new DifferentialMicrostrip();
    {
      transmission_line.signal_width.value = params.signal_width;
      transmission_line.signal_separation.value = params.signal_separation;
      transmission_line.trace_taper.value = 0;
      transmission_line.trace_height.value = params.signal_height;
      transmission_line.plane_height_bottom.value = params.dielectric_bottom_height;
      transmission_line.plane_height_top.value = params.dielectric_top_height;
      transmission_line.plane_epsilon_bottom.value = params.dielectric_bottom_epsilon;
      transmission_line.plane_epsilon_top.value = params.dielectric_top_epsilon;
    }
    const region_grid = transmission_line.create_region_grid()!;
    const grid = region_grid.grid;
    grid.v_table.set([0], 0);
    grid.v_table.set([1], 1);
    grid.v_table.set([2], -1);
    grid.bake();

    this.grid = grid;
  }

}

export interface ParameterSearchResults {
  results: {
    step: number;
    value: number;
    run_result: RunResult;
    impedance_result: ImpedanceResult;
    params: TransmissionLineParameters;
  }[];
  total_steps: number;
  elapsed_ms: number;
  best_step: number;
}

export interface ParameterSearchConfig {
  Z0_target: number;
  v_lower: number;
  v_upper: number;
  is_positive_correlation: boolean;
  error_tolerance: number;
  early_stop_threshold: number;
  plateau_count: number;
}

export async function perform_parameter_search(
  param_getter: (value: number) => TransmissionLineParameters,
  setup: Setup,
  config: ParameterSearchConfig,
  energy_threshold: number,
): Promise<ParameterSearchResults> {
  if (setup.grid === undefined) {
    throw Error(`Tried to perform parametric search when setup grid was not created`);
  }

  let found_upper_bound = false;
  let Z0_best: number | null = null;
  let best_step: number | null = null;
  let curr_plateau_count = 0;

  let v_lower = config.v_lower;
  let v_upper = config.v_upper;

  const results = [];
  const growth_ratio = 2;

  const start_ms = performance.now();
  let curr_step = 0;
  while (true) {
    const v_pivot = found_upper_bound ? (v_lower+v_upper)/2.0 : v_upper;
    const params = param_getter(v_pivot);
    setup.update_params(params);
    const run_result = setup.grid.run(energy_threshold);
    const impedance_result = setup.grid.calculate_impedance();
    const Z0 = impedance_result.Z0;
    console.log(`step=${curr_step}, value=${v_pivot}, Z0=${Z0}`);

    results.push({
      step: curr_step,
      value: v_pivot,
      run_result,
      impedance_result,
      params,
    });

    if (Z0_best !== null) {
      const error_prev = Math.abs(config.Z0_target - Z0_best);
      const error_curr = Math.abs(config.Z0_target - Z0);
      const error_delta = error_curr - error_prev;
      if (error_delta < 0) {
        Z0_best = Z0;
        best_step = curr_step;
      }
      if (error_delta > 0) {
        curr_plateau_count++;
      } else if (-error_delta/error_prev < config.early_stop_threshold) {
        curr_plateau_count++;
      } else {
        curr_plateau_count = 0;
      }
      if (curr_plateau_count >= config.plateau_count) {
        console.log("Plateau detected, exiting early");
        break;
      }
    } else {
      Z0_best = Z0;
      best_step = curr_step;
    }

    if ((Z0 > config.Z0_target) !== config.is_positive_correlation) {
      if (!found_upper_bound) {
        v_upper = v_upper*growth_ratio;
      }
      v_lower = v_pivot;
    } else {
      found_upper_bound = true;
      v_upper = v_pivot;
    }

    const error = Math.abs(config.Z0_target - Z0)/config.Z0_target;
    if (error < config.error_tolerance) {
      console.log("Exiting since impedance is within tolerance");
      break;
    }

    curr_step++;
    // avoid blocking main render thread
    await new Promise((res) => setTimeout(res, 0));
  }
  const end_ms = performance.now();
  const elapsed_ms = end_ms-start_ms;
  const total_steps = curr_step+1;

  return {
    results,
    total_steps,
    elapsed_ms,
    best_step: best_step as number,
  };
};

