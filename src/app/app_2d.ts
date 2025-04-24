import { NdarrayView } from "../utility/ndarray.ts";
import {
  generate_asymmetric_geometric_grid,
  generate_asymmetric_geometric_grid_from_regions,
  type AsymmetricGeometricGrid,
} from "../engine/mesher.ts";
import { Grid, type ImpedanceResult, type RunResult } from "../engine/electrostatic_2d.ts";

export interface TransmissionLineParameters {
  dielectric_bottom_epsilon: number;
  dielectric_bottom_height: number;
  signal_separation: number;
  signal_width: number;
  signal_height: number;
  dielectric_top_epsilon: number;
  dielectric_top_height: number;
}

interface GridLayout {
  pad_left: number;
  pad_right: number;
  signal_width_left: number;
  signal_separation: number;
  signal_width_right: number;
  signal_height: number;
  plane_height: number;
  plane_separation_bottom: number;
  plane_separation_top: number;
}

function normalise_transmission_line_parameters(
  params: TransmissionLineParameters, target_ratio?: number,
): TransmissionLineParameters {
  target_ratio = target_ratio ?? 0.5;
  const ratios: number[] = [
    params.dielectric_bottom_height,
    params.dielectric_top_height,
    params.signal_width,
    params.signal_separation,
    params.signal_height,
  ];
  const min_ratio: number = ratios.reduce((a,b) => Math.min(a,b), Infinity);
  const rescale = target_ratio / min_ratio;
  return {
    dielectric_bottom_epsilon: params.dielectric_bottom_epsilon,
    dielectric_bottom_height: params.dielectric_bottom_height*rescale,
    signal_separation: params.signal_separation*rescale,
    signal_width: params.signal_width*rescale,
    signal_height: params.signal_height*rescale,
    dielectric_top_epsilon: params.dielectric_top_epsilon,
    dielectric_top_height: params.dielectric_top_height*rescale,
  }
};

export class Setup {
  grid?: Grid;
  grid_layout?: GridLayout;
  params?: TransmissionLineParameters;

  constructor() {}

  reset() {
    if (this.grid) {
      const { v_field, e_field } = this.grid;
      v_field.fill(0);
      e_field.fill(0);
    }
  }

  update_params(base_params: TransmissionLineParameters) {
    const params = normalise_transmission_line_parameters(base_params);
    this.params = params;

    const x_regions = [params.signal_width, params.signal_separation, params.signal_width];
    const y_regions = [params.dielectric_bottom_height, params.signal_height, params.dielectric_top_height];


    const x_min_subdivisions = 10;
    const y_min_subdivisions = 5;
    const x_max_ratio = 0.30;
    const y_max_ratio = 0.35;
    const x_grid = generate_asymmetric_geometric_grid_from_regions(x_regions, x_min_subdivisions, x_max_ratio);
    const y_grid = generate_asymmetric_geometric_grid_from_regions(y_regions, y_min_subdivisions, y_max_ratio);

    const region_widths = x_grid.map((grid) => grid.n0+grid.n1);
    const [signal_width_left, signal_separation, signal_width_right] = region_widths;
    const pad_left = signal_width_left;
    const pad_right = signal_width_right;

    const region_heights = y_grid.map((grid) => grid.n0+grid.n1);
    const [plane_separation_bottom, signal_height, plane_separation_top] = region_heights;
    const plane_height = 2;
    const Nx = pad_left + region_widths.reduce((a,b) => a+b, 0) + pad_right;
    const Ny = plane_height + region_heights.reduce((a,b) => a+b, 0) + plane_height;

    const grid = new Grid(Ny, Nx);
    const {
      dx,
      dy,
      v_force,
      v_table,
      v_field,
      e_field,
      epsilon_k,
    } = grid;

    v_field.fill(0.0);
    e_field.fill(0.0);

    // force field potentials
    const v_ground_index = 0;
    const v_pos_index = 1;
    const v_neg_index = 2;
    v_table.set([v_ground_index], 0.0);
    v_table.set([v_pos_index], 1.0);
    v_table.set([v_neg_index], -1.0);
    v_force.fill(0);
    v_force
      .lo([0, 0])
      .hi([plane_height+1, Nx])
      .fill((v_ground_index << 16) | 0xFFFF);
    v_force
      .lo([Ny-plane_height, 0])
      .hi([plane_height, Nx])
      .fill((v_ground_index << 16) | 0xFFFF);
    v_force
      .lo([plane_height+plane_separation_bottom, pad_left])
      .hi([signal_height+1, signal_width_left+1])
      .fill((v_pos_index << 16) | 0xFFFF);
    v_force
      .lo([plane_height+plane_separation_bottom, pad_left+signal_width_left+signal_separation])
      .hi([signal_height+1, signal_width_right+1])
      .fill((v_neg_index << 16) | 0xFFFF);
    // create dielectric
    epsilon_k.fill(1.0);
    epsilon_k
      .lo([plane_height, 0])
      .hi([plane_separation_bottom, Nx])
      .fill(params.dielectric_bottom_epsilon);
    epsilon_k
      .lo([plane_height+plane_separation_bottom, 0])
      .hi([signal_height+plane_separation_top, Nx])
      .fill(params.dielectric_top_epsilon);

    function generate_deltas(deltas: NdarrayView, grids: AsymmetricGeometricGrid[]) {
      let offset = 0;
      for (let i = 0; i < grids.length; i++) {
        const grid = grids[i];
        const delta = grid.n0+grid.n1;
        const view = deltas.lo([offset]).hi([delta]);
        const subdivisions = generate_asymmetric_geometric_grid(grid);
        for (let j = 0; j < subdivisions.length; j++) {
          view.set([j], subdivisions[j]);
        }
        offset += delta;
      }
    }

    function generate_padding(deltas: NdarrayView, a: number, r: number) {
      const N = deltas.shape[0];
      let v = a;
      for (let i = 0; i < N; i++) {
        deltas.set([i], v);
        v *= r;
      }
    }

    // grid feature lines
    generate_deltas(dx.lo([pad_left]), x_grid);
    generate_deltas(dy.lo([plane_height]), y_grid);
    // grid padding
    generate_padding(dx.hi([pad_left]).reverse(), x_grid[0].a0, 1.0+x_max_ratio);
    generate_padding(dx.lo([Nx-pad_right]), x_grid[2].a1, 1.0+x_max_ratio);
    generate_padding(dy.hi([plane_height]).reverse(), y_grid[0].a0, 1.0+y_max_ratio);
    generate_padding(dy.lo([Ny-plane_height]), y_grid[2].a1, 1.0+y_max_ratio);

    grid.bake();

    this.grid = grid;
    this.grid_layout = {
      pad_left,
      pad_right,
      signal_width_left,
      signal_separation,
      signal_width_right,
      signal_height,
      plane_height,
      plane_separation_bottom,
      plane_separation_top,
    };
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

