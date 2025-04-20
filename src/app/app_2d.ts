import init_wasm_module, {
  electrostatic_solver,
  calculate_homogenous_energy,
  calculate_inhomogenous_energy,
} from "../wasm/pkg/fdtd_wasm.js";
import { Ndarray, NdarrayView } from "./ndarray.ts";
import {
  generate_asymmetric_geometric_grid,
  generate_asymmetric_geometric_grid_from_regions,
  type AsymmetricGeometricGrid,
} from "./mesher.ts";

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

export interface Grid {
  size: [number, number];
  dx: Ndarray;
  dy: Ndarray;
  v_force: Ndarray;
  v_table: Ndarray;
  v_field: Ndarray;
  e_field: Ndarray;
  epsilon_k: Ndarray;
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

export interface RunResult {
  total_steps: number;
  time_taken: number;
  cell_rate: number;
  step_rate: number;
  total_cells: number;
}

export interface ImpedanceResult {
  Z0: number;
  Cih: number;
  Lh: number;
  propagation_speed: number;
  propagation_delay: number;
}

export class Setup {
  grid?: Grid;
  grid_layout?: GridLayout;
  params?: TransmissionLineParameters;

  constructor() {}

  reset() {
    if (this.grid) {
      const { v_field, e_field } = this.grid;
      v_field.fill(0.0);
      e_field.fill(0.0);
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
    const pad_left = 2*signal_width_left;
    const pad_right = 2*signal_width_right;

    const region_heights = y_grid.map((grid) => grid.n0+grid.n1);
    const [plane_separation_bottom, signal_height, plane_separation_top] = region_heights;
    const plane_height = 3;
    const Nx = pad_left + region_widths.reduce((a,b) => a+b, 0) + pad_right;
    const Ny = plane_height + region_heights.reduce((a,b) => a+b, 0) + plane_height;

    const size: [number, number] = [Ny, Nx];
    const dx = Ndarray.create_zeros([Nx], "f32");
    const dy = Ndarray.create_zeros([Ny], "f32");
    const v_force = Ndarray.create_zeros([Ny,Nx], "u32");
    const v_table = Ndarray.create_zeros([3], "f32");
    const v_field = Ndarray.create_zeros([Ny,Nx], "f32");
    const e_field = Ndarray.create_zeros([Ny,Nx,2], "f32");
    const epsilon_k = Ndarray.create_zeros([Ny,Nx], "f32");

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

    this.grid = {
      size,
      dx,
      dy,
      v_force,
      v_table,
      v_field,
      e_field,
      epsilon_k,
    };

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

  run(energy_threshold: number): RunResult {
    if (this.grid === undefined) {
      throw Error("Tried to run simulation when grid wasn't created");
    }
    const [Ny,Nx] = this.grid.size;
    let total_steps: number = 0;

    const step_stride = Math.round((Nx*Ny)**0.5)*2;
    const total_cells = Nx*Ny;
    let previous_energy: number | null = null;

    const v_field = this.grid.v_field.cast(Float32Array);
    const e_field = this.grid.e_field.cast(Float32Array);
    const dx = this.grid.dx.cast(Float32Array);
    const dy = this.grid.dy.cast(Float32Array);
    const v_force = this.grid.v_force.cast(Uint32Array);
    const v_table = this.grid.v_table.cast(Float32Array);

    const start_ms = performance.now();
    const max_step_strides = 100;
    for (let i = 0; i < max_step_strides; i++) {
      electrostatic_solver(v_field, e_field, dx, dy, v_force, v_table, step_stride);
      total_steps += step_stride;
      const energy = calculate_homogenous_energy(e_field, dx, dy)
      if (previous_energy !== null) {
        const delta_energy = Math.abs(previous_energy-energy)/energy;
        if (delta_energy < energy_threshold) {
          break;
        }
      }
      previous_energy = energy;
    }
    const end_ms = performance.now();
    const elapsed_ms = end_ms-start_ms;
    const time_taken = elapsed_ms*1e-3;
    const cell_rate = (total_cells*total_steps)/time_taken;
    const step_rate = total_steps/time_taken;
    return {
      total_steps,
      time_taken,
      cell_rate,
      step_rate,
      total_cells,
    }
  }

  calculate_impedance(): ImpedanceResult {
    if (this.grid === undefined) {
      throw Error("Tried to calculate impedance when grid wasn't created");
    }

    const epsilon_0 = 8.85e-12
    const c_0 = 3e8;

    const energy_homogenous = calculate_homogenous_energy(
      this.grid.e_field.cast(Float32Array),
      this.grid.dx.cast(Float32Array),
      this.grid.dy.cast(Float32Array),
    );
    const energy_inhomogenous = calculate_inhomogenous_energy(
      this.grid.e_field.cast(Float32Array),
      this.grid.epsilon_k.cast(Float32Array),
      this.grid.dx.cast(Float32Array),
      this.grid.dy.cast(Float32Array),
    );

    const v0: number = 2.0;
    const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
    const Lh = 1/((c_0**2) * Ch);
    const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;
    const Z0 = (Lh/Cih)**0.5;
    const propagation_speed = 1/(Cih*Lh)**0.5;
    const propagation_delay = 1/propagation_speed;
    return {
      Z0,
      Cih,
      Lh,
      propagation_speed,
      propagation_delay,
    };
  }
}

export function render_grid_to_canvas(canvas: HTMLCanvasElement, grid: Grid) {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw Error("Failed to retrieve 2d context from canvas");
  }
  const [Ny, Nx] = grid.size;
  canvas.width = Nx;
  canvas.height = Ny;

  const image_data = context.createImageData(Nx, Ny);

  const data = Ndarray.create_zeros([Ny,Nx], "f32");
  const { v_field, e_field, dx, dy } = grid;
  for (let y = 0; y < Ny; y++) {
    for (let x = 0; x < Nx; x++) {
      const _v = v_field.get([y,x]);
      const ex = e_field.get([y,x,0]);
      const ey = e_field.get([y,x,1]);
      const dx_avg = (dx.get([Math.max(x-1,0)]) + dx.get([x]))/2.0;
      const dy_avg = (dy.get([Math.max(y-1,0)]) + dy.get([y]))/2.0;
      // e-field lies on boundary of yee-grid
      const energy = (ex**2)*dx.get([x])*dy_avg + (ey**2)*dy.get([y])*dx_avg;
      data.set([y,x], energy);
    }
  }
  const data_max = data.cast(Float32Array).reduce((a,b) => Math.max(a,b), 0.0);
  for (let y = 0; y < Ny; y++) {
    for (let x = 0; x < Nx; x++) {
      const i_image = 4*(x + y*Nx);
      const d = data.get([y,x]);
      const scale = 255/data_max;
      const value = Math.min(Math.round(d*scale), 255);
      const r = value;
      const g = value;
      const b = value;
      const a = 255;
      image_data.data[i_image+0] = r;
      image_data.data[i_image+1] = g;
      image_data.data[i_image+2] = b;
      image_data.data[i_image+3] = a;
    }
  }
  context.putImageData(image_data, 0, 0);

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
    const run_result = setup.run(energy_threshold);
    const impedance_result = setup.calculate_impedance();
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


export { init_wasm_module };
