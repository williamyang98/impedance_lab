import * as cstruct from "../../utility/cstruct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { type GpuFieldBuffers } from "./grid.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_update_e_field_wgsl from "./kernel_update_e_field.wgsl?raw";

type Size3D = Vec3<number>;

const Params =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class KernelUpdateElectricField {
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
    this.label = "update_e_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params = new Params(device);
    this.shader_source = kernel_update_e_field_wgsl;
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
    this.params.view.grid_size.x = grid_size.x;
    this.params.view.grid_size.y = grid_size.y;
    this.params.view.grid_size.z = grid_size.z;
    this.params.write_to_gpu();

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(d.x.data) },
        { binding: 2, resource: bind_gpu_buffer(d.y.data) },
        { binding: 3, resource: bind_gpu_buffer(d.z.data) },
        { binding: 4, resource: bind_gpu_buffer(E.x.data) },
        { binding: 5, resource: bind_gpu_buffer(E.y.data) },
        { binding: 6, resource: bind_gpu_buffer(E.z.data) },
        { binding: 7, resource: bind_gpu_buffer(H.x.data) },
        { binding: 8, resource: bind_gpu_buffer(H.y.data) },
        { binding: 9, resource: bind_gpu_buffer(H.z.data) },
        { binding: 10, resource: bind_gpu_buffer(bake_alpha.data) },
        { binding: 11, resource: bind_gpu_buffer(bake_beta.data) },
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
