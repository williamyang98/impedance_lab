import { StructView } from "../../utility/cstyle_struct.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { type GpuFieldBuffers } from "./grid.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";
import kernel_update_h_field_wgsl from "./kernel_update_h_field.wgsl?raw";

type Size3D = Vec3<number>;

function create_ndgpuarray_bindgroup(buffer: NdGpuArray) {
  return { buffer: buffer.data, offset: 0, size: buffer.data.size };
}
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
    this.shader_source = kernel_update_h_field_wgsl;
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
