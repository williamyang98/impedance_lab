import type { Axis3D, Vec3 } from "../../utility/dim_types.ts";
import { Ndarray } from "../../utility/ndarray.ts";
import { KernelApplyCurrentSource, Params as CurrentSourceParams } from "./kernel_apply_current_source.ts";
import { KernelUpdateVoltage } from "./kernel_update_voltage.ts";
import { KernelUpdateCurrent } from "./kernel_update_current.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";

type Size3D = Vec3<number>;

export class CpuGrid {
  size: Size3D;

  d: Vec3<Ndarray>;
  grid_lines: Vec3<Ndarray>;
  dt: number;

  sigma_k: Ndarray;
  epsilon_r: Ndarray;
  mu_r: Ndarray;

  V: Vec3<Ndarray>;
  I: Vec3<Ndarray>;

  bake_R: Vec3<Ndarray>;
  bake_C: Vec3<Ndarray>;
  bake_L: Vec3<Ndarray>;

  bake_alpha: Vec3<Ndarray>;
  bake_beta: Vec3<Ndarray>;
  bake_phi: Vec3<Ndarray>;

  constructor(size: Size3D) {
    this.size = size;

    this.d = {
      x: Ndarray.create_zeros([size.x], "f32"),
      y: Ndarray.create_zeros([size.y], "f32"),
      z: Ndarray.create_zeros([size.z], "f32"),
    };
    this.grid_lines = {
      x: Ndarray.create_zeros([size.x+1], "f32"),
      y: Ndarray.create_zeros([size.y+1], "f32"),
      z: Ndarray.create_zeros([size.z+1], "f32"),
    };
    this.dt = 1;

    const create_cell_array = (): Ndarray => {
      return Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    };

    const create_edge_arrays = (): Vec3<Ndarray> => {
      return {
        x: Ndarray.create_zeros([size.z+1,size.y+1,size.x], "f32"),
        y: Ndarray.create_zeros([size.z+1,size.y,size.x+1], "f32"),
        z: Ndarray.create_zeros([size.z,size.y+1,size.x+1], "f32"),
      };
    };

    const create_face_arrays = (): Vec3<Ndarray> => {
      return {
        x: Ndarray.create_zeros([size.z,size.y,size.x+1], "f32"),
        y: Ndarray.create_zeros([size.z,size.y+1,size.x], "f32"),
        z: Ndarray.create_zeros([size.z+1,size.y,size.x], "f32"),
      };
    };

    this.sigma_k = create_cell_array();
    this.epsilon_r = create_cell_array();
    this.mu_r = create_cell_array();

    this.V = create_edge_arrays();
    this.I = create_face_arrays();

    // alpha = 1/(1+dt/RC)
    // beta = dt/C
    // phi = dt/L
    this.bake_R = create_edge_arrays();
    this.bake_C = create_edge_arrays();
    this.bake_L = create_face_arrays();
    this.bake_alpha = create_edge_arrays();
    this.bake_beta = create_edge_arrays();
    this.bake_phi = create_face_arrays();
  }

  calculate_minimum_timestep() {
    // https://en.wikipedia.org/wiki/Courant%E2%80%93Friedrichs%E2%80%93Lewy_condition#The_two_and_general_n-dimensional_case
    // satisfy courant criteria
    // Cmax >= dt*sum(ui/xi), u = speed, x = distance
    // Cmax >= dt*(c/dx + c/dy + c/dz)
    // dt <= Cmax/[c*(1/dx+1/dy+1/dz)]
    // For an explicit time marching solver Cmax=1
    // dt <= Cmax/[c*(1/dx+1/dy+1/dz)]
    // dt(max) = Cmax/[c*(1/dx(min)+1/dy(min)+1/dz(min))]
    const dx_min = this.d.x.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    const dy_min = this.d.y.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    const dz_min = this.d.z.cast(Float32Array).reduce((a, b) => Math.min(a,b), Infinity);
    if (dx_min === 0) throw Error("min(dx) is zero but must have a finite non-zero cell dimension");
    if (dy_min === 0) throw Error("min(dy) is zero but must have a finite non-zero cell dimension");
    if (dz_min === 0) throw Error("min(dz) is zero but must have a finite non-zero cell dimension");
    const Cmax = 0.98; // slightly less than 1 to guarantee stability
    const c = 299792458;
    const k_max = 1/dx_min + 1/dy_min + 1/dz_min;
    const dt_max = Cmax/(c*k_max);
    this.dt = dt_max;
  }

  bake_cell_materials() {
    const dt = this.dt;
    const epsilon_0 = 8.85e-12;
    const mu_0 = 1.26e-6;

    const {x: Nx, y: Ny, z: Nz } = this.size;

    const get_dx = (i: number) => {
      i = Math.max(Math.min(i, Nx-1), 0);
      return this.d.x.get([i]);
    }

    const get_dy = (j: number) => {
      j = Math.max(Math.min(j, Ny-1), 0);
      return this.d.y.get([j]);
    }

    const get_dz = (k: number) => {
      k = Math.max(Math.min(k, Nz-1), 0);
      return this.d.z.get([k]);
    }

    // Edge components R,C
    // R = L/(sigma*A) (Equation 3.3)
    // C = epsilon*A/d (Equation 3.1)
    // R_parallel = 1/sum(1/R) = 1/sum(sigma*A/L) = 1/[1/L*sum(sigma*A)] = L/sum(sigma*A)
    // C_parallel = sum(C) = sum(epsilon*A)/d
    // alpha = 1/(1+dt/RC) (Equation 3.6)
    // beta = dt/C (Equation 3.7)
    const get_epsilon_r = (i: number, j: number, k: number): number => {
      if (i < 0 || i >= Nx || j < 0 || j >= Ny || k < 0 || k >= Nz) return 0;
      return this.epsilon_r.get([k,j,i]);
    };

    const get_sigma_k = (i: number, j: number, k: number): number => {
      if (i < 0 || i >= Nx || j < 0 || j >= Ny || k < 0 || k >= Nz) return 0;
      return this.sigma_k.get([k,j,i]);
    };
    // x-axis
    for (let k = 0; k < Nz+1; k++) {
      for (let j = 0; j < Ny+1; j++) {
        for (let i = 0; i < Nx; i++) {
          const dx_i = get_dx(i);
          const dy_j = get_dy(j);
          const dy_j0 = get_dy(j-1);
          const dz_k = get_dz(k);
          const dz_k0 = get_dz(k-1);
          // area
          const A_jk = dy_j*dz_k*0.25;
          const A_j0k = dy_j0*dz_k*0.25;
          const A_jk0 = dy_j*dz_k0*0.25;
          const A_j0k0 = dy_j0*dz_k0*0.25;
          // capacitance
          const epsilon_r_jk = get_epsilon_r(i,j,k);
          const epsilon_r_j0k = get_epsilon_r(i,j-1,k);
          const epsilon_r_jk0 = get_epsilon_r(i,j,k-1);
          const epsilon_r_j0k0 = get_epsilon_r(i,j-1,k-1)
          const C = (epsilon_r_jk*A_jk + epsilon_r_j0k*A_j0k + epsilon_r_jk0*A_jk0 + epsilon_r_j0k0*A_j0k0)*epsilon_0/dx_i;
          // resistance
          const sigma_k_jk = get_sigma_k(i,j,k);
          const sigma_k_j0k = get_sigma_k(i,j-1,k);
          const sigma_k_jk0 = get_sigma_k(i,j,k-1);
          const sigma_k_j0k0 = get_sigma_k(i,j-1,k-1)
          const R = dx_i/(sigma_k_jk*A_jk + sigma_k_j0k*A_j0k + sigma_k_jk0*A_jk0 + sigma_k_j0k0*A_j0k0);
          // coefficients
          const tau = R*C;
          const alpha = Number.isFinite(tau) ? tau/(tau + dt) : 1;
          const beta = dt/C;
          // bake
          const index = [k,j,i];
          this.bake_C.x.set(index, C);
          this.bake_R.x.set(index, R);
          this.bake_alpha.x.set(index, alpha);
          this.bake_beta.x.set(index, beta);
        }
      }
    }
    // y-axis
    for (let k = 0; k < Nz+1; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx+1; i++) {
          const dx_i = get_dx(i);
          const dx_i0 = get_dx(i-1);
          const dy_j = get_dy(j);
          const dz_k = get_dz(k);
          const dz_k0 = get_dz(k-1);
          // area
          const A_ik = dx_i*dz_k*0.25;
          const A_i0k = dx_i0*dz_k*0.25;
          const A_ik0 = dx_i*dz_k0*0.25;
          const A_i0k0 = dx_i0*dz_k0*0.25;
          // capacitance
          const epsilon_r_ik = get_epsilon_r(i,j,k);
          const epsilon_r_i0k = get_epsilon_r(i-1,j,k);
          const epsilon_r_ik0 = get_epsilon_r(i,j,k-1);
          const epsilon_r_i0k0 = get_epsilon_r(i-1,j,k-1)
          const C = (epsilon_r_ik*A_ik + epsilon_r_i0k*A_i0k + epsilon_r_ik0*A_ik0 + epsilon_r_i0k0*A_i0k0)*epsilon_0/dy_j;
          // resistance
          const sigma_k_ik = get_sigma_k(i,j,k);
          const sigma_k_i0k = get_sigma_k(i-1,j,k);
          const sigma_k_ik0 = get_sigma_k(i,j,k-1);
          const sigma_k_i0k0 = get_sigma_k(i-1,j,k-1)
          const R = dy_j/(sigma_k_ik*A_ik + sigma_k_i0k*A_i0k + sigma_k_ik0*A_ik0 + sigma_k_i0k0*A_i0k0);
          // coefficients
          const tau = R*C;
          const alpha = Number.isFinite(tau) ? tau/(tau + dt) : 1;
          const beta = dt/C;
          // bake
          const index = [k,j,i];
          this.bake_C.y.set(index, C);
          this.bake_R.y.set(index, R);
          this.bake_alpha.y.set(index, alpha);
          this.bake_beta.y.set(index, beta);
        }
      }
    }
    // z-axis
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny+1; j++) {
        for (let i = 0; i < Nx+1; i++) {
          const dx_i = get_dx(i);
          const dx_i0 = get_dx(i-1);
          const dy_j = get_dy(j);
          const dy_j0 = get_dy(j-1);
          const dz_k = get_dz(k);
          // area
          const A_ij = dx_i*dy_j*0.25;
          const A_i0j = dx_i0*dy_j*0.25;
          const A_ij0 = dx_i*dy_j0*0.25;
          const A_i0j0 = dx_i0*dy_j0*0.25;
          // capacitance
          const epsilon_r_ij = get_epsilon_r(i,j,k);
          const epsilon_r_i0j = get_epsilon_r(i-1,j,k);
          const epsilon_r_ij0 = get_epsilon_r(i,j-1,k);
          const epsilon_r_i0j0 = get_epsilon_r(i-1,j-1,k)
          const C = (epsilon_r_ij*A_ij + epsilon_r_i0j*A_i0j + epsilon_r_ij0*A_ij0 + epsilon_r_i0j0*A_i0j0)*epsilon_0/dz_k;
          // resistance
          const sigma_k_ij = get_sigma_k(i,j,k);
          const sigma_k_i0j = get_sigma_k(i-1,j,k);
          const sigma_k_ij0 = get_sigma_k(i,j-1,k);
          const sigma_k_i0j0 = get_sigma_k(i-1,j-1,k)
          const R = dz_k/(sigma_k_ij*A_ij + sigma_k_i0j*A_i0j + sigma_k_ij0*A_ij0 + sigma_k_i0j0*A_i0j0);
          // coefficients
          const tau = R*C;
          const alpha = Number.isFinite(tau) ? tau/(tau + dt) : 1;
          const beta = dt/C;
          // bake
          const index = [k,j,i];
          this.bake_C.z.set(index, C);
          this.bake_R.z.set(index, R);
          this.bake_alpha.z.set(index, alpha);
          this.bake_beta.z.set(index, beta);
        }
      }
    }

    // Face components: L
    const get_mu_r = (i: number, j: number, k: number): number => {
      if (i < 0 || i >= Nx || j < 0 || j >= Ny || k < 0 || k >= Nz) return Infinity;
      return this.mu_r.get([k,j,i]);
    };
    // L = mu*A/d (Equation 3.2)
    // L_parallel = 1/sum(1/L) = 1/sum(d/(mu*A)) = 1/[1/A*sum(d/mu)] = A/sum(d/mu)
    // phi = dt/L (Equation 3.12)
    // x-axis
    for (let k = 0; k < Nz+1; k++) {
      for (let j = 0; j < Ny+1; j++) {
        for (let i = 0; i < Nx; i++) {
          const dx_i = get_dx(i);
          const dx_i0 = get_dx(i-1);
          const dy_j = get_dy(j);
          const dz_k = get_dz(k);
          // area
          const A_jk = dy_j*dz_k;
          // inductance
          const mu_r_i = get_mu_r(i,j,k);
          const mu_r_i0 = get_mu_r(i-1,j,k);
          const L = A_jk/(dx_i/mu_r_i + dx_i0/mu_r_i0)*mu_0;
          // coefficients
          const phi = dt/L;
          // bake
          const index = [k,j,i];
          this.bake_L.x.set(index, L);
          this.bake_phi.x.set(index, phi);
        }
      }
    }
    // y-axis
    for (let k = 0; k < Nz+1; k++) {
      for (let j = 0; j < Ny; j++) {
        for (let i = 0; i < Nx+1; i++) {
          const dx_i = get_dx(i);
          const dy_j = get_dy(j);
          const dy_j0 = get_dy(j-1);
          const dz_k = get_dz(k);
          // area
          const A_ik = dx_i*dz_k;
          // inductance
          const mu_r_j = get_mu_r(i,j,k);
          const mu_r_j0 = get_mu_r(i,j-1,k);
          const L = A_ik/(dy_j/mu_r_j + dy_j0/mu_r_j0)*mu_0;
          // coefficients
          const phi = dt/L;
          // bake
          const index = [k,j,i];
          this.bake_L.y.set(index, L);
          this.bake_phi.y.set(index, phi);
        }
      }
    }
    // z-axis
    for (let k = 0; k < Nz; k++) {
      for (let j = 0; j < Ny+1; j++) {
        for (let i = 0; i < Nx+1; i++) {
          const dx_i = get_dx(i);
          const dy_j = get_dy(j);
          const dz_k = get_dz(k);
          const dz_k0 = get_dz(k-1);
          // area
          const A_ij = dx_i*dy_j;
          // inductance
          const mu_r_k = get_mu_r(i,j,k);
          const mu_r_k0 = get_mu_r(i,j,k-1);
          const L = A_ij/(dz_k/mu_r_k + dz_k0/mu_r_k0)*mu_0;
          // coefficients
          const phi = dt/L;
          // bake
          const index = [k,j,i];
          this.bake_L.z.set(index, L);
          this.bake_phi.z.set(index, phi);
        }
      }
    }

  }
}

export class GpuGrid {
  size: Size3D;
  adapter: GPUAdapter;
  device: GPUDevice;

  sigma_k: NdGpuArray;
  epsilon_r: NdGpuArray;
  mu_r: NdGpuArray;
  grid_lines: Vec3<NdGpuArray>;
  d: Vec3<NdGpuArray>;
  V: Vec3<NdGpuArray>;
  I: Vec3<NdGpuArray>;
  bake_R: Vec3<NdGpuArray>;
  bake_C: Vec3<NdGpuArray>;
  bake_L: Vec3<NdGpuArray>;
  bake_alpha: Vec3<NdGpuArray>;
  bake_beta: Vec3<NdGpuArray>;
  bake_phi: Vec3<NdGpuArray>;

  constructor(adapter: GPUAdapter, device: GPUDevice, size: Size3D) {
    this.adapter = adapter;
    this.device = device;
    this.size = size;

    this.grid_lines = {
      x: new NdGpuArray(device, [size.x+1], "f32"),
      y: new NdGpuArray(device, [size.y+1], "f32"),
      z: new NdGpuArray(device, [size.z+1], "f32"),
    };

    this.d = {
      x: new NdGpuArray(device, [size.x], "f32"),
      y: new NdGpuArray(device, [size.y], "f32"),
      z: new NdGpuArray(device, [size.z], "f32"),
    };

    const create_cell_array = (): NdGpuArray => {
      return new NdGpuArray(device, [size.z,size.y,size.x], "f32");
    };

    const create_edge_arrays = (): Vec3<NdGpuArray> => {
      return {
        x: new NdGpuArray(device, [size.z+1,size.y+1,size.x], "f32"),
        y: new NdGpuArray(device, [size.z+1,size.y,size.x+1], "f32"),
        z: new NdGpuArray(device, [size.z,size.y+1,size.x+1], "f32"),
      };
    };

    const create_face_arrays = (): Vec3<NdGpuArray> => {
      return {
        x: new NdGpuArray(device, [size.z,size.y,size.x+1], "f32"),
        y: new NdGpuArray(device, [size.z,size.y+1,size.x], "f32"),
        z: new NdGpuArray(device, [size.z+1,size.y,size.x], "f32"),
      };
    };

    this.sigma_k = create_cell_array();
    this.epsilon_r = create_cell_array();
    this.mu_r = create_cell_array();
    this.V = create_edge_arrays();
    this.I = create_face_arrays();
    this.bake_R = create_edge_arrays();
    this.bake_C = create_edge_arrays();
    this.bake_L = create_face_arrays();
    this.bake_alpha = create_edge_arrays();
    this.bake_beta = create_edge_arrays();
    this.bake_phi = create_face_arrays();
  }

  copy_from_cpu(cpu: CpuGrid) {
    const format_size = (size: Size3D) => `{x:${size.x},y:${size.y},z:${size.z}}`;
    if (cpu.size.x !== this.size.x || cpu.size.y !== this.size.y || cpu.size.z !== this.size.z) {
      throw Error(`Mismatching grid size gpu is ${format_size(this.size)} but cpu was ${format_size(cpu.size)}`);
    }
    const check_shape_match = (s0: number[], s1: number[]): boolean => {
      if (s0.length !== s1.length) return false;
      for (let i = 0; i < s0.length; i++) {
        if (s0[i] !== s1[i]) return false;
      }
      return true;
    };
    const copy_buffer = (gpu: NdGpuArray, cpu: Ndarray) => {
      if (!check_shape_match(gpu.shape, cpu.shape)) {
        throw Error(`Mismatching gpu.shape=[${gpu.shape.join(',')}] with cpu.shape=[${cpu.shape.join(',')}]`);
      }
      this.device.queue.writeBuffer(gpu.data, 0, cpu.data, 0, cpu.data.length);
    };
    const copy_field_buffers = (gpu: Vec3<NdGpuArray>, cpu: Vec3<Ndarray>) => {
      copy_buffer(gpu.x, cpu.x);
      copy_buffer(gpu.y, cpu.y);
      copy_buffer(gpu.z, cpu.z);
    };

    copy_buffer(this.sigma_k, cpu.sigma_k);
    copy_buffer(this.epsilon_r, cpu.epsilon_r);
    copy_buffer(this.mu_r, cpu.mu_r);
    copy_field_buffers(this.grid_lines, cpu.grid_lines);
    copy_field_buffers(this.d, cpu.d);
    copy_field_buffers(this.V, cpu.V);
    copy_field_buffers(this.I, cpu.I);
    copy_field_buffers(this.bake_R, cpu.bake_R);
    copy_field_buffers(this.bake_C, cpu.bake_C);
    copy_field_buffers(this.bake_L, cpu.bake_L);
    copy_field_buffers(this.bake_alpha, cpu.bake_alpha);
    copy_field_buffers(this.bake_beta, cpu.bake_beta);
    copy_field_buffers(this.bake_phi, cpu.bake_phi);
  }
}

export interface SimulationSource {
  current_id: number;
  offset: Size3D;
  size: Size3D;
  direction: Axis3D;
}

export class Timer {
  start_millis?: number;
  end_millis?: number;

  get elapsed_seconds() {
    if (this.start_millis === undefined) return undefined;
    if (this.end_millis === undefined) return undefined;
    return (this.end_millis-this.start_millis)*1e-3;
  }

  reset() {
    this.end_millis = undefined;
    this.start_millis = undefined;
  }

  trigger() {
    const now_millis = performance.now();
    if (this.start_millis === undefined) {
      this.start_millis = now_millis;
    }
    this.end_millis = now_millis;
  }
}

export class SimulationSetup {
  size: Size3D;
  cpu: CpuGrid;
  gpu: GpuGrid;
  sources: SimulationSource[];
  source_values: Partial<Record<number, number[]>>;
  current_step: number;
  maximum_steps: number = 0;
  timer: Timer;

  constructor(adapter: GPUAdapter, device: GPUDevice, size: Size3D) {
    this.size = size;
    this.cpu = new CpuGrid(size);
    this.gpu = new GpuGrid(adapter, device, size);
    this.sources = [];
    this.current_step = 0;
    this.timer = new Timer();
    this.source_values = {};
  }

  reset() {
    this.gpu.copy_from_cpu(this.cpu);
    this.current_step = 0;
    this.timer.reset();
  }
}

export class GpuEngine {
  adapter: GPUAdapter;
  device: GPUDevice;

  kernel_apply_current_source: KernelApplyCurrentSource;
  kernel_update_voltage: KernelUpdateVoltage;
  kernel_update_current: KernelUpdateCurrent;
  current_source_params: CurrentSourceParams[];

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    const source_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    const grid_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    this.kernel_apply_current_source = new KernelApplyCurrentSource(source_workgroup_size, device);
    this.kernel_update_voltage = new KernelUpdateVoltage(grid_workgroup_size, device);
    this.kernel_update_current = new KernelUpdateCurrent(grid_workgroup_size, device);
    this.current_source_params = [];
  }

  step_fdtd(setup: SimulationSetup) {
    const sources = setup.sources;
    const gpu = setup.gpu;
    setup.timer.trigger();

    const command_encoder = this.device.createCommandEncoder();
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const values = setup.source_values[source.current_id];
      if (values === undefined) continue;
      const value = values.at(setup.current_step);
      if (value === undefined) continue;

      let source_params = this.current_source_params.at(i);
      if (source_params === undefined) {
        source_params = new CurrentSourceParams(this.device);
        this.current_source_params.push(source_params);
      }

      const V = gpu.V[source.direction];
      const beta = gpu.bake_beta[source.direction];
      source_params.view.data_size.x = V.shape[2];
      source_params.view.data_size.y = V.shape[1];
      source_params.view.data_size.z = V.shape[0];
      source_params.view.source_offset.x = source.offset.x;
      source_params.view.source_offset.y = source.offset.y;
      source_params.view.source_offset.z = source.offset.z;
      source_params.view.source_size.x = source.size.x;
      source_params.view.source_size.y = source.size.y;
      source_params.view.source_size.z = source.size.z;
      source_params.view.i_source = value;
      source_params.write_to_gpu();

      this.kernel_apply_current_source.create_pass(command_encoder, V, beta, source_params);
    }
    this.kernel_update_voltage.create_pass(command_encoder, gpu.V, gpu.I, gpu.bake_alpha, gpu.bake_beta, gpu.size);
    this.kernel_update_current.create_pass(command_encoder, gpu.I, gpu.V, gpu.bake_phi, gpu.size);
    this.device.queue.submit([command_encoder.finish()]);
    setup.current_step += 1;
    setup.timer.trigger();
  }
}
