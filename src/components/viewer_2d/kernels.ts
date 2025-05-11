import { StructView } from "../../utility/cstyle_struct.ts";

export type Axis =
  "voltage" |
  "electric_x" | "electric_y" | "electric_mag" | "electric_vec" |
  "energy" | "force" |
  "electric_quiver";

class ShaderColourGrid {
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
    this.label = "color_grid_shader";
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
      @group(0) @binding(2) var v_field: texture_2d<f32>;
      @group(0) @binding(3) var e_field: texture_2d<f32>;
      @group(0) @binding(4) var spline_sampler: sampler;
      @group(0) @binding(5) var spline_dx: texture_2d<f32>;
      @group(0) @binding(6) var spline_dy: texture_2d<f32>;
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
        let dx = textureSampleLevel(spline_dx, spline_sampler, vec2<f32>(vertex.frag_position.x, 0.0), 0.0).r;
        let dy = textureSampleLevel(spline_dy, spline_sampler, vec2<f32>(vertex.frag_position.y, 0.0), 0.0).r;
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
            viewDimension: "2d",
          },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "2d",
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
    canvas_size: [number, number],
    scale: number, axis_id: number,
  ) {
    const [canvas_height, canvas_width] = canvas_size;
    this.params.set("scale", scale);
    this.params.set("axis", axis_id);
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
    render_pass.setViewport(
      0, 0,
      canvas_width, canvas_height,
      0, 1,
    );
    render_pass.setPipeline(this.render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.vertex_buffer);
    render_pass.setIndexBuffer(this.index_buffer, "uint16");
    render_pass.drawIndexed(this.indices.length);
    render_pass.end();
    return render_pass;
  }
}

class ShaderQuiverGrid {
  label: string;
  device: GPUDevice;
  params = new StructView({
    scale: "f32",
    quiver_count_x: "u32",
    quiver_count_y: "u32",
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
    this.label = "quiver_grid_shader";
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.shader_source = /*wgsl*/`
      struct Params {
        scale: f32,
        quiver_count_x: u32,
        quiver_count_y: u32,
      }

      @group(0) @binding(0) var<uniform> params: Params;
      @group(0) @binding(1) var grid_sampler: sampler;
      @group(0) @binding(2) var e_field: texture_2d<f32>;
      @group(0) @binding(3) var spline_sampler: sampler;
      @group(0) @binding(4) var spline_dx: texture_2d<f32>;
      @group(0) @binding(5) var spline_dy: texture_2d<f32>;

      struct VertexOut {
        @builtin(position) vertex_position : vec4f,
        @location(0) frag_position: vec2f,
        @location(1) magnitude: f32,
      }

      @vertex
      fn vertex_main(
        @location(0) position: vec2f,
        @builtin(vertex_index) vertex_index: u32,
        @builtin(instance_index) instance_index: u32
      ) -> VertexOut {
        // get [x,y] index of arrow
        let y_index = instance_index/params.quiver_count_x;
        let x_index = instance_index - y_index*params.quiver_count_x;

        // normalise coordinates to [0,1]
        let y_coord = f32(y_index)/f32(params.quiver_count_y-1);
        let x_coord = f32(x_index)/f32(params.quiver_count_x-1);
        let coord = vec2<f32>(x_coord, y_coord);

        // sample field value at arrow midpoint
        let E = textureSampleLevel(e_field, grid_sampler, coord, 0.0).rg;
        // TODO: Is it useful to try to visualise the non-uniform grid spacing?
        // let dx = textureSampleLevel(spline_dx, spline_sampler, vec2<f32>(x_coord, 0.0), 0.0).r;
        // let dy = textureSampleLevel(spline_dy, spline_sampler, vec2<f32>(y_coord, 0.0), 0.0).r;
        let angle = atan2(-E.x, E.y);
        let mag = length(E);

        // create arrow
        var arrow_x = position.x;
        var arrow_y = position.y;
        // scale to magnitude of field
        let scale = min(1.0, params.scale*mag);
        arrow_x *= min(1.0, scale*1.5); // make the arrow shorter faster than it is skinny
        arrow_y *= min(1.0, scale);
        // rotate based on orientation
        var rot_arrow_x = arrow_x*cos(angle) - arrow_y*sin(angle);
        var rot_arrow_y = arrow_x*sin(angle) + arrow_y*cos(angle);
        // resize to fit grid (we do this after rotation to adjust for aspect ratio)
        rot_arrow_x *= 0.5/f32(params.quiver_count_x);
        rot_arrow_y *= 0.5/f32(params.quiver_count_y);
        // translate to location on grid
        let vertex_x = rot_arrow_x + x_coord + 0.5/f32(params.quiver_count_x);
        let vertex_y = rot_arrow_y + y_coord + 0.5/f32(params.quiver_count_y);

        var output : VertexOut;
        // normalise [0,1] to [-1,+1] display coordinates
        output.vertex_position = vec4f(vertex_x*2.0-1.0, vertex_y*2.0-1.0, 0.0, 1.0);
        output.frag_position = vec2f(x_coord, y_coord);
        output.magnitude = scale;
        return output;
      }

      @fragment
      fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
        let magnitude = min(vertex.magnitude, 1.0);
        let alpha = sqrt(magnitude);
        const low_colour = vec3<f32>(0.4,0.0,0.1);
        const high_colour = vec3<f32>(0.2,0.0,0.6);
        let colour = mix(low_colour, high_colour, magnitude);
        return vec4<f32>(colour.rgb, alpha);
      }
    `;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    // arrow shape [-1,+1]
    const arrow_height = 1.0;
    const quiver_width = 0.5;
    this.vertices = new Float32Array([
      // arrow tip
       0.0, 1.0,
      -1.0, 1.0-arrow_height,
       1.0, 1.0-arrow_height,
      // quiver body
      -quiver_width/2, 1.0-arrow_height,
       quiver_width/2, 1.0-arrow_height,
      -quiver_width/2, -1,
       quiver_width/2, -1,
    ]);
    this.indices = new Uint16Array([
      // arrow tip
      0, 1, 2,
      // quiver body
      3, 4, 5,
      4, 5, 6,
      // padding to align to 4byte boundary
      0,
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
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          texture: {
            viewDimension: "2d",
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.VERTEX,
          sampler: {
            type: "filtering",
          },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.VERTEX,
          texture: {
            viewDimension: "2d",
          },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.VERTEX,
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
    this.clear_color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    this.grid_sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.spline_sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    e_field_view: GPUTextureView,
    spline_dx_view: GPUTextureView,
    spline_dy_view: GPUTextureView,
    grid_size: [number, number], canvas_size: [number, number], scale: number,
  ) {
    const [grid_size_y, grid_size_x] = grid_size;
    const [canvas_height, canvas_width] = canvas_size;
    const subsampling_ratio = 1.5;
    const aspect_ratio = canvas_width/canvas_height;
    const aspect_x = (aspect_ratio > 1.0) ? 1.0 : 1.0/aspect_ratio;
    const aspect_y = (aspect_ratio > 1.0) ? 1.0/aspect_ratio : 1.0;
    const quiver_count_x = Math.max(Math.ceil(grid_size_x/subsampling_ratio*aspect_x), 2);
    const quiver_count_y = Math.max(Math.ceil(grid_size_y/subsampling_ratio*aspect_y), 2);
    const quiver_count = quiver_count_x*quiver_count_y;
    this.params.set("scale", scale);
    this.params.set("quiver_count_x", quiver_count_x);
    this.params.set("quiver_count_y", quiver_count_y);
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
          resource: e_field_view,
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
    render_pass.setViewport(
      0, 0,
      canvas_width, canvas_height,
      0, 1,
    );
    render_pass.setPipeline(this.render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.vertex_buffer);
    render_pass.setIndexBuffer(this.index_buffer, "uint16");
    // we had to pad the index buffer to align to 4bytes which we subtract from array length
    render_pass.drawIndexed(this.indices.length-1, quiver_count);
    render_pass.end();
    return render_pass;
  }
}


export class ShaderRenderTexture {
  shader_colour: ShaderColourGrid;
  shader_quiver: ShaderQuiverGrid;

  constructor(device: GPUDevice) {
    this.shader_colour = new ShaderColourGrid(device);
    this.shader_quiver = new ShaderQuiverGrid(device);
  }

  create_pass(
    command_encoder: GPUCommandEncoder, output_texture_view: GPUTextureView,
    v_field_view: GPUTextureView, e_field_view: GPUTextureView,
    spline_dx_view: GPUTextureView, spline_dy_view: GPUTextureView,
    v_force_view: GPUTextureView,
    grid_size: [number, number],
    canvas_size: [number, number],
    scale: number, axis: Axis,
  ) {

    function axis_to_shader_id(axis: Axis): number | null {
      switch (axis) {
      case "voltage":         return 0;
      case "electric_x":      return 1;
      case "electric_y":      return 2;
      case "electric_mag":    return 3;
      case "electric_vec":    return 4;
      case "energy":          return 5;
      case "force":           return 6;
      case "electric_quiver": return null;
      }
    }

    const axis_id = axis_to_shader_id(axis);
    if (axis_id !== null) {
      this.shader_colour.create_pass(
        command_encoder, output_texture_view,
        v_field_view, e_field_view,
        spline_dx_view, spline_dy_view,
        v_force_view,
        canvas_size, scale, axis_id,
      );
    } else {
      this.shader_quiver.create_pass(
        command_encoder, output_texture_view,
        e_field_view,
        spline_dx_view, spline_dy_view,
        grid_size, canvas_size, scale,
      );
    }
  }
};
