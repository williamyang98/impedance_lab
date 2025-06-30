import { StructView } from "../../utility/cstyle_struct.ts";
import compute_copy_slice_wgsl from "./compute_copy_slice.wgsl?raw";

export class ComputeCopyToTexture {
  label: string;
  workgroup_size: [number, number];
  device: GPUDevice;
  params = new StructView({
    size_x: "u32",
    size_y: "u32",
    size_z: "u32",
    copy_x: "u32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: [number, number], device: GPUDevice) {
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
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: "write-only",
            format: "rgba16float",
            viewDimension: "2d",
          },
        },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
        constants: {
          workgroup_size_x: this.workgroup_size[0],
          workgroup_size_y: this.workgroup_size[1],
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_grid: GPUBuffer,
    gpu_texture_view: GPUTextureView,
    grid_size: [number, number, number],
    copy_x: number,
  ) {
    const dispatch_size: [number, number] = [
      Math.ceil(grid_size[1]/this.workgroup_size[0]),
      Math.ceil(grid_size[2]/this.workgroup_size[1]),
    ];
    this.params.set("size_x", grid_size[0]);
    this.params.set("size_y", grid_size[1]);
    this.params.set("size_z", grid_size[2]);
    this.params.set("copy_x", copy_x);
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
          resource: { buffer: gpu_grid, offset: 0, size: gpu_grid.size },
        },
        {
          binding: 2,
          resource: gpu_texture_view,
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[0], dispatch_size[1]);
    compute_pass.end();
    return compute_pass;
  }
}
