import { StructView } from "../../utility/cstyle_struct.ts";

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
  spline_sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.label = "render_texture";
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = `
      struct Params {
        scale: f32,
        axis: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var grid_sampler: sampler;
      @group(0) @binding(2) var grid_texture: texture_2d<f32>;
      @group(0) @binding(3) var spline_sampler: sampler;
      @group(0) @binding(4) var spline_dx: texture_1d<f32>;
      @group(0) @binding(5) var spline_dy: texture_1d<f32>;

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
        let Ex = data.r*params.scale;
        let Ey = data.g*params.scale;
        let dx = textureSample(spline_dx, spline_sampler, vertex.frag_position.x).r;
        let dy = textureSample(spline_dy, spline_sampler, vertex.frag_position.y).r;

        var color: vec4f = vec4f(0.0, 0.0, 0.0, 0.0);
        if (params.axis == 0) {
          color = vec4f(max(-Ex, 0), max(Ex, 0), 0, 1.0);
        } else if (params.axis == 1) {
          color = vec4f(max(-Ey, 0), max(Ey, 0), 0, 1.0);
        } else if (params.axis == 2) {
          let E: vec2<f32> = vec2<f32>(Ex, Ey);
          let mag = length(E);
          color = vec4f(mag, mag, mag, 1.0);
        } else if (params.axis == 3) {
          let E: vec2<f32> = vec2<f32>(Ex, Ey);
          let angle = atan2(Ey, -Ex);
          let value = length(E);

          let hue = angle / (2.0*3.1415) + 0.5;
          let saturation = 1.0;
          let rgb = hsv_to_rgb(vec3<f32>(hue, saturation, value));
          color = vec4<f32>(rgb.r, rgb.g, rgb.b, 1.0);
        } else if (params.axis == 4) {
          let dA = dx*dy;
          let energy = (Ex*Ex+Ey*Ey)*dA*20.0;
          color = vec4f(energy, energy, energy, 1.0);
        }

        return color;
      }

      // https://stackoverflow.com/a/17897228
      fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
        let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
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
          texture: {
            viewDimension: "2d",
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "1d",
          },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "1d",
          },
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
      magFilter: "nearest",
      minFilter: "nearest",
    });
    this.spline_sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    gpu_texture_view: GPUTextureView,
    spline_dx_view: GPUTextureView,
    spline_dy_view: GPUTextureView,
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
        {
          binding: 3,
          resource: this.spline_sampler,
        },
        {
          binding: 4,
          resource: spline_dx_view,
        },
        {
          binding: 5,
          resource: spline_dy_view,
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
