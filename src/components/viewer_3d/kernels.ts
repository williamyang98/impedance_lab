import { StructView } from "../../utility/cstyle_struct.ts";

export class KernelCopyToTexture {
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
    this.shader_source = /*wgsl*/`
      struct Params {
        size_x: u32,
        size_y: u32,
        size_z: u32,
        copy_x: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var<storage, read> grid: array<f32>;
      @group(0) @binding(2) var grid_tex: texture_storage_2d<rgba16float, write>;

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

        let Ex: f32 = grid[src_i+0];
        let Ey: f32 = grid[src_i+1];
        let Ez: f32 = grid[src_i+2];
        let E: vec3<f32> = vec3<f32>(Ex,Ey,Ez);
        let E_mag: f32 = length(E);
        let colour = vec4<f32>(Ex,Ey,Ez,E_mag);
        textureStore(grid_tex, dst_i, colour);
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

export class ShaderRenderTexture {
  label: string;
  device: GPUDevice;
  params = new StructView({
    scale: "f32",
    axis: "u32",
  });
  params_uniform: GPUBuffer;
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
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = /*wgsl*/`
      struct Params {
        scale: f32,
        axis: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var grid_sampler: sampler;
      @group(0) @binding(2) var grid_texture: texture_2d<f32>;

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
        var color: vec4f = vec4f(0.0, 0.0, 0.0, 0.0);
        if (params.axis == 0) {
          let value = data.r*params.scale;
          color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
        } else if (params.axis == 1) {
          let value = data.g*params.scale;
          color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
        } else if (params.axis == 2) {
          let value = data.b*params.scale;
          color = vec4f(max(value, 0), max(-value, 0), 0, 1.0);
        } else if (params.axis == 3) {
          let value = data.a*params.scale;
          color = vec4f(value, value, value, 1.0);
        }
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
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 2,
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
    this.grid_sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    gpu_texture_view: GPUTextureView,
    scale: number, axis: number,
  ) {
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
          resource: this.grid_sampler,
        },
        {
          binding: 2,
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
