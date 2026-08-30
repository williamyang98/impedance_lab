import { StructView } from "../../utility/cstyle_struct.ts";
import type { NdarrayType } from "../../utility/ndarray.ts";
import compute_current_source_wgsl from "./compute_current_source.wgsl?raw";
import compute_update_e_field_wgsl from "./compute_update_e_field.wgsl?raw";
import compute_update_h_field_wgsl from "./compute_update_h_field.wgsl?raw";

export interface Size3D {
  x: number;
  y: number;
  z: number;
}

export interface NdGpuArray {
  data: GPUBuffer;
  dtype: NdarrayType;
  shape: number[];
}

export interface GpuFieldBuffers {
  x: NdGpuArray;
  y: NdGpuArray;
  z: NdGpuArray;
}

function create_ndgpuarray_bindgroup(buffer: NdGpuArray) {
  return { buffer: buffer.data, offset: 0, size: buffer.data.size };
}

export class KernelCurrentSource {
  label: string;
  workgroup_size: Size3D;
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

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "current_source";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_current_source_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
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
    E: GpuFieldBuffers, e0: number,
    grid_size: Size3D,
    source_offset: Size3D,
    source_size: Size3D,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((source_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((source_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((source_size.z+1)/this.workgroup_size.z),
    };
    this.params.set("grid_size_x", grid_size.x);
    this.params.set("grid_size_y", grid_size.y);
    this.params.set("grid_size_z", grid_size.z);
    this.params.set("source_offset_x", source_offset.x);
    this.params.set("source_offset_y", source_offset.y);
    this.params.set("source_offset_z", source_offset.z);
    this.params.set("source_size_x", source_size.x);
    this.params.set("source_size_y", source_size.y);
    this.params.set("source_size_z", source_size.z);
    this.params.set("e0", e0);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size } },
        { binding: 1, resource: create_ndgpuarray_bindgroup(E.x) },
        { binding: 2, resource: create_ndgpuarray_bindgroup(E.y) },
        { binding: 3, resource: create_ndgpuarray_bindgroup(E.z) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateElectricField {
  label: string;
  workgroup_size: Size3D;
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

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "update_e_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_update_e_field_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dy
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ex
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ey
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ez
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Hx
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Hy
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Hz
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // alpha
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // beta
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
    d: GpuFieldBuffers,
    E: GpuFieldBuffers,
    H: GpuFieldBuffers,
    bake_alpha: NdGpuArray,
    bake_beta: NdGpuArray,
    grid_size: Size3D,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((grid_size.z+1)/this.workgroup_size.z),
    };
    this.params.set("grid_size_x", grid_size.x);
    this.params.set("grid_size_y", grid_size.y);
    this.params.set("grid_size_z", grid_size.z);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size } },
        { binding: 1, resource: create_ndgpuarray_bindgroup(d.x) },
        { binding: 2, resource: create_ndgpuarray_bindgroup(d.y) },
        { binding: 3, resource: create_ndgpuarray_bindgroup(d.z) },
        { binding: 4, resource: create_ndgpuarray_bindgroup(E.x) },
        { binding: 5, resource: create_ndgpuarray_bindgroup(E.y) },
        { binding: 6, resource: create_ndgpuarray_bindgroup(E.z) },
        { binding: 7, resource: create_ndgpuarray_bindgroup(H.x) },
        { binding: 8, resource: create_ndgpuarray_bindgroup(H.y) },
        { binding: 9, resource: create_ndgpuarray_bindgroup(H.z) },
        { binding: 10, resource: create_ndgpuarray_bindgroup(bake_alpha) },
        { binding: 11, resource: create_ndgpuarray_bindgroup(bake_beta) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateMagneticField {
  label: string;
  workgroup_size: Size3D;
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

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "update_h_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_update_h_field_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dy
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // dz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Hx
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Hy
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Hz
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Ex
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Ey
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Ez
        { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // bake_phi
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
    d: GpuFieldBuffers,
    H: GpuFieldBuffers,
    E: GpuFieldBuffers,
    bake_phi: NdGpuArray,
    grid_size: Size3D,
  ) {
    const dispatch_size: Size3D = {
      x: Math.ceil((grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((grid_size.z+1)/this.workgroup_size.z),
    };
    this.params.set("grid_size_x", grid_size.x);
    this.params.set("grid_size_y", grid_size.y);
    this.params.set("grid_size_z", grid_size.z);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size } },
        { binding: 1, resource: create_ndgpuarray_bindgroup(d.x) },
        { binding: 2, resource: create_ndgpuarray_bindgroup(d.y) },
        { binding: 3, resource: create_ndgpuarray_bindgroup(d.z) },
        { binding: 4, resource: create_ndgpuarray_bindgroup(H.x) },
        { binding: 5, resource: create_ndgpuarray_bindgroup(H.y) },
        { binding: 6, resource: create_ndgpuarray_bindgroup(H.z) },
        { binding: 7, resource: create_ndgpuarray_bindgroup(E.x) },
        { binding: 8, resource: create_ndgpuarray_bindgroup(E.y) },
        { binding: 9, resource: create_ndgpuarray_bindgroup(E.z) },
        { binding: 10, resource: create_ndgpuarray_bindgroup(bake_phi) },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
};
