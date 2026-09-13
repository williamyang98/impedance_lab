import { StructView } from "../../utility/cstyle_struct.ts";
import { CpuGrid } from "../../app/electrostatic_3d/grid.ts";
import { type Vec3 } from "../../utility/dim_types.ts";
import { NdGpuArray } from "../../renderers/common.ts";
import kernel_residual from "./kernel_residual.wgsl?raw";

type Size3D = Vec3<number>;

export class KernelCalculateResidual {
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
    this.label = "calculate_residual";
    this.workgroup_size = workgroup_size;

    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = kernel_residual;
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
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
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
    r: NdGpuArray, x: NdGpuArray, b: NdGpuArray, mask: NdGpuArray,
    dx: NdGpuArray, dy: NdGpuArray, dz: NdGpuArray,
    grid_size: Size3D,
  ) {
    function assert_buffer_size(buf: NdGpuArray, expected_size: number) {
      if (buf.data.size !== expected_size) {
        throw Error(`Got buffer with size ${buf.data.size} but expected ${expected_size} bytes`);
      }
    }
    const total_points = (grid_size.x+1)*(grid_size.y+1)*(grid_size.z+1);
    const sizeof_f32 = 4;
    const sizeof_u32 = 4;
    assert_buffer_size(r, total_points*sizeof_f32);
    assert_buffer_size(x, total_points*sizeof_f32);
    assert_buffer_size(b, total_points*sizeof_f32);
    assert_buffer_size(mask, Math.ceil(total_points/CpuGrid.total_mask_bits)*sizeof_u32);
    assert_buffer_size(dx, grid_size.x*sizeof_f32);
    assert_buffer_size(dy, grid_size.y*sizeof_f32);
    assert_buffer_size(dz, grid_size.z*sizeof_f32);

    const dispatch_size: Size3D = {
      x: Math.ceil((grid_size.x+1)/this.workgroup_size.x),
      y: Math.ceil((grid_size.y+1)/this.workgroup_size.y),
      z: Math.ceil((grid_size.z+1)/this.workgroup_size.z),
    };
    this.params.set("grid_size_x", grid_size.x);
    this.params.set("grid_size_y", grid_size.y);
    this.params.set("grid_size_z", grid_size.z);
    this.device.queue.writeBuffer(this.params_uniform, 0, this.params.buffer, 0, this.params.buffer.byteLength);

    function bind_buffer(binding: number, buf: GPUBuffer): GPUBindGroupEntry {
      return {
        binding,
        resource: { buffer: buf, offset: 0, size: buf.size },
      };
    }

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        bind_buffer(0, this.params_uniform),
        bind_buffer(1, r.data),
        bind_buffer(2, x.data),
        bind_buffer(3, b.data),
        bind_buffer(4, mask.data),
        bind_buffer(5, dx.data),
        bind_buffer(6, dy.data),
        bind_buffer(7, dz.data),
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size.x, dispatch_size.y, dispatch_size.z);
    compute_pass.end();
    return compute_pass;
  }
}
