import { StructView } from "../../utility/cstyle_struct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { type GpuFieldBuffers } from "./grid.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_current_source_wgsl from "./kernel_current_source.wgsl?raw";

type Size3D = Vec3<number>;

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
    this.shader_source = kernel_current_source_wgsl;
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
