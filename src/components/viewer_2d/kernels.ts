import { StructView } from "../../utility/cstyle_struct.ts";
import shader_component_wgsl from "./shader_component.wgsl?raw";
import shader_quiver_wgsl from "./shader_quiver.wgsl?raw";
import shader_index_beta_wgsl from "./shader_index_beta.wgsl?raw";

const rectangle_mesh = {
  vertices: new Float32Array([
    0.0, 0.0,
    0.0, 1.0,
    1.0, 1.0,
    1.0, 0.0,
  ]),
  indices: new Uint16Array([
    0, 1, 2,
    0, 2, 3,
  ]),
}

export type ColourMode = "single_component" | "vector" | "magnitude" | "index_beta";

function get_colour_mode_index(mode: ColourMode): number {
  switch (mode) {
    case "single_component": return 0;
    case "vector": return 1;
    case "magnitude": return 2;
    case "index_beta": return 16;
  }
}

export class ShaderComponentViewer {
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

    this.shader_source = shader_component_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    this.vertices = rectangle_mesh.vertices;
    this.indices = rectangle_mesh.indices;
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
  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    grid_texture_view: GPUTextureView,
    canvas_size: { width: number, height: number },
    scale: number, axis_mask: number, colour_mode: ColourMode,
    alpha_scale?: number,
  ) {
    this.params.set("scale", scale);
    this.params.set("axis", axis_mask);
    this.params.set("colour", get_colour_mode_index(colour_mode));
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
      canvas_size.width, canvas_size.height,
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

export class ShaderQuiverGrid {
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
    this.shader_source = shader_quiver_wgsl;
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
    canvas_size: { width: number, height: number },
    scale: number, quiver_size?: number,
  ) {
    quiver_size = quiver_size ?? 15;

    const quiver_count_x = Math.max(Math.ceil(canvas_size.width/quiver_size), 2);
    const quiver_count_y = Math.max(Math.ceil(canvas_size.height/quiver_size), 2);
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
      canvas_size.width, canvas_size.height,
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

export type IndexBetaMode = "index" | "beta" | "signed_value" | "absolute_value";

function get_index_beta_mode_index(mode: IndexBetaMode): number {
  switch (mode) {
    case "index": return 0;
    case "beta": return 1;
    case "signed_value": return 2;
    case "absolute_value": return 3;
  }
}

export class ShaderIndexBeta {
  label: string;
  device: GPUDevice;
  params = new StructView({
    scale: "f32",
    mode: "u32",
    alpha: "f32",
    texture_width: "u32",
    texture_height: "u32",
    table_size: "u32",
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

  constructor(device: GPUDevice) {
    this.label = " index_beta_shader";
    this.device = device;
    this.params_uniform = device.createBuffer({
      size: this.params.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.shader_source = shader_index_beta_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    this.vertices = rectangle_mesh.vertices;
    this.indices = rectangle_mesh.indices;
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
          // table view
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "2d",
            sampleType: "unfilterable-float",
          },
        },
        {
          // index beta texture view
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            viewDimension: "2d",
            sampleType: "uint",
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
  }

  // axis_mask selects which components to render
  create_pass(
    command_encoder: GPUCommandEncoder,
    output_texture_view: GPUTextureView,
    canvas_size: { width: number, height: number },
    table_view: GPUTextureView,
    index_beta_view: GPUTextureView,
    table_size: number,
    index_beta_size: { width: number, height: number },
    scale: number, mode: IndexBetaMode,
    alpha?: number,
  ) {
    this.params.set("scale", scale);
    this.params.set("mode", get_index_beta_mode_index(mode));
    this.params.set("alpha", alpha ?? 100.0);
    this.params.set("texture_width", index_beta_size.width);
    this.params.set("texture_height", index_beta_size.height);
    this.params.set("table_size", table_size);
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
          resource: table_view,
        },
        {
          binding: 2,
          resource: index_beta_view,
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
      canvas_size.width, canvas_size.height,
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
