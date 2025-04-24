import { StructView } from "../utility/cstyle_struct.ts";
import { Ndarray } from "../utility/ndarray.ts";

export class KernelCurrentSource {
  label: string;
  workgroup_size: [number, number, number];
  device: GPUDevice;
  params = new StructView({
    grid_size_x: "u32",
    grid_size_y: "u32",
    grid_size_z: "u32",
    source_offset_x: "u32",
    source_offset_y: "u32",
    source_offset_z: "u32",
    source_size_x: "u32",
    source_size_y: "u32",
    source_size_z: "u32",
    e0: "f32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "current_source";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        grid_size_x: u32,
        grid_size_y: u32,
        grid_size_z: u32,
        source_offset_x: u32,
        source_offset_y: u32,
        source_offset_z: u32,
        source_size_x: u32,
        source_size_y: u32,
        source_size_z: u32,
        e0: f32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> E: array<f32>;

      @compute
      @workgroup_size(${workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
          let _i = vec3<u32>(_j.z, _j.y, _j.x);
          if (_i.x >= params.source_size_x) { return; }
          if (_i.y >= params.source_size_y) { return; }
          if (_i.z >= params.source_size_z) { return; }

          let Nx = params.grid_size_x;
          let Ny = params.grid_size_y;
          let Nz = params.grid_size_z;
          let n_dims: u32 = u32(3);
          let Nzy = Nz*Ny;
          let ix = _i.x + params.source_offset_x;
          let iy = _i.y + params.source_offset_y;
          let iz = _i.z + params.source_offset_z;
          if (ix >= Nx) { return; }
          if (iy >= Ny) { return; }
          if (iz >= Nz) { return; }

          let i0 = iz + iy*Nz + ix*Nzy;
          let i = n_dims*i0;

          let ex = params.e0;
          E[i+0] += ex;
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_E: GPUBuffer, e0: number,
    grid_size: [number, number, number],
    source_offset: [number, number, number],
    source_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(source_size[0]/this.workgroup_size[0]),
      Math.ceil(source_size[1]/this.workgroup_size[1]),
      Math.ceil(source_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
    this.params.set("source_offset_x", source_offset[0]);
    this.params.set("source_offset_y", source_offset[1]);
    this.params.set("source_offset_z", source_offset[2]);
    this.params.set("source_size_x", source_size[0]);
    this.params.set("source_size_y", source_size[1]);
    this.params.set("source_size_z", source_size[2]);
    this.params.set("e0", e0);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size },
        },
        {
          binding: 1,
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateElectricField {
  label: string;
  workgroup_size: [number, number, number];
  device: GPUDevice;
  params = new StructView({
    grid_size_x: "u32",
    grid_size_y: "u32",
    grid_size_z: "u32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "update_e_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> E: array<f32>;
      @group(0) @binding(2) var<storage,read> H: array<f32>;
      @group(0) @binding(3) var<storage,read> A0: array<f32>;
      @group(0) @binding(4) var<storage,read> A1: array<f32>;
      // a0 = 1/(1+sigma_k/e_k*dt)
      // a1 = 1/(e_k*d_xyz) * dt

      @compute
      @workgroup_size(${this.workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
        let _i = vec3<u32>(_j.z, _j.y, _j.x);
        let Nx = params.size_x;
        let Ny = params.size_y;
        let Nz = params.size_z;
        let n_dims: u32 = u32(3);
        let Nzy = Nz*Ny;

        let ix = _i.x;
        let iy = _i.y;
        let iz = _i.z;
        if (ix >= Nx) { return; }
        if (iy >= Ny) { return; }
        if (iz >= Nz) { return; }

        let i0 = iz + iy*Nz + ix*Nzy;
        let i = n_dims*i0;

        // curl(H) with dirchlet boundary condition
        var dHz_dy = -H[i+2];
        var dHy_dz = -H[i+1];
        var dHx_dz = -H[i+0];
        var dHz_dx = -H[i+2];
        var dHy_dx = -H[i+1];
        var dHx_dy = -H[i+0];

        if (iz < (Nz-1)) {
          let dz = n_dims*((iz+1) + iy*Nz + ix*Nzy);
          dHy_dz += H[dz+1];
          dHx_dz += H[dz+0];
        }

        if (iy < (Ny-1)) {
          let dy = n_dims*(iz + (iy+1)*Nz + ix*Nzy);
          dHz_dy += H[dy+2];
          dHx_dy += H[dy+0];
        }

        if (ix < (Nx-1)) {
          let dx = n_dims*(iz + iy*Nz + (ix+1)*Nzy);
          dHz_dx += H[dx+2];
          dHy_dx += H[dx+1];
        }

        let cHx = dHz_dy-dHy_dz;
        let cHy = dHx_dz-dHz_dx;
        let cHz = dHy_dx-dHx_dy;

        let a0 = A0[i0];
        let a1 = A1[i0];

        E[i+0] = a0*(E[i+0] + a1*cHx);
        E[i+1] = a0*(E[i+1] + a1*cHy);
        E[i+2] = a0*(E[i+2] + a1*cHz);
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_E: GPUBuffer,
    gpu_H: GPUBuffer,
    gpu_A0: GPUBuffer,
    gpu_A1: GPUBuffer,
    grid_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(grid_size[0]/this.workgroup_size[0]),
      Math.ceil(grid_size[1]/this.workgroup_size[1]),
      Math.ceil(grid_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size },
        },
        {
          binding: 1,
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
        {
          binding: 2,
          resource: { buffer: gpu_H, offset: 0, size: gpu_H.size },
        },
        {
          binding: 3,
          resource: { buffer: gpu_A0, offset: 0, size: gpu_A0.size },
        },
        {
          binding: 4,
          resource: { buffer: gpu_A1, offset: 0, size: gpu_A1.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateMagneticField {
  label: string;
  workgroup_size: [number, number, number];
  device: GPUDevice;
  params = new StructView({
    grid_size_x: "u32",
    grid_size_y: "u32",
    grid_size_z: "u32",
    b0: "f32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "update_h_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
        // b0 = 1/(mu_k*d_xyz) * dt
        b0: f32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> H: array<f32>;
      @group(0) @binding(2) var<storage,read> E: array<f32>;

      @compute
      @workgroup_size(${this.workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
        let _i = vec3<u32>(_j.z, _j.y, _j.x);
        let Nx = params.size_x;
        let Ny = params.size_y;
        let Nz = params.size_z;
        let n_dims: u32 = u32(3);
        let Nzy = Nz*Ny;

        let ix = _i.x;
        let iy = _i.y;
        let iz = _i.z;
        if (ix >= Nx) { return; }
        if (iy >= Ny) { return; }
        if (iz >= Nz) { return; }

        let i0 = iz + iy*Nz + ix*Nzy;
        let i = n_dims*i0;

        var dEz_dy = E[i+2];
        var dEy_dz = E[i+1];
        var dEx_dz = E[i+0];
        var dEz_dx = E[i+2];
        var dEy_dx = E[i+1];
        var dEx_dy = E[i+0];

        if (iz > 0) {
          let dz = n_dims*((iz-1) + iy*Nz + ix*Nzy);
          dEy_dz -= E[dz+1];
          dEx_dz -= E[dz+0];
        }

        if (iy > 0) {
          let dy = n_dims*(iz + (iy-1)*Nz + ix*Nzy);
          dEz_dy -= E[dy+2];
          dEx_dy -= E[dy+0];
        }

        if (ix > 0) {
          let dx = n_dims*(iz + iy*Nz + (ix-1)*Nzy);
          dEz_dx -= E[dx+2];
          dEy_dx -= E[dx+1];
        }

        let cEx = dEz_dy-dEy_dz;
        let cEy = dEx_dz-dEz_dx;
        let cEz = dEy_dx-dEx_dy;

        let b0 = params.b0;
        H[i+0] = H[i+0] - b0*cEx;
        H[i+1] = H[i+1] - b0*cEy;
        H[i+2] = H[i+2] - b0*cEz;
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_H: GPUBuffer,
    gpu_E: GPUBuffer,
    gpu_b0: number,
    grid_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(grid_size[0]/this.workgroup_size[0]),
      Math.ceil(grid_size[1]/this.workgroup_size[1]),
      Math.ceil(grid_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
    this.params.set("b0", gpu_b0);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        {
          binding: 0,
          resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size },
        },
        {
          binding: 1,
          resource: { buffer: gpu_H, offset: 0, size: gpu_H.size },
        },
        {
          binding: 2,
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

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
