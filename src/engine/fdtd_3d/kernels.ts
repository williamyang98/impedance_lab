import { StructView } from "../../utility/cstyle_struct.ts";
import shader_current_source_wgsl from "./shader_current_source.wgsl?raw";
import shader_update_e_field_wgsl from "./shader_update_e_field.wgsl?raw";
import shader_update_h_field_wgsl from "./shader_update_h_field.wgsl?raw";

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
    this.shader_source = shader_current_source_wgsl;
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
        constants: {
          workgroup_size_x: this.workgroup_size[2],
          workgroup_size_y: this.workgroup_size[1],
          workgroup_size_z: this.workgroup_size[0],
        },
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
    this.shader_source = shader_update_e_field_wgsl;
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
        constants: {
          workgroup_size_x: this.workgroup_size[2],
          workgroup_size_y: this.workgroup_size[1],
          workgroup_size_z: this.workgroup_size[0],
        },
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
    this.shader_source = shader_update_h_field_wgsl;
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
        constants: {
          workgroup_size_x: this.workgroup_size[2],
          workgroup_size_y: this.workgroup_size[1],
          workgroup_size_z: this.workgroup_size[0],
        },
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
