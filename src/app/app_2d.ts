import init_wasm_module, {
  electrostatic_solver,
  calculate_homogenous_energy,
  calculate_inhomogenous_energy,
} from "../wasm/pkg/fdtd_wasm.js";
import { Ndarray, NdarrayView } from "./ndarray.ts";

export interface TransmissionLineParameters {
  dielectric_bottom_epsilon: number;
  dielectric_bottom_height: number;
  signal_separation: number;
  signal_width: number;
  signal_height: number;
  dielectric_top_epsilon: number;
  dielectric_top_height: number;
}

export interface GridLayout {
  pad_x: number;
  signal_width: number;
  signal_height: number;
  plane_height: number;
  plane_separation: number;
  signal_separation: number;
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

export function create_grid_layout(): GridLayout {
  const scale = 2;
  return {
    pad_x: 8*scale,
    signal_width: 8*scale+1,
    signal_height: 4*scale+1,
    plane_height: 2*scale+1,
    plane_separation: 8*scale+1,
    signal_separation: 8*scale+1,
  }
}

function create_grid(layout: GridLayout): Grid {
  const Nx = layout.pad_x+layout.signal_width+layout.signal_separation+layout.signal_width+layout.pad_x;
  const Ny = layout.plane_height+layout.plane_separation+layout.signal_height+layout.plane_separation+layout.plane_height;

  const dx = Ndarray.create_zeros([Nx], "f32");
  const dy = Ndarray.create_zeros([Ny], "f32");
  const v_force = Ndarray.create_zeros([Ny,Nx], "u32");
  const v_table = Ndarray.create_zeros([16], "f32");
  const v_field = Ndarray.create_zeros([Ny,Nx], "f32");
  const e_field = Ndarray.create_zeros([Ny,Nx,2], "f32");
  const epsilon_k = Ndarray.create_zeros([Ny,Nx], "f32");

  dx.fill(1.0);
  dy.fill(1.0);
  v_force.fill(0);
  v_table.fill(0);
  v_field.fill(0.0);
  e_field.fill(0.0);
  epsilon_k.fill(1.0);

  return {
    size: [Ny,Nx],
    dx,
    dy,
    v_force,
    v_table,
    v_field,
    e_field,
    epsilon_k,
  }
}

function normalise_transmission_line_parameters(
  params: TransmissionLineParameters, layout: GridLayout,
  target_ratio?: number,
): TransmissionLineParameters {
  target_ratio = target_ratio ?? 0.5;
  const ratios: number[] = [
    params.dielectric_bottom_height/layout.plane_separation,
    params.dielectric_top_height/layout.plane_separation,
    params.signal_width/layout.signal_width,
    params.signal_separation/layout.signal_separation,
    params.signal_height/layout.signal_height,
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

function get_geometric_spline(r: number, k: number, a: number): number[] {
  let x = a;
  const dx = [];
  for (let i = 0; i <= k; i++) {
    dx.push(x);
    x *= r;
  }
  x /= r;
  for (let i = 0; i < k; i++) {
    x /= r;
    dx.push(x);
  }
  return dx;
};

function get_geometric_sum_A(r: number, k: number, a?: number, epsilon?: number): number {
  epsilon = epsilon ?? 1e-2;
  a = a ?? 1.0;
  if (Math.abs(r-1) < epsilon) {
    return a*(2*k+1);
  }
  const rk = r**k;
  return a*(rk + 2*(rk-1)/(r-1));
};

function _get_geometric_sum_k(A: number, r: number, a: number): number {
  a = a ?? 1.0;
  return Math.log(((A/a)*(r-1)+2)/(r+1)) / Math.log(r);
};

function get_geometric_sum_r(
  A: number, k: number, a: number,
  r_lower?: number, r_upper?: number,
  max_loops?: number, epsilon?: number,
): number {
  r_lower = r_lower ?? 0;
  r_upper = r_upper ?? 1;
  max_loops = max_loops ?? 32;
  epsilon = epsilon ?? 1e-2;

  const growth_ratio = 2;
  let r_best: number = 1;
  let error_abs_best = Infinity;
  let is_found_upper_bound = false;
  for (let i = 0; i < max_loops; i++) {
    const r_pivot: number = is_found_upper_bound ? (r_lower+r_upper)/2.0 : r_upper;
    const A_pivot = get_geometric_sum_A(r_pivot, k, a);
    const error_pivot = (A_pivot - A)/A;
    const error_abs_pivot = Math.abs(error_pivot);
    if (error_abs_pivot < error_abs_best) {
      error_abs_best = error_abs_pivot;
      r_best = r_pivot;
    }
    if (error_abs_pivot < epsilon) {
      break;
    }
    if (error_pivot > 0) {
      // need to decrease r
      is_found_upper_bound = true;
      r_upper = r_pivot;
    } else {
      // need to increase r
      if (!is_found_upper_bound) {
        r_upper = r_upper*growth_ratio;
      }
      r_lower = r_pivot;
    }
  }
  return r_best;
};


function fill_spline(arr: NdarrayView, target_length: number) {
  if (arr.shape.length !== 1) {
    throw Error(`Expected 1d vector for spline generation but got (${arr.shape.join(',')})`);
  }
  const N = arr.shape[0];
  if (N % 2 == 0) {
    throw Error(`Expected 1d vector to have odd number of elements but got (${arr.shape.join(',')})`);
  }
  const k = Math.floor(N/2);
  const a = 1.0;
  const r = get_geometric_sum_r(target_length, k, a);
  const spline = get_geometric_spline(r, k, a);
  for (let i = 0; i < N; i++) {
    arr.set([i], spline[i]);
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
  grid_layout: GridLayout;
  grid: Grid;
  params?: TransmissionLineParameters;

  constructor(layout: GridLayout) {
    this.grid_layout = layout;
    this.grid = create_grid(layout);
  }

  reset() {
    const { v_field, e_field } = this.grid;
    v_field.fill(0.0);
    e_field.fill(0.0);
  }

  update_params(base_params: TransmissionLineParameters) {
    const params = normalise_transmission_line_parameters(base_params, this.grid_layout);
    this.params = params;

    const {
      size,
      dx,
      dy,
      v_force,
      v_table,
      v_field,
      e_field,
      epsilon_k,
    } = this.grid;
    const [Ny,Nx] = size;
    const {
      pad_x,
      signal_width,
      signal_height,
      plane_height,
      plane_separation,
      signal_separation,
    } = this.grid_layout;

    v_field.fill(0.0);
    e_field.fill(0.0);

    v_table.set([0], 0.0);
    v_table.set([1], 1.0);
    v_table.set([2], -1.0);

    // force field potentials
    v_force.fill(0);
    v_force
      .lo([0, 0])
      .hi([plane_height+1, Nx])
      .fill((0 << 16) | 0xFFFF);
    v_force
      .lo([Ny-plane_height, 0])
      .hi([plane_height, Nx])
      .fill((0 << 16) | 0xFFFF);
    v_force
      .lo([plane_height+plane_separation, Math.floor(Nx/2-signal_separation/2-signal_width)])
      .hi([signal_height+1, signal_width+1])
      .fill((1 << 16) | 0xFFFF);
    v_force
      .lo([plane_height+plane_separation, Math.floor(Nx/2+signal_separation/2)])
      .hi([signal_height+1, signal_width+1])
      .fill((2 << 16) | 0xFFFF);
    // create dielectric
    epsilon_k.fill(1.0);
    epsilon_k
      .lo([plane_height, 0])
      .hi([plane_separation, Nx])
      .fill(params.dielectric_bottom_epsilon);
    epsilon_k
      .lo([plane_height+plane_separation, 0])
      .hi([signal_height+plane_separation, Nx])
      .fill(params.dielectric_top_epsilon);

    // increase effective transmission line width
    fill_spline(dx.lo([Math.floor(Nx/2-signal_separation/2-signal_width)]).hi([signal_width]), params.signal_width);
    fill_spline(dx.lo([Math.floor(Nx/2+signal_separation/2)]).hi([signal_width]), params.signal_width);
    // increase effective spacing between pairs
    fill_spline(dx.lo([Math.floor(Nx/2-signal_separation/2)]).hi([signal_separation]), params.signal_separation);
    // increase effective plane separation bot
    fill_spline(dy.lo([plane_height]).hi([plane_separation]), params.dielectric_bottom_height);
    // increase effective trace thickness
    fill_spline(dy.lo([plane_height+plane_separation]).hi([signal_height]), params.signal_height);
    // increase effective plane separation top
    fill_spline(dy.lo([plane_height+plane_separation+signal_height]).hi([plane_separation]), params.dielectric_top_height);
    // create stretch padding
    let dx_stretch = 1.0;
    for (let x = 0; x < pad_x; x++) {
      dx.set([pad_x-1-x], dx_stretch);
      dx.set([Nx-pad_x+x], dx_stretch);
      dx_stretch *= 1.2;
    }
  }

  run(energy_threshold: number): RunResult {
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

  render(canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (context === null) {
      throw Error("Failed to retrieve 2d context from canvas");
    }
    const [Ny, Nx] = this.grid.size;
    canvas.width = Nx;
    canvas.height = Ny;

    const image_data = context.createImageData(Nx, Ny);

    const data = Ndarray.create_zeros([Ny,Nx], "f32");
    const { v_field, e_field, dx, dy } = this.grid;
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
}

export { init_wasm_module };
