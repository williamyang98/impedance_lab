import { StructView } from "../../utility/cstyle_struct.ts";
import compute_jacobi_smooth from "./compute_jacobi_smooth.wgsl?raw";
import compute_residual from "./compute_residual.wgsl?raw";
import compute_copy_slice from "./compute_copy_slice.wgsl?raw";
import { CpuGrid } from "../../app/electrostatic_3d/grid.ts";

export interface Size3D {
  x: number;
  y: number;
  z: number;
}

export class KernelJacobiSmooth {
  label: string;
  workgroup_size: Size3D;
  device: GPUDevice;
  params = new StructView({
    grid_size_x: "u32",
    grid_size_y: "u32",
    grid_size_z: "u32",
    beta: "f32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: Size3D, device: GPUDevice) {
    this.label = "jacobi_smooth";
    this.workgroup_size = workgroup_size;

    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_jacobi_smooth;
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
    xout: GPUBuffer, xin: GPUBuffer, b: GPUBuffer, mask: GPUBuffer,
    dx: GPUBuffer, dy: GPUBuffer, dz: GPUBuffer,
    grid_size: Size3D,
    beta: number,
  ) {
    function assert_buffer_size(buf: GPUBuffer, expected_size: number) {
      if (buf.size !== expected_size) {
        throw Error(`Got buffer with size ${buf.size} but expected ${expected_size} bytes`);
      }
    }
    const total_points = (grid_size.x+1)*(grid_size.y+1)*(grid_size.z+1);
    const sizeof_f32 = 4;
    const sizeof_u32 = 4;
    assert_buffer_size(xout, total_points*sizeof_f32);
    assert_buffer_size(xin, total_points*sizeof_f32);
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
    this.params.set("beta", beta);
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
        bind_buffer(1, xout),
        bind_buffer(2, xin),
        bind_buffer(3, b),
        bind_buffer(4, mask),
        bind_buffer(5, dx),
        bind_buffer(6, dy),
        bind_buffer(7, dz),
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
    this.shader_source = compute_residual;
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
    r: GPUBuffer, x: GPUBuffer, b: GPUBuffer, mask: GPUBuffer,
    dx: GPUBuffer, dy: GPUBuffer, dz: GPUBuffer,
    grid_size: Size3D,
  ) {
    function assert_buffer_size(buf: GPUBuffer, expected_size: number) {
      if (buf.size !== expected_size) {
        throw Error(`Got buffer with size ${buf.size} but expected ${expected_size} bytes`);
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
        bind_buffer(1, r),
        bind_buffer(2, x),
        bind_buffer(3, b),
        bind_buffer(4, mask),
        bind_buffer(5, dx),
        bind_buffer(6, dy),
        bind_buffer(7, dz),
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

export interface Size2D {
  x: number;
  y: number;
}

export class ComputeCopySliceToTexture {
  label: string;
  workgroup_size: Size2D;
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

  constructor(workgroup_size: Size2D, device: GPUDevice) {
    this.label = "copy_slice_to_texture";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = compute_copy_slice;
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
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 4,
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
          workgroup_size_x: this.workgroup_size.x,
          workgroup_size_y: this.workgroup_size.y,
        },
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    x_buf: GPUBuffer, r_buf: GPUBuffer, b_buf: GPUBuffer,
    gpu_texture_view: GPUTextureView,
    grid_size: Size3D,
    copy_z: number,
  ) {
    const dispatch_size: Size2D = {
      x: Math.ceil(grid_size.x/this.workgroup_size.x),
      y: Math.ceil(grid_size.y/this.workgroup_size.y),
    };
    this.params.set("size_x", grid_size.x);
    this.params.set("size_y", grid_size.y);
    this.params.set("size_z", grid_size.z);
    this.params.set("copy_z", copy_z);
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
          resource: { buffer: x_buf, offset: 0, size: x_buf.size },
        },
        {
          binding: 2,
          resource: { buffer: r_buf, offset: 0, size: r_buf.size },
        },
        {
          binding: 3,
          resource: { buffer: b_buf, offset: 0, size: b_buf.size },
        },
        {
          binding: 4,
          resource: gpu_texture_view,
        },
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
