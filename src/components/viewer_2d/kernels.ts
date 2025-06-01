import { StructView } from "../../utility/cstyle_struct.ts";

class ShaderComponentViewer {
  label: string;
  device: GPUDevice;
  params = new StructView({
    scale: "f32",
    axis: "u32",
    colour: "u32",
    alpha_scale: "f32",
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
  clear_colour: GPUColor;
  grid_sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.label = " component_shader";
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    {
      const vertex_source = /*wgsl*/`
        struct Params {
          scale: f32,
          axis: u32,
          colour: u32,
          alpha_scale: f32,
        }

        @group(0) @binding(0) var<uniform> params: Params;
        @group(0) @binding(1) var grid_sampler: sampler;
        @group(0) @binding(2) var grid: texture_2d<f32>;

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
      `;

      const colour_maps = /*wgsl*/`
        fn red_green_cmap(value: f32) -> vec3<f32> {
          const neg_colour = vec3<f32>(1.0, 0.0, 0.0);
          const mid_colour = vec3<f32>(1.0, 1.0, 1.0);
          const pos_colour = vec3<f32>(0.0, 1.0, 0.0);

          let alpha = clamp(value, -1.0, 1.0);
          if (alpha < 0.0) {
            return mix(neg_colour, mid_colour, alpha+1);
          } else {
            return mix(mid_colour, pos_colour, alpha);
          }
        }

        // https://stackoverflow.com/a/17897228
        fn hsv_to_rgb(c: vec3<f32>) -> vec3<f32> {
          let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          let p = abs(fract(vec3<f32>(c.x) + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
        }
      `;

      const get_axis_colour = /*wgsl*/`
        fn get_1d_colour(value: f32) -> vec4<f32> {
          var colour = vec4<f32>(0.0, 0.0, 0.0, 0.0);
          if (params.colour == 0) {
            let mag: f32 = value*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(-mag, mag, 0.0, alpha);
          } else if (params.colour == 1) {
            let mag: f32 = value*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(red_green_cmap(mag), alpha);
          } else if (params.colour == 2) {
            let mag: f32 = value*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(mag, mag, mag, alpha);
          }
          return colour;
        }

        fn get_2d_colour(value: vec2<f32>) -> vec4<f32> {
          var colour = vec4(0.0, 0.0, 0.0, 0.0);
          if (params.colour == 0) {
            let mag: f32 = length(value)*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(-mag, mag, 0.0, alpha);
          } else if (params.colour == 1) {
            let mag = length(value)*params.scale;
            let alpha = mag*params.alpha_scale;

            let angle = atan2(value.r, -value.g);
            let hue = angle / (2.0*3.1415) + 0.5;
            let saturation = 1.0;
            let rgb = hsv_to_rgb(vec3<f32>(hue, saturation, mag));
            colour = vec4<f32>(rgb.r, rgb.g, rgb.b, alpha);
          } else if (params.colour == 2) {
            let mag: f32 = length(value)*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(mag, mag, mag, alpha);
          } else if (params.colour == 16) {
            let mag = value.r*params.scale;
            let beta = value.g*params.scale;
            let alpha = abs(beta)*params.alpha_scale;
            colour = vec4f(red_green_cmap(mag), alpha);
          }
          return colour;
        }

        fn get_3d_colour(value: vec3<f32>) -> vec4<f32> {
          var colour = vec4(0.0, 0.0, 0.0, 0.0);
          if (params.colour == 0) {
            let mag: f32 = length(value)*params.scale;
            let alpha = mag*params.alpha_scale;
            colour = vec4f(-mag, mag, 0.0, alpha);
          } else if (params.colour == 1) {
            let mag: f32 = length(value)*params.scale;
            let alpha = mag*params.alpha_scale;
            colour = vec4f(abs(value.r), abs(value.g), abs(value.b), alpha);
          } else if (params.colour == 2) {
            let mag: f32 = length(value)*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(mag, mag, mag, alpha);
          }
          return colour;
        }

        fn get_4d_colour(value: vec4<f32>) -> vec4<f32> {
          var colour = vec4(0.0, 0.0, 0.0, 0.0);
          if (params.colour == 0) {
            let mag: f32 = length(value)*params.scale;
            let alpha = mag*params.alpha_scale;
            colour = vec4f(-mag, mag, 0.0, alpha);
          } else if (params.colour == 1) {
            let mag: f32 = length(value)*params.scale;
            colour = vec4f(abs(value.r), abs(value.g), abs(value.b), abs(value.a));
          } else if (params.colour == 2) {
            let mag: f32 = length(value)*params.scale;
            let alpha = abs(mag)*params.alpha_scale;
            colour = vec4f(mag, mag, mag, alpha);
          }
          return colour;
        }
      `;

      const fragment_source = /*wgsl*/`
        fn test_mask(mask: u32) -> bool {
          return (params.axis & mask) == mask;
        }

        @fragment
        fn fragment_main(vertex: VertexOut) -> @location(0) vec4f {
          let sample = textureSampleLevel(grid, grid_sampler, vertex.frag_position, 0.0);
          var colour = vec4(0.0, 0.0, 0.0, 0.0);

          // 4d
          if (test_mask(1 | 2 | 4 | 8)) {
            colour = get_4d_colour(sample.rgba);
          // 3d
          } else if (test_mask(1 | 2 | 4)) {
            colour = get_3d_colour(sample.rgb);
          } else if (test_mask(1 | 2 | 8)) {
            colour = get_3d_colour(sample.rga);
          } else if (test_mask(1 | 4 | 8)) {
            colour = get_3d_colour(sample.rba);
          } else if (test_mask(2 | 4 | 8)) {
            colour = get_3d_colour(sample.gba);
          // 2d
          } else if (test_mask(1 | 2)) {
            colour = get_2d_colour(sample.rg);
          } else if (test_mask(1 | 4)) {
            colour = get_2d_colour(sample.rb);
          } else if (test_mask(1 | 8)) {
            colour = get_2d_colour(sample.ra);
          } else if (test_mask(2 | 4)) {
            colour = get_2d_colour(sample.gb);
          } else if (test_mask(2 | 8)) {
            colour = get_2d_colour(sample.ga);
          } else if (test_mask(4 | 8)) {
            colour = get_2d_colour(sample.ba);
          // 1d
          } else if (test_mask(1)) {
            colour = get_1d_colour(sample.r);
          } else if (test_mask(2)) {
            colour = get_1d_colour(sample.g);
          } else if (test_mask(4)) {
            colour = get_1d_colour(sample.b);
          } else if (test_mask(8)) {
            colour = get_1d_colour(sample.a);
          }
          return colour;
        }
      `;

      const shader_source = [
        vertex_source,
        fragment_source,
        colour_maps,
        get_axis_colour,
      ].join("\n");

      this.shader_source = shader_source;
      this.shader_module = device.createShaderModule({
        code: shader_source,
      });
    };

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
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.grid_sampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
    });
  }

  // axis_mask selects which components to render
  // colour_modes are:
  // 0 - red/green with opacity
  // 1 - vector view (components allocated to a channel)
  // 2 - magnitude view
  // 16 - special mode for 2 channel texture where red=value, green=beta
  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    grid_texture_view: GPUTextureView,
    canvas_size: [number, number],
    scale: number, axis_mask: number, colour_mode: number,
    alpha_scale?: number,
  ) {
    const [canvas_height, canvas_width] = canvas_size;
    this.params.set("scale", scale);
    this.params.set("axis", axis_mask);
    this.params.set("colour", colour_mode);
    this.params.set("alpha_scale", alpha_scale ?? 100.0);
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
          resource: grid_texture_view,
        },
      ],
    });

    const render_pass = command_encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.clear_colour,
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
  clear_colour: GPUColor;
  grid_sampler: GPUSampler;

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
    this.clear_colour = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    this.grid_sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    e_field_view: GPUTextureView,
    grid_size: [number, number], canvas_size: [number, number], scale: number,
  ) {
    const [grid_size_y, grid_size_x] = grid_size;
    const [canvas_height, canvas_width] = canvas_size;
    const min_pixels_per_cell = 15;
    const subsampling_ratio = Math.max(1.0, grid_size_y*min_pixels_per_cell/canvas_height, grid_size_x*min_pixels_per_cell/canvas_width);
    const aspect_ratio = canvas_width/canvas_height;
    const aspect_x = (aspect_ratio > 1.0) ? 1.0 : 1.0/aspect_ratio;
    const aspect_y = (aspect_ratio > 1.0) ? 1.0/aspect_ratio : 1.0;
    const grid_size_max = Math.max(grid_size_x, grid_size_y);
    const quiver_count_x = Math.max(Math.ceil(grid_size_max/subsampling_ratio*aspect_x), 2);
    const quiver_count_y = Math.max(Math.ceil(grid_size_max/subsampling_ratio*aspect_y), 2);
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
      ],
    });

    const render_pass = command_encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.clear_colour,
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

export type Axis =
  "voltage" |
  "electric_x" | "electric_y" | "electric_mag" | "electric_vec" |
  "energy" | "force" | "epsilon" |
  "electric_quiver";

export class ShaderRenderTexture {
  shader_component: ShaderComponentViewer;
  shader_quiver: ShaderQuiverGrid;

  constructor(device: GPUDevice) {
    this.shader_component = new ShaderComponentViewer(device);
    this.shader_quiver = new ShaderQuiverGrid(device);
  }

  create_pass(
    command_encoder: GPUCommandEncoder, output_texture_view: GPUTextureView,
    v_field_view: GPUTextureView, e_field_view: GPUTextureView,
    spline_dx_view: GPUTextureView, spline_dy_view: GPUTextureView,
    v_force_view: GPUTextureView, epsilon_view: GPUTextureView,
    grid_size: [number, number],
    canvas_size: [number, number],
    scale: number, axis: Axis,
  ) {

    switch (axis) {
      case "voltage": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        v_field_view, canvas_size, scale, 1, 0,
      );
      case "electric_x": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        e_field_view, canvas_size, scale, 1, 0,
      );
      case "electric_y": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        e_field_view, canvas_size, scale, 2, 0,
      );
      case "electric_mag": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        e_field_view, canvas_size, scale, (1 | 2), 2,
      );
      case "electric_vec": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        e_field_view, canvas_size, scale, (1 | 2), 1,
      );
      case "energy": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        e_field_view, canvas_size, scale, (1 | 2), 2,
      );
      case "force": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        v_force_view, canvas_size, scale, (1 | 2) , 16, 1.0,
      );
      case "epsilon": return this.shader_component.create_pass(
        command_encoder, output_texture_view,
        epsilon_view, canvas_size, scale, (1 | 2), 16, 1.0,
      );
      case "electric_quiver": return this.shader_quiver.create_pass(
        command_encoder, output_texture_view,
        e_field_view,
        grid_size, canvas_size, scale,
      );
    }
  }
};
