import { StructView } from "./cstyle_struct.ts";

export class KernelCurrentSource {
  label: string;
  workgroup_size: [number, number, number];
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

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "current_source";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        grid_size_x: u32,
        grid_size_y: u32,
        grid_size_z: u32,
        source_offset_x: u32,
        source_offset_y: u32,
        source_offset_z: u32,
        source_size_x: u32,
        source_size_y: u32,
        source_size_z: u32,
        e0: f32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> E: array<f32>;

      @compute
      @workgroup_size(${workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
          let _i = vec3<u32>(_j.z, _j.y, _j.x);
          if (_i.x >= params.source_size_x) { return; }
          if (_i.y >= params.source_size_y) { return; }
          if (_i.z >= params.source_size_z) { return; }

          let Nx = params.grid_size_x;
          let Ny = params.grid_size_y;
          let Nz = params.grid_size_z;
          let n_dims: u32 = u32(3);
          let Nzy = Nz*Ny;
          let ix = _i.x + params.source_offset_x;
          let iy = _i.y + params.source_offset_y;
          let iz = _i.z + params.source_offset_z;
          if (ix >= Nx) { return; }
          if (iy >= Ny) { return; }
          if (iz >= Nz) { return; }

          let i0 = iz + iy*Nz + ix*Nzy;
          let i = n_dims*i0;

          let ex = params.e0;
          E[i+0] += ex;
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_E: GPUBuffer, e0: number,
    grid_size: [number, number, number],
    source_offset: [number, number, number],
    source_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(source_size[0]/this.workgroup_size[0]),
      Math.ceil(source_size[1]/this.workgroup_size[1]),
      Math.ceil(source_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
    this.params.set("source_offset_x", source_offset[0]);
    this.params.set("source_offset_y", source_offset[1]);
    this.params.set("source_offset_z", source_offset[2]);
    this.params.set("source_size_x", source_size[0]);
    this.params.set("source_size_y", source_size[1]);
    this.params.set("source_size_z", source_size[2]);
    this.params.set("e0", e0);
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
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateElectricField {
  label: string;
  workgroup_size: [number, number, number];
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

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "update_e_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> E: array<f32>;
      @group(0) @binding(2) var<storage,read> H: array<f32>;
      @group(0) @binding(3) var<storage,read> A0: array<f32>;
      @group(0) @binding(4) var<storage,read> A1: array<f32>;
      // a0 = 1/(1+sigma_k/e_k*dt)
      // a1 = 1/(e_k*d_xyz) * dt

      @compute
      @workgroup_size(${this.workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
        let _i = vec3<u32>(_j.z, _j.y, _j.x);
        let Nx = params.size_x;
        let Ny = params.size_y;
        let Nz = params.size_z;
        let n_dims: u32 = u32(3);
        let Nzy = Nz*Ny;

        let ix = _i.x;
        let iy = _i.y;
        let iz = _i.z;
        if (ix >= Nx) { return; }
        if (iy >= Ny) { return; }
        if (iz >= Nz) { return; }

        let i0 = iz + iy*Nz + ix*Nzy;
        let i = n_dims*i0;

        // curl(H) with dirchlet boundary condition
        var dHz_dy = -H[i+2];
        var dHy_dz = -H[i+1];
        var dHx_dz = -H[i+0];
        var dHz_dx = -H[i+2];
        var dHy_dx = -H[i+1];
        var dHx_dy = -H[i+0];

        if (iz < (Nz-1)) {
          let dz = n_dims*((iz+1) + iy*Nz + ix*Nzy);
          dHy_dz += H[dz+1];
          dHx_dz += H[dz+0];
        }

        if (iy < (Ny-1)) {
          let dy = n_dims*(iz + (iy+1)*Nz + ix*Nzy);
          dHz_dy += H[dy+2];
          dHx_dy += H[dy+0];
        }

        if (ix < (Nx-1)) {
          let dx = n_dims*(iz + iy*Nz + (ix+1)*Nzy);
          dHz_dx += H[dx+2];
          dHy_dx += H[dx+1];
        }

        let cHx = dHz_dy-dHy_dz;
        let cHy = dHx_dz-dHz_dx;
        let cHz = dHy_dx-dHx_dy;

        let a0 = A0[i0];
        let a1 = A1[i0];

        E[i+0] = a0*(E[i+0] + a1*cHx);
        E[i+1] = a0*(E[i+1] + a1*cHy);
        E[i+2] = a0*(E[i+2] + a1*cHz);
      }
    `;
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
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({ bindGroupLayouts: [this.bind_group_layout] });
    this.compute_pipeline = device.createComputePipeline({
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_E: GPUBuffer,
    gpu_H: GPUBuffer,
    gpu_A0: GPUBuffer,
    gpu_A1: GPUBuffer,
    grid_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(grid_size[0]/this.workgroup_size[0]),
      Math.ceil(grid_size[1]/this.workgroup_size[1]),
      Math.ceil(grid_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
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
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
        {
          binding: 2,
          resource: { buffer: gpu_H, offset: 0, size: gpu_H.size },
        },
        {
          binding: 3,
          resource: { buffer: gpu_A0, offset: 0, size: gpu_A0.size },
        },
        {
          binding: 4,
          resource: { buffer: gpu_A1, offset: 0, size: gpu_A1.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelUpdateMagneticField {
  label: string;
  workgroup_size: [number, number, number];
  device: GPUDevice;
  params = new StructView({
    grid_size_x: "u32",
    grid_size_y: "u32",
    grid_size_z: "u32",
    b0: "f32",
  });
  params_uniform: GPUBuffer;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  compute_pipeline: GPUComputePipeline;

  constructor(workgroup_size: [number, number, number], device: GPUDevice) {
    this.label = "update_h_field";
    this.workgroup_size = workgroup_size;
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
        // b0 = 1/(mu_k*d_xyz) * dt
        b0: f32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage,read_write> H: array<f32>;
      @group(0) @binding(2) var<storage,read> E: array<f32>;

      @compute
      @workgroup_size(${this.workgroup_size.slice().reverse().join(",")})
      fn main(@builtin(global_invocation_id) _j: vec3<u32>) {
        let _i = vec3<u32>(_j.z, _j.y, _j.x);
        let Nx = params.size_x;
        let Ny = params.size_y;
        let Nz = params.size_z;
        let n_dims: u32 = u32(3);
        let Nzy = Nz*Ny;

        let ix = _i.x;
        let iy = _i.y;
        let iz = _i.z;
        if (ix >= Nx) { return; }
        if (iy >= Ny) { return; }
        if (iz >= Nz) { return; }

        let i0 = iz + iy*Nz + ix*Nzy;
        let i = n_dims*i0;

        var dEz_dy = E[i+2];
        var dEy_dz = E[i+1];
        var dEx_dz = E[i+0];
        var dEz_dx = E[i+2];
        var dEy_dx = E[i+1];
        var dEx_dy = E[i+0];

        if (iz > 0) {
          let dz = n_dims*((iz-1) + iy*Nz + ix*Nzy);
          dEy_dz -= E[dz+1];
          dEx_dz -= E[dz+0];
        }

        if (iy > 0) {
          let dy = n_dims*(iz + (iy-1)*Nz + ix*Nzy);
          dEz_dy -= E[dy+2];
          dEx_dy -= E[dy+0];
        }

        if (ix > 0) {
          let dx = n_dims*(iz + iy*Nz + (ix-1)*Nzy);
          dEz_dx -= E[dx+2];
          dEy_dx -= E[dx+1];
        }

        let cEx = dEz_dy-dEy_dz;
        let cEy = dEx_dz-dEz_dx;
        let cEz = dEy_dx-dEx_dy;

        let b0 = params.b0;
        H[i+0] = H[i+0] - b0*cEx;
        H[i+1] = H[i+1] - b0*cEy;
        H[i+2] = H[i+2] - b0*cEz;
      }
    `;
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
      layout: this.pipeline_layout,
      compute: {
        module: this.shader_module,
        entryPoint: "main",
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_H: GPUBuffer,
    gpu_E: GPUBuffer,
    gpu_b0: number,
    grid_size: [number, number, number],
  ) {
    const dispatch_size: [number, number, number] = [
      Math.ceil(grid_size[0]/this.workgroup_size[0]),
      Math.ceil(grid_size[1]/this.workgroup_size[1]),
      Math.ceil(grid_size[2]/this.workgroup_size[2]),
    ];
    this.params.set("grid_size_x", grid_size[0]);
    this.params.set("grid_size_y", grid_size[1]);
    this.params.set("grid_size_z", grid_size[2]);
    this.params.set("b0", gpu_b0);
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
          resource: { buffer: gpu_H, offset: 0, size: gpu_H.size },
        },
        {
          binding: 2,
          resource: { buffer: gpu_E, offset: 0, size: gpu_E.size },
        },
      ],
    });

    const compute_pass = command_encoder.beginComputePass();
    compute_pass.setPipeline(this.compute_pipeline);
    compute_pass.setBindGroup(0, bind_group);
    compute_pass.dispatchWorkgroups(dispatch_size[2], dispatch_size[1], dispatch_size[0]);
    compute_pass.end();
    return compute_pass;
  }
};

export class KernelCopyToTexture {
  label: string;
  workgroup_size: [number, number];
  device: GPUDevice;
  params = new StructView({
    size_x: "u32",
    size_y: "u32",
    size_z: "u32",
    copy_x: "u32",
    scale: "f32",
    axis: "u32",
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
    this.shader_source = `
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
        copy_x: u32,
        scale: f32,
        axis: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage, read> grid: array<f32>;
      @group(0) @binding(2) var grid_tex: texture_storage_2d<rgba8unorm, write>;

      @compute
      @workgroup_size(${this.workgroup_size.join(",")})
      fn main(@builtin(global_invocation_id) _i: vec3<u32>) {
        let width = textureDimensions(grid_tex).x;
        let height = textureDimensions(grid_tex).y;
        let iy = _i.x;
        let iz = _i.y;
        if (iz >= width) { return; }
        if (iy >= height) { return; }

        let Nx = params.size_x;
        let Ny = params.size_y;
        let Nz = params.size_z;
        let Nzy = Ny*Nz;
        let src_x = params.copy_x;

        let n_dims = u32(3);
        let src_i = n_dims*(src_x*Nzy + iy*Nz + iz);
        let dst_i = vec2<u32>(u32(iz), u32(iy));

        if (params.axis <= 2) {
          let E: f32 = grid[src_i+params.axis];
          let v: f32 = E*params.scale;
          let colour = vec4<f32>(max(-v, 0.0),max(v, 0.0),0.0,1.0);
          textureStore(grid_tex, dst_i, colour);
        } else {
          let Ex: f32 = grid[src_i+0];
          let Ey: f32 = grid[src_i+1];
          let Ez: f32 = grid[src_i+2];
          let E: vec3<f32> = vec3<f32>(Ex,Ey,Ez);
          let E_mag = length(E);
          let v = E_mag*params.scale;
          let colour = vec4<f32>(v,v,v,1.0);
          textureStore(grid_tex, dst_i, colour);
        }
      }
    `;
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
            format: "rgba8unorm",
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
      },
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    gpu_grid: GPUBuffer,
    gpu_texture_view: GPUTextureView,
    grid_size: [number, number, number],
    copy_x: number, scale: number, axis: number) {
    const dispatch_size: [number, number] = [
      Math.ceil(grid_size[1]/this.workgroup_size[0]),
      Math.ceil(grid_size[2]/this.workgroup_size[1]),
    ];
    this.params.set("size_x", grid_size[0]);
    this.params.set("size_y", grid_size[1]);
    this.params.set("size_z", grid_size[2]);
    this.params.set("copy_x", copy_x);
    this.params.set("scale", scale);
    this.params.set("axis", axis);
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

export class ShaderRenderTexture {
  label: string;
  device: GPUDevice;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipeline: GPURenderPipeline;
  vertices: Float32Array;
  indices: Uint16Array;
  vertex_buffer: GPUBuffer;
  index_buffer: GPUBuffer;
  vertex_buffer_layout: GPUVertexBufferLayout;
  clear_color: GPUColor;
  grid_sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.label = "render_texture";
    this.device = device;
    this.shader_source = `
      @group(0) @binding(0) var grid_sampler: sampler;
      @group(0) @binding(1) var grid_texture: texture_2d<f32>;

      struct VertexOut {
        @builtin(position) vertex_position : vec4f,
        @location(0) frag_position: vec2f,
      }

      @vertex
      fn vertex_main(@location(0) position: vec2f) -> VertexOut {
        var output : VertexOut;
        output.vertex_position = vec4f(position.x*2.0 - 1.0, position.y*2.0 - 1.0, 0.0, 1.0);
        output.frag_position = vec2f(position.x, position.y);
        return output;
      }

      @fragment
      fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
        let data = textureSampleLevel(grid_texture, grid_sampler, vertex.frag_position, 0.0);
        let color = vec4f(data.r, data.g, data.b, 1.0);
        return color;
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    this.vertices = new Float32Array([
      0.0, 0.0,
      0.0, 1.0,
      1.0, 1.0,
      1.0, 0.0,
    ]);
    this.indices = new Uint16Array([
      0, 1, 2,
      0, 2, 3,
    ]);
    this.vertex_buffer = device.createBuffer({
      size: this.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.index_buffer = device.createBuffer({
      size: this.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertex_buffer, 0, this.vertices, 0, this.vertices.length);
    device.queue.writeBuffer(this.index_buffer, 0, this.indices, 0, this.indices.length);

    this.vertex_buffer_layout = {
      attributes: [
        {
          shaderLocation: 0, // position
          offset: 0,
          format: "float32x2",
        },
      ],
      arrayStride: 8,
      stepMode: "vertex",
    };
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {},
        },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.render_pipeline = device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.vertex_buffer_layout],
      },
      fragment: {
        module: this.shader_module,
        entryPoint: "fragment_main",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
          },
        ],
      },
      layout: this.pipeline_layout,
      primitive: {
        topology: "triangle-list",
      },
    });
    this.clear_color = { r: 0.0, g: 0.5, b: 1.0, a: 1.0 };
    this.grid_sampler = device.createSampler();
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    gpu_texture_view: GPUTextureView,
  ) {
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        {
          binding: 0,
          resource: this.grid_sampler,
        },
        {
          binding: 1,
          resource: gpu_texture_view,
        },
      ],
    });

    const render_pass = command_encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.clear_color,
          loadOp: "clear",
          storeOp: "store",
          view: output_texture_view,
        },
      ],
    });
    render_pass.setPipeline(this.render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.vertex_buffer);
    render_pass.setIndexBuffer(this.index_buffer, "uint16");
    render_pass.drawIndexed(this.indices.length);
    render_pass.end();
    return render_pass;
  }
};

