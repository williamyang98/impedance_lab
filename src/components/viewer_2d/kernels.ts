import { StructView } from "../../utility/cstyle_struct.ts";

export type Axis = "voltage" | "electric_x" | "electric_y" | "electric_mag" | "electric_vec" | "energy" | "force";

function axis_to_shader_id(axis: Axis): number {
  switch (axis) {
    case "voltage":       return 0;
    case "electric_x":    return 1;
    case "electric_y":    return 2;
    case "electric_mag":  return 3;
    case "electric_vec":  return 4;
    case "energy":        return 5;
    case "force":         return 6;
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
      @group(0) @binding(2) var v_field: texture_2d<f32>;
      @group(0) @binding(3) var e_field: texture_2d<f32>;
      @group(0) @binding(4) var spline_sampler: sampler;
      @group(0) @binding(5) var spline_dx: texture_1d<f32>;
      @group(0) @binding(6) var spline_dy: texture_1d<f32>;
      @group(0) @binding(7) var v_force: texture_2d<f32>;

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
        let V = textureSampleLevel(v_field, grid_sampler, vertex.frag_position, 0.0).r;
        let E = textureSampleLevel(e_field, grid_sampler, vertex.frag_position, 0.0).rg;
        let dx = textureSample(spline_dx, spline_sampler, vertex.frag_position.x).r;
        let dy = textureSample(spline_dy, spline_sampler, vertex.frag_position.y).r;
        let V_force = textureSampleLevel(v_force, grid_sampler, vertex.frag_position, 0.0).rg;
        let alpha_scale: f32 = 100.0;

        var color: vec4f = vec4f(0.0, 0.0, 0.0, 0.0);
        if (params.axis == 0) {
          let value = V*params.scale;
          color = vec4f(-value, value, 0.0, abs(value)*alpha_scale);
        } else if (params.axis == 1) {
          let value = E.x*params.scale;
          color = vec4f(-value, value, 0, abs(value)*alpha_scale);
        } else if (params.axis == 2) {
          let value = E.y*params.scale;
          color = vec4f(-value, value, 0, abs(value)*alpha_scale);
        } else if (params.axis == 3) {
          let value = length(E)*params.scale;
          color = vec4f(value, value, value, value*alpha_scale);
        } else if (params.axis == 4) {
          let angle = atan2(E.y, -E.x);
          let value = length(E)*params.scale;

          let hue = angle / (2.0*3.1415) + 0.5;
          let saturation = 1.0;
          let rgb = hsv_to_rgb(vec3<f32>(hue, saturation, value));
          color = vec4<f32>(rgb.r, rgb.g, rgb.b, value*alpha_scale);
        } else if (params.axis == 5) {
          let dA = dx*dy;
          let energy = (E.x*E.x+E.y*E.y)*dA;
          let value = energy*params.scale*20;
          color = vec4f(value, value, value, value*alpha_scale);
        } else if (params.axis == 6) {
          let V_input = V_force.r*params.scale;
          let V_beta = V_force.g;
          let cmap = red_green_cmap(V_input);
          color = vec4f(cmap, V_beta);
        }

        return color;
      }

      fn red_green_cmap(value: f32) -> vec3<f32> {
        const neg_color = vec3<f32>(1.0, 0.0, 0.0);
        const mid_color = vec3<f32>(1.0, 1.0, 1.0);
        const pos_color = vec3<f32>(0.0, 1.0, 0.0);

        let alpha = clamp(value, -1.0, 1.0);
        if (alpha < 0.0) {
          return mix(neg_color, mid_color, alpha+1);
        } else {
          return mix(mid_color, pos_color, alpha);
        }
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
          texture: {
            viewDimension: "2d",
          },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "1d",
          },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "1d",
          },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "2d",
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
            // we are output to canvas texture
            format: navigator.gpu.getPreferredCanvasFormat(),
            // alpha blending
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
            writeMask: GPUColorWrite.ALL,
          },
        ],
      },
      layout: this.pipeline_layout,
      primitive: {
        topology: "triangle-list",
      },
    });
    this.clear_color = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
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
    v_field_view: GPUTextureView,
    e_field_view: GPUTextureView,
    spline_dx_view: GPUTextureView,
    spline_dy_view: GPUTextureView,
    v_force_view: GPUTextureView,
    scale: number, axis: Axis,
  ) {
    this.params.set("scale", scale);
    this.params.set("axis", axis_to_shader_id(axis));
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
          resource: v_field_view,
        },
        {
          binding: 3,
          resource: e_field_view,
        },
        {
          binding: 4,
          resource: this.spline_sampler,
        },
        {
          binding: 5,
          resource: spline_dx_view,
        },
        {
          binding: 6,
          resource: spline_dy_view,
        },
        {
          binding: 7,
          resource: v_force_view,
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
