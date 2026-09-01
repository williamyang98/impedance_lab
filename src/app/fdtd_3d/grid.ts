import type { Vec3 } from "../../utility/dim_types.ts";
import { Ndarray, get_dtype_size, type NdarrayType } from "../../utility/ndarray.ts";
import {
  KernelCurrentSource, KernelUpdateElectricField, KernelUpdateMagneticField,
  type NdGpuArray,
} from "../../wgpu_kernels/fdtd_3d/index.ts";

type CpuFieldBuffers = Vec3<Ndarray>;
type GpuFieldBuffers = Vec3<NdGpuArray>;
type Size3D = Vec3<number>;

export class CpuGrid {
  size: Size3D;

  d: CpuFieldBuffers;
  grid_lines: CpuFieldBuffers;
  dt: number;

  sigma_k: Ndarray;
  epsilon_r: Ndarray;
  mu_r: Ndarray;

  E: CpuFieldBuffers;
  H: CpuFieldBuffers;

  bake_alpha: Ndarray;
  bake_beta: Ndarray;
  bake_phi: Ndarray;

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

    this.sigma_k = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.epsilon_r = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.mu_r = Ndarray.create_zeros([size.z,size.y,size.x], "f32");

    this.E = {
      x: Ndarray.create_zeros([size.z+1,size.y+1,size.x], "f32"),
      y: Ndarray.create_zeros([size.z+1,size.y,size.x+1], "f32"),
      z: Ndarray.create_zeros([size.z,size.y+1,size.x+1], "f32"),
    };

    this.H = {
      x: Ndarray.create_zeros([size.z,size.y,size.x+1], "f32"),
      y: Ndarray.create_zeros([size.z,size.y+1,size.x], "f32"),
      z: Ndarray.create_zeros([size.z+1,size.y,size.x], "f32"),
    };

    // alpha = 1/(1+sigma_k/e_k*dt)
    // beta = dt/e_k
    // phi = dt/mu_k
    this.bake_alpha = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.bake_beta = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
    this.bake_phi = Ndarray.create_zeros([size.z,size.y,size.x], "f32");
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

  bake_materials() {
    const dt = this.dt;
    const epsilon_0 = 8.85e-12;
    const mu_0 = 1.26e-6;

    const {x: Nx, y: Ny, z: Nz } = this.size;
    for (let z = 0; z < Nz; z++) {
      for (let y = 0; y < Ny; y++) {
        for (let x = 0; x < Nx; x++) {
          const i = [z,y,x];
          const epsilon_k = this.epsilon_r.get(i)*epsilon_0;
          const mu_k = this.mu_r.get(i)*mu_0;
          const sigma_k = this.sigma_k.get(i);

          const alpha = 1/(1+sigma_k/epsilon_k*dt);
          const beta = dt/epsilon_k;
          const phi = dt/mu_k;
          this.bake_alpha.set(i, alpha);
          this.bake_beta.set(i, beta);
          this.bake_phi.set(i, phi);
        }
      }
    }
  }
}

export class GpuGrid {
  size: Size3D;
  adapter: GPUAdapter;
  device: GPUDevice;

  d: GpuFieldBuffers;
  E: GpuFieldBuffers;
  H: GpuFieldBuffers;

  bake_alpha: NdGpuArray;
  bake_beta: NdGpuArray;
  bake_phi: NdGpuArray;

  constructor(adapter: GPUAdapter, device: GPUDevice, size: Size3D) {
    this.adapter = adapter;
    this.device = device;
    this.size = size;

    const create_buffer = (shape: number[], dtype: NdarrayType): NdGpuArray => {
      const elem_size_bytes = get_dtype_size(dtype);
      const total_elements = shape.reduce((a,b) => a*b, 1);
      const byte_length = total_elements*elem_size_bytes;
      const data = device.createBuffer({
        size: byte_length,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      return {
        data,
        shape,
        dtype,
      };
    };

    this.d = {
      x: create_buffer([size.x], "f32"),
      y: create_buffer([size.y], "f32"),
      z: create_buffer([size.z], "f32"),
    };

    this.E = {
      x: create_buffer([size.z+1,size.y+1,size.x], "f32"),
      y: create_buffer([size.z+1,size.y,size.x+1], "f32"),
      z: create_buffer([size.z,size.y+1,size.x+1], "f32"),
    };

    this.H = {
      x: create_buffer([size.z,size.y,size.x+1], "f32"),
      y: create_buffer([size.z,size.y+1,size.x], "f32"),
      z: create_buffer([size.z+1,size.y,size.x], "f32"),
    };

    this.bake_alpha = create_buffer([size.z,size.y,size.x], "f32");
    this.bake_beta = create_buffer([size.z,size.y,size.x], "f32");
    this.bake_phi = create_buffer([size.z,size.y,size.x], "f32");
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
    const copy_field_buffers = (gpu: GpuFieldBuffers, cpu: CpuFieldBuffers) => {
      copy_buffer(gpu.x, cpu.x);
      copy_buffer(gpu.y, cpu.y);
      copy_buffer(gpu.z, cpu.z);
    };
    copy_field_buffers(this.d, cpu.d);
    copy_field_buffers(this.E, cpu.E);
    copy_field_buffers(this.H, cpu.H);
    copy_buffer(this.bake_alpha, cpu.bake_alpha);
    copy_buffer(this.bake_beta, cpu.bake_beta);
    copy_buffer(this.bake_phi, cpu.bake_phi);
  }
}

export interface SimulationSource {
  current_id: number;
  offset: Size3D;
  size: Size3D;
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

  kernel_current_source: KernelCurrentSource;
  kernel_update_e_field: KernelUpdateElectricField;
  kernel_update_h_field: KernelUpdateMagneticField;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    const source_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    const grid_workgroup_size: Size3D = { x: 16, y: 16, z: 1 };
    this.kernel_current_source = new KernelCurrentSource(source_workgroup_size, device);
    this.kernel_update_e_field = new KernelUpdateElectricField(grid_workgroup_size, device);
    this.kernel_update_h_field = new KernelUpdateMagneticField(grid_workgroup_size, device);
  }

  step_fdtd(setup: SimulationSetup) {
    const sources = setup.sources;
    const gpu = setup.gpu;
    setup.timer.trigger();
    for (const source of sources) {
      const values = setup.source_values[source.current_id];
      if (values === undefined) continue;
      const value = values.at(setup.current_step);
      if (value === undefined) continue;

      // FIXME: we cannot reuse the uniform buffer for each pass since it just references the same uniform buffer
      //        this has the unintended consequence of writing to the very last location for all the sources
      //        we can allocate a new uniform buffer for each unique pass that is used by each source
      const command_encoder = this.device.createCommandEncoder();
      this.kernel_current_source.create_pass(command_encoder, gpu.E, value, gpu.size, source.offset, source.size);
      this.device.queue.submit([command_encoder.finish()]);
    }

    const command_encoder = this.device.createCommandEncoder();
    this.kernel_update_e_field.create_pass(command_encoder, gpu.d, gpu.E, gpu.H, gpu.bake_alpha, gpu.bake_beta, gpu.size);
    this.kernel_update_h_field.create_pass(command_encoder, gpu.d, gpu.H, gpu.E, gpu.bake_phi, gpu.size);
    this.device.queue.submit([command_encoder.finish()]);
    setup.current_step += 1;
    setup.timer.trigger();
  }
}
