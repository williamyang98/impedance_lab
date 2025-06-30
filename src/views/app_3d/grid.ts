import { Ndarray } from "../../utility/ndarray.ts";
import { KernelCurrentSource, KernelUpdateElectricField, KernelUpdateMagneticField } from "../../wgpu_kernels/fdtd_3d/index.ts";

export class SimulationGrid {
  size: [number, number, number];
  total_cells: number;
  init_e_field: Ndarray;
  init_h_field: Ndarray;
  init_sigma_k: Ndarray;
  init_epsilon_k: Ndarray;
  init_mu_k: number;
  init_d_xyz: number;
  init_dt: number;

  bake_a0: Ndarray;
  bake_a1: Ndarray;
  bake_b0: number;

  constructor(size: [number, number, number]) {
    this.size = size;
    this.total_cells = size.reduce((a,b) => a*b, 1);
    const total_dims = 3;

    this.init_e_field = Ndarray.create_zeros([...size, total_dims], "f32");
    this.init_h_field = Ndarray.create_zeros([...size, total_dims], "f32");
    this.init_sigma_k = Ndarray.create_zeros(size, "f32");
    this.init_epsilon_k = Ndarray.create_zeros(size, "f32");
    this.init_mu_k = 1;
    this.init_d_xyz = 1;
    this.init_dt = 1;

    this.bake_a0 = Ndarray.create_zeros(size, "f32");
    this.bake_a1 = Ndarray.create_zeros(size, "f32");
    this.bake_b0 = 0;
  }

  bake() {
    // a0 = 1/(1+sigma_k/e_k*dt)
    // a1 = 1/(e_k*d_xyz) * dt
    // b0 = 1/(mu_k*d_xyz) * dt
    const dt = this.init_dt;
    const d_xyz = this.init_d_xyz;
    const epsilon_0 = 8.85e-12;
    const mu_0 = 1.26e-6;
    const mu_k = this.init_mu_k*mu_0;

    const [Nx,Ny,Nz] = this.size;
    for (let x = 0; x < Nx; x++) {
      for (let y = 0; y < Ny; y++) {
        for (let z = 0; z < Nz; z++) {
          const i = [x,y,z];
          const epsilon_k = this.init_epsilon_k.get(i)*epsilon_0;
          const sigma_k = this.init_sigma_k.get(i);
          const a0 = 1/(1+sigma_k/epsilon_k*dt);
          const a1 = dt/(epsilon_k*d_xyz);
          this.bake_a0.set(i, a0);
          this.bake_a1.set(i, a1);
        }
      }
    }
    this.bake_b0 = dt/(mu_k*d_xyz);
  }
}

export class SimulationSource {
  signal: number[] = [];
  offset: [number, number, number] = [0,0,0];
  size: [number, number, number] = [0,0,0];
}

export interface SimulationSetup {
  grid: SimulationGrid;
  sources: SimulationSource[];
}

export class GpuGrid {
  adapter: GPUAdapter;
  device: GPUDevice;
  setup: SimulationSetup;

  e_field: GPUBuffer;
  h_field: GPUBuffer;
  bake_a0: GPUBuffer;
  bake_a1: GPUBuffer;
  bake_b0: number;

  constructor(adapter: GPUAdapter, device: GPUDevice, setup: SimulationSetup) {
    this.adapter = adapter;
    this.device = device;
    this.setup = setup;

    const create_from_ndarray = (arr: Ndarray): GPUBuffer => {
      const buffer = device.createBuffer({
        size: arr.data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      device.queue.writeBuffer(buffer, 0, arr.data, 0, arr.data.length);
      return buffer;
    };

    this.e_field = create_from_ndarray(setup.grid.init_e_field);
    this.h_field = create_from_ndarray(setup.grid.init_h_field);
    this.bake_a0 = create_from_ndarray(setup.grid.bake_a0);
    this.bake_a1 = create_from_ndarray(setup.grid.bake_a1);
    this.bake_b0 = setup.grid.bake_b0;
  }

  reset() {
    const reset_buffer = (gpu_buffer: GPUBuffer, cpu_buffer: Ndarray) => {
      this.device.queue.writeBuffer(gpu_buffer, 0, cpu_buffer.data, 0, cpu_buffer.data.length);
    };
    reset_buffer(this.e_field, this.setup.grid.init_e_field);
    reset_buffer(this.h_field, this.setup.grid.init_h_field);
    reset_buffer(this.bake_a0, this.setup.grid.bake_a0);
    reset_buffer(this.bake_a1, this.setup.grid.bake_a1);
    this.bake_b0 = this.setup.grid.bake_b0;
  }

  get size(): [number, number, number] {
    return this.setup.grid.size;
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
    const source_workgroup_size: [number, number, number] = [16,16,1];
    const grid_workgroup_size: [number, number, number] = [1,1,256];
    this.kernel_current_source = new KernelCurrentSource(source_workgroup_size, device);
    this.kernel_update_e_field = new KernelUpdateElectricField(grid_workgroup_size, device);
    this.kernel_update_h_field = new KernelUpdateMagneticField(grid_workgroup_size, device);
  }

  step_fdtd(grid: GpuGrid, timestep: number) {
    const command_encoder = this.device.createCommandEncoder();
    for (const source of grid.setup.sources) {
      if (timestep < source.signal.length) {
        const e0 = source.signal[timestep];
        this.kernel_current_source.create_pass(command_encoder, grid.e_field, e0, grid.size, source.offset, source.size);
      }
    }
    this.kernel_update_e_field.create_pass(command_encoder, grid.e_field, grid.h_field, grid.bake_a0, grid.bake_a1, grid.size);
    this.kernel_update_h_field.create_pass(command_encoder, grid.h_field, grid.e_field, grid.bake_b0, grid.size);
    this.device.queue.submit([command_encoder.finish()]);
  }
}
