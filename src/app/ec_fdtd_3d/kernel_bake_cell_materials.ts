import * as cstruct from "../../utility/cstruct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_bake_RLC_wgsl from "./kernel_bake_RLC.wgsl?raw";
import kernel_bake_alpha_beta_wgsl from "./kernel_bake_alpha_beta.wgsl?raw";
import kernel_bake_phi_wgsl from "./kernel_bake_phi.wgsl?raw";
import { GpuGrid } from "./grid.ts";

type Size3D = Vec3<number>;

export const BakeRLCParams =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
    max_R: cstruct.primitive("f32"),
    max_L: cstruct.primitive("f32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 3),
  })
  .layout()
  .gpu_buffer();
export type BakeRLCParams = InstanceType<typeof BakeRLCParams>;

export class KernelBakeRLC {
  label: string;
  workgroup_size: Size3D;
  device: GPUDevice;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "kernel_bake_RLC";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.shader_source = kernel_bake_RLC_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dy
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // epsilon_r
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // sigma_k
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // mu_r
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Rx
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ry
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Rz
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Cx
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Cy
        { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Cz
        { binding: 13, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Lx
        { binding: 14, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ly
        { binding: 15, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Lz
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      label: this.label,
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
        constants: {
          workgroup_size_x: this.workgroup_size.x,
          workgroup_size_y: this.workgroup_size.y,
          workgroup_size_z: this.workgroup_size.z,
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    params: BakeRLCParams,
    d: Vec3<NdGpuArray>,
    R: Vec3<NdGpuArray>,
    C: Vec3<NdGpuArray>,
    L: Vec3<NdGpuArray>,
    epsilon_r: NdGpuArray,
    sigma_k: NdGpuArray,
    mu_r: NdGpuArray,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((params.view.grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((params.view.grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((params.view.grid_size.z+1)/this.workgroup_size.z),
    };

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(d.x.data) },
        { binding: 2, resource: bind_gpu_buffer(d.y.data) },
        { binding: 3, resource: bind_gpu_buffer(d.z.data) },
        { binding: 4, resource: bind_gpu_buffer(epsilon_r.data) },
        { binding: 5, resource: bind_gpu_buffer(sigma_k.data) },
        { binding: 6, resource: bind_gpu_buffer(mu_r.data) },
        { binding: 7, resource: bind_gpu_buffer(R.x.data) },
        { binding: 8, resource: bind_gpu_buffer(R.y.data) },
        { binding: 9, resource: bind_gpu_buffer(R.z.data) },
        { binding: 10, resource: bind_gpu_buffer(C.x.data) },
        { binding: 11, resource: bind_gpu_buffer(C.y.data) },
        { binding: 12, resource: bind_gpu_buffer(C.z.data) },
        { binding: 13, resource: bind_gpu_buffer(L.x.data) },
        { binding: 14, resource: bind_gpu_buffer(L.y.data) },
        { binding: 15, resource: bind_gpu_buffer(L.z.data) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
}

export const BakeAlphaBetaParams =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
    dt: cstruct.primitive("f32"),
    max_R: cstruct.primitive("f32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 3),
  })
  .layout()
  .gpu_buffer();
export type BakeAlphaBetaParams = InstanceType<typeof BakeAlphaBetaParams>;

export class KernelBakeAlphaBeta {
  label: string;
  workgroup_size: Size3D;
  device: GPUDevice;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "kernel_bake_alpha_beta";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.shader_source = kernel_bake_alpha_beta_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Rx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Ry
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Rz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Cx
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Cy
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Cz
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // alpha_x
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // alpha_y
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // alpha_z
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // beta_x
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // beta_y
        { binding: 12, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // beta_z
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      label: this.label,
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
        constants: {
          workgroup_size_x: this.workgroup_size.x,
          workgroup_size_y: this.workgroup_size.y,
          workgroup_size_z: this.workgroup_size.z,
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    params: BakeAlphaBetaParams,
    R: Vec3<NdGpuArray>,
    C: Vec3<NdGpuArray>,
    alpha: Vec3<NdGpuArray>,
    beta: Vec3<NdGpuArray>,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((params.view.grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((params.view.grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((params.view.grid_size.z+1)/this.workgroup_size.z),
    };

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(R.x.data) },
        { binding: 2, resource: bind_gpu_buffer(R.y.data) },
        { binding: 3, resource: bind_gpu_buffer(R.z.data) },
        { binding: 4, resource: bind_gpu_buffer(C.x.data) },
        { binding: 5, resource: bind_gpu_buffer(C.y.data) },
        { binding: 6, resource: bind_gpu_buffer(C.z.data) },
        { binding: 7, resource: bind_gpu_buffer(alpha.x.data) },
        { binding: 8, resource: bind_gpu_buffer(alpha.y.data) },
        { binding: 9, resource: bind_gpu_buffer(alpha.z.data) },
        { binding: 10, resource: bind_gpu_buffer(beta.x.data) },
        { binding: 11, resource: bind_gpu_buffer(beta.y.data) },
        { binding: 12, resource: bind_gpu_buffer(beta.z.data) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
}

export const BakePhiParams =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
    dt: cstruct.primitive("f32"),
    max_L: cstruct.primitive("f32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 3),
  })
  .layout()
  .gpu_buffer();
export type BakePhiParams = InstanceType<typeof BakePhiParams>;

export class KernelBakePhi {
  label: string;
  workgroup_size: Size3D;
  device: GPUDevice;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "kernel_bake_phi";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.shader_source = kernel_bake_phi_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Lx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ly
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Lz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // phi_x
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // phi_y
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // phi_z
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      label: this.label,
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
        constants: {
          workgroup_size_x: this.workgroup_size.x,
          workgroup_size_y: this.workgroup_size.y,
          workgroup_size_z: this.workgroup_size.z,
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    params: BakePhiParams,
    L: Vec3<NdGpuArray>,
    phi: Vec3<NdGpuArray>,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((params.view.grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((params.view.grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((params.view.grid_size.z+1)/this.workgroup_size.z),
    };

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(L.x.data) },
        { binding: 2, resource: bind_gpu_buffer(L.y.data) },
        { binding: 3, resource: bind_gpu_buffer(L.z.data) },
        { binding: 4, resource: bind_gpu_buffer(phi.x.data) },
        { binding: 5, resource: bind_gpu_buffer(phi.y.data) },
        { binding: 6, resource: bind_gpu_buffer(phi.z.data) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
}

export interface BakeCellMaterialsView {
  grid_size: Size3D;
  max_R: number;
  max_L: number;
  dt: number;
}

export class BakeCellMaterialsParams {
  device: GPUDevice;
  bake_RLC_params: BakeRLCParams;
  bake_alpha_beta_params: BakeAlphaBetaParams;
  bake_phi_params: BakePhiParams;
  readonly view: BakeCellMaterialsView;

  constructor(device: GPUDevice) {
    this.device = device;
    const bake_RLC_params = new BakeRLCParams(device);
    const bake_alpha_beta_params = new BakeAlphaBetaParams(device);
    const bake_phi_params = new BakePhiParams(device);
    this.bake_RLC_params = bake_RLC_params;
    this.bake_alpha_beta_params = bake_alpha_beta_params;
    this.bake_phi_params = bake_phi_params;

    this.view = {
      grid_size: {
        set x(grid_size_x: number) {
          bake_RLC_params.view.grid_size.x = grid_size_x;
          bake_alpha_beta_params.view.grid_size.x = grid_size_x;
          bake_phi_params.view.grid_size.x = grid_size_x;
        },
        get x(): number {
          return bake_RLC_params.view.grid_size.x;
        },
        set y(grid_size_y: number) {
          bake_RLC_params.view.grid_size.y = grid_size_y;
          bake_alpha_beta_params.view.grid_size.y = grid_size_y;
          bake_phi_params.view.grid_size.y = grid_size_y;
        },
        get y(): number {
          return bake_RLC_params.view.grid_size.y;
        },
        set z(grid_size_z: number) {
          bake_RLC_params.view.grid_size.z = grid_size_z;
          bake_alpha_beta_params.view.grid_size.z = grid_size_z;
          bake_phi_params.view.grid_size.z = grid_size_z;
        },
        get z(): number {
          return bake_RLC_params.view.grid_size.z;
        },
      },
      set max_R(max_R: number) {
        bake_RLC_params.view.max_R = max_R;
        bake_alpha_beta_params.view.max_R = max_R;
      },
      get max_R(): number {
        return bake_RLC_params.view.max_R;
      },
      set max_L(max_L: number) {
        bake_RLC_params.view.max_L = max_L;
        bake_phi_params.view.max_L = max_L;
      },
      get max_L(): number {
        return bake_RLC_params.view.max_L;
      },
      set dt(dt: number) {
        bake_alpha_beta_params.view.dt = dt;
        bake_phi_params.view.dt = dt;
      },
      get dt(): number {
        return bake_alpha_beta_params.view.dt;
      },
    };
  }

  write_to_gpu() {
    this.bake_RLC_params.write_to_gpu();
    this.bake_alpha_beta_params.write_to_gpu();
    this.bake_phi_params.write_to_gpu();
  }
}

export class KernelBakeCellMaterials {
  label: string;
  device: GPUDevice;
  workgroup_size: Size3D;
  kernel_bake_RLC: KernelBakeRLC;
  kernel_bake_alpha_beta: KernelBakeAlphaBeta;
  kernel_bake_phi: KernelBakePhi;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "kernel_bake_cell_materials";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.kernel_bake_RLC = new KernelBakeRLC(workgroup_size, device);
    this.kernel_bake_alpha_beta = new KernelBakeAlphaBeta(workgroup_size, device);
    this.kernel_bake_phi = new KernelBakePhi(workgroup_size, device);
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    params: BakeCellMaterialsParams,
    grid: GpuGrid,
  ) {
    this.kernel_bake_RLC.create_pass(
      command_encoder,
      params.bake_RLC_params,
      grid.d,
      grid.bake_R, grid.bake_C, grid.bake_L,
      grid.epsilon_r, grid.sigma_k, grid.mu_r,
    );
    this.kernel_bake_alpha_beta.create_pass(
      command_encoder,
      params.bake_alpha_beta_params,
      grid.bake_R, grid.bake_C,
      grid.bake_alpha, grid.bake_beta,
    );
    this.kernel_bake_phi.create_pass(
      command_encoder,
      params.bake_phi_params,
      grid.bake_L,
      grid.bake_phi,
    );
  }
}
