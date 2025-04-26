import {
  bake_2d,
  iterate_solver_2d,
  calculate_homogenous_energy_2d,
  calculate_inhomogenous_energy_2d,
} from "../wasm/pkg/fdtd_core.js";
import { Ndarray } from "../utility/ndarray.ts";

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

export class Grid {
  size: [number, number];
  dx: Ndarray;
  dy: Ndarray;
  v_force: Ndarray;
  v_table: Ndarray;
  v_field: Ndarray;
  e_field: Ndarray;
  epsilon_k: Ndarray;

  dx_mid: Ndarray;
  dy_mid: Ndarray;
  dxy_norm: Ndarray;

  constructor(Ny: number, Nx: number) {
    this.size = [Ny, Nx];
    this.dx = Ndarray.create_zeros([Nx], "f32");
    this.dy = Ndarray.create_zeros([Ny], "f32");
    this.v_force = Ndarray.create_zeros([Ny,Nx], "u32");
    this.v_table = Ndarray.create_zeros([3], "f32");
    this.v_field = Ndarray.create_zeros([Ny,Nx], "f32");
    this.e_field = Ndarray.create_zeros([Ny,Nx,2], "f32");
    this.epsilon_k = Ndarray.create_zeros([Ny,Nx], "f32");

    this.dx_mid = Ndarray.create_zeros([Nx-1], "f32");
    this.dy_mid = Ndarray.create_zeros([Ny-1], "f32");
    this.dxy_norm = Ndarray.create_zeros([Ny-1, Nx-1], "f32");
  }

  bake() {
    bake_2d(
      this.dx.cast(Float32Array),
      this.dy.cast(Float32Array),
      this.dx_mid.cast(Float32Array),
      this.dy_mid.cast(Float32Array),
      this.dxy_norm.cast(Float32Array),
    );
  }

  reset() {
    this.v_field.fill(0.0);
    this.e_field.fill(0.0);
  }

  run(energy_threshold: number): RunResult {
    const [Ny,Nx] = this.size;
    let total_steps: number = 0;

    const step_stride = Math.round((Nx*Ny)**0.5)*2;
    const total_cells = Nx*Ny;
    let previous_energy: number | null = null;

    const v_field = this.v_field.cast(Float32Array);
    const e_field = this.e_field.cast(Float32Array);
    const dx = this.dx.cast(Float32Array);
    const dy = this.dy.cast(Float32Array);
    const dx_mid = this.dx_mid.cast(Float32Array);
    const dy_mid = this.dy_mid.cast(Float32Array);
    const dxy_norm = this.dxy_norm.cast(Float32Array);
    const v_force = this.v_force.cast(Uint32Array);
    const v_table = this.v_table.cast(Float32Array);

    const start_ms = performance.now();
    const max_step_strides = 100;
    for (let i = 0; i < max_step_strides; i++) {
      iterate_solver_2d(
        v_field, e_field,
        dx, dy,
        dx_mid, dy_mid, dxy_norm,
        v_force, v_table,
        step_stride
      );
      total_steps += step_stride;
      const energy = calculate_homogenous_energy_2d(e_field, dx, dy)
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

    const energy_homogenous = calculate_homogenous_energy_2d(
      this.e_field.cast(Float32Array),
      this.dx.cast(Float32Array),
      this.dy.cast(Float32Array),
    );
    const energy_inhomogenous = calculate_inhomogenous_energy_2d(
      this.e_field.cast(Float32Array),
      this.epsilon_k.cast(Float32Array),
      this.dx.cast(Float32Array),
      this.dy.cast(Float32Array),
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

  get width(): number {
    return this.dx.cast(Float32Array).reduce((a,b) => a+b, 0);
  }

  get height(): number {
    return this.dy.cast(Float32Array).reduce((a,b) => a+b, 0);
  }
}
