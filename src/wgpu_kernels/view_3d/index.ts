import { StructView } from "../../utility/cstyle_struct.ts";
import { type NdGpuArray } from "../fdtd_3d/index.ts";
import compute_copy_slice_wgsl from "./compute_copy_slice.wgsl?raw";

export class ComputeCopyToTexture {
  label: string;
  workgroup_size: {
    x: number;
    y: number;
  };
  device: GPUDevice;
  params = new StructView({
    size_x: "u32",
    size_y: "u32",
    size_z: "u32",
    copy_z: "u32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: { x: number, y: number }, device: GPUDevice) {
    this.label = "copy_to_texture";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_copy_slice_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "r32float", viewDimension: "2d" },
        },
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
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_buffer: NdGpuArray,
    gpu_texture_view: GPUTextureView,
    copy_z: number,
  ) {
    if (gpu_buffer.shape.length !== 3) {
      throw Error(`Expected a 3 dimensional NdGpuArray but got shape=${gpu_buffer.shape.join(',')}`);
    }
    if (gpu_buffer.dtype !== "f32") {
      throw Error(`Expected a f32 NdGpuArray but got dtype=${gpu_buffer.dtype}`);
    }
    const size = {
      z: gpu_buffer.shape[0],
      y: gpu_buffer.shape[1],
      x: gpu_buffer.shape[2],
    };
    const dispatch_size = {
      x: Math.ceil(size.x/this.workgroup_size.x),
      y: Math.ceil(size.y/this.workgroup_size.y),
    };
    this.params.set("size_x", size.x);
    this.params.set("size_y", size.y);
    this.params.set("size_z", size.z);
    this.params.set("copy_z", copy_z);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    const bind_group = this.device.createBindGroup({
      label: `${this.label}:bind_group`,
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: { buffer: this.params_uniform, offset: 0, size: this.params_uniform.size } },
        { binding: 1, resource: { buffer: gpu_buffer.data, offset: 0, size: gpu_buffer.data.size } },
        { binding: 2, resource: gpu_texture_view },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y);
    compute_pass.end();
    return compute_pass;
  }
}
