import * as cstruct from "../../utility/cstruct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { type GpuFieldBuffers } from "./grid.ts";
import kernel_current_source_wgsl from "./kernel_current_source.wgsl?raw";

type Size3D = Vec3<number>;
const Params =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
    source_offset: cstruct.vector(cstruct.primitive("u32"), 3),
    source_size: cstruct.vector(cstruct.primitive("u32"), 3),
    e0: cstruct.primitive("f32"),
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class KernelCurrentSource {
  label: string;
  workgroup_size: Size3D;
  device: GPUDevice;
  params: Params;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "current_source";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params = new Params(device);
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
    this.params.view.grid_size.x = grid_size.x;
    this.params.view.grid_size.y = grid_size.y;
    this.params.view.grid_size.z = grid_size.z;
    this.params.view.source_offset.x = source_offset.x;
    this.params.view.source_offset.y = source_offset.y;
    this.params.view.source_offset.z = source_offset.z;
    this.params.view.source_size.x = source_size.x;
    this.params.view.source_size.y = source_size.y;
    this.params.view.source_size.z = source_size.z;
    this.params.view.e0 = e0;
    this.params.write_to_gpu();

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(E.x.data) },
        { binding: 2, resource: bind_gpu_buffer(E.y.data) },
        { binding: 3, resource: bind_gpu_buffer(E.z.data) },
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
