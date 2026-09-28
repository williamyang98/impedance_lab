import * as cstruct from "../../utility/cstruct.ts";
import { type Axis3D, type Vec3 } from "../../utility/dim_types.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_apply_current_source_wgsl from "./kernel_apply_current_source.wgsl?raw";

type Size3D = Vec3<number>;

const Params =
  cstruct.struct({
    data_size: cstruct.vector(cstruct.primitive("u32"), 3), // 12 bytes
    source_offset: cstruct.vector(cstruct.primitive("u32"), 3), // 24 bytes
    source_size: cstruct.vector(cstruct.primitive("u32"), 3), // 36 bytes
    i_source: cstruct.primitive("f32"), // 40 bytes
    _pad_0: cstruct.primitive("u32"),
    _pad_1: cstruct.primitive("u32"), // 48 bytes
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class KernelApplyCurrentSource {
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
    this.shader_source = kernel_apply_current_source_wgsl;
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
    V: Vec3<NdGpuArray>,
    beta: Vec3<NdGpuArray>,
    i_source: number,
    axis: Axis3D,
    grid_size: Size3D,
    source_offset: Size3D,
    source_size: Size3D,
  ) {
    const V_axis = V[axis];
    const beta_axis = beta[axis];

    const dispatch_size: Size3D = {
      x: Math.ceil((source_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((source_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((source_size.z+1)/this.workgroup_size.z),
    };
    this.params.view.data_size.x = V_axis.shape[2];
    this.params.view.data_size.y = V_axis.shape[1];
    this.params.view.data_size.z = V_axis.shape[0];
    this.params.view.source_offset.x = source_offset.x;
    this.params.view.source_offset.y = source_offset.y;
    this.params.view.source_offset.z = source_offset.z;
    this.params.view.source_size.x = source_size.x;
    this.params.view.source_size.y = source_size.y;
    this.params.view.source_size.z = source_size.z;
    this.params.view.i_source = i_source;
    this.params.write_to_gpu();

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(V_axis.data) },
        { binding: 2, resource: bind_gpu_buffer(beta_axis.data) },
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
