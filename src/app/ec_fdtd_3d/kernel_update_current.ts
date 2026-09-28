import * as cstruct from "../../utility/cstruct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_update_current_wgsl from "./kernel_update_current.wgsl?raw";

type Size3D = Vec3<number>;

const Params =
  cstruct.struct({
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class KernelUpdateCurrent {
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
    this.label = "update_current";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params = new Params(device);
    this.shader_source = kernel_update_current_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Ix
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Iy
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // Iz
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Vx
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Vy
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // Vz
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // bake_phi_x
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // bake_phi_y
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // bake_phi_z
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
    I: Vec3<NdGpuArray>,
    V: Vec3<NdGpuArray>,
    bake_phi: Vec3<NdGpuArray>,
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
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(I.x.data) },
        { binding: 2, resource: bind_gpu_buffer(I.y.data) },
        { binding: 3, resource: bind_gpu_buffer(I.z.data) },
        { binding: 4, resource: bind_gpu_buffer(V.x.data) },
        { binding: 5, resource: bind_gpu_buffer(V.y.data) },
        { binding: 6, resource: bind_gpu_buffer(V.z.data) },
        { binding: 7, resource: bind_gpu_buffer(bake_phi.x.data) },
        { binding: 8, resource: bind_gpu_buffer(bake_phi.y.data) },
        { binding: 9, resource: bind_gpu_buffer(bake_phi.z.data) },
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
