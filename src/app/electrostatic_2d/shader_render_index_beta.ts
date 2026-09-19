import { type GpuRenderTexture, type GpuMesh, create_square_mesh, GpuUniform, GpuCamera2D } from "../../utility/gpu_common.ts";
import { GpuGrid } from "./grid.ts";
import shader_render_index_beta_wgsl from "./shader_render_index_beta.wgsl?raw";

export type DataMode = "voltage_input" | "dielectric";
export type ColourMode = "index" | "beta" | "value";

function get_data_mode_enum_value(mode: DataMode): number {
  switch (mode) {
    case "voltage_input": return 0;
    case "dielectric": return 1;
  }
}

function get_colour_mode_enum_value(mode: ColourMode): number {
  switch (mode) {
    case "index": return 0;
    case "beta": return 1;
    case "value": return 2;
  }
}

export class ShaderRenderIndexBeta {
  label: string;
  device: GPUDevice;
  params: GpuUniform<{
    scale: "f32",
    alpha_scale: "f32",
    grid_size_x: "u32",
    grid_size_y: "u32",
    clear_colour: ["f32", "f32", "f32", "f32"],
  }>;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipelines = new Map<string, GPURenderPipeline>();
  mesh: GpuMesh;
  clear_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.label = " component_shader";
    this.device = device;
    const params = new GpuUniform(device, {
      scale: "f32",
      alpha_scale: "f32",
      grid_size_x: "u32",
      grid_size_y: "u32",
      clear_colour: ["f32", "f32", "f32", "f32"],
      mask_colour: ["f32", "f32", "f32", "f32"],
    });
    this.params = params;

    this.shader_source = shader_render_index_beta_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    this.mesh = create_square_mesh(device);
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  }

  get_render_pipeline(data_mode: DataMode, colour_mode: ColourMode): GPURenderPipeline {
    const key = `${data_mode}_${colour_mode}`;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;

    pipeline = this.device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.mesh.vertex_buffer_layout],
        constants: {
          "data_mode": get_data_mode_enum_value(data_mode),
        },
      },
      fragment: {
        module: this.shader_module,
        entryPoint: "fragment_main",
        constants: {
          "colour_mode": get_colour_mode_enum_value(colour_mode),
        },
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
    this.render_pipelines.set(key, pipeline);
    return pipeline;
  }

  // axis_mask selects which components to render
  create_pass(
    command_encoder: GPUCommandEncoder,
    render_texture: GpuRenderTexture,
    grid: GpuGrid,
    camera: GpuCamera2D,
    data_mode: DataMode, colour_mode: ColourMode,
    scale: number, alpha_scale?: number,
  ) {
    alpha_scale = alpha_scale ?? 1.0;

    this.params.cpu.set("scale", scale);
    this.params.cpu.set("alpha_scale", alpha_scale);
    this.params.cpu.set("grid_size_x", grid.size.x);
    this.params.cpu.set("grid_size_y", grid.size.y);
    const rgba_to_array = (colour: GPUColorDict) => [colour.r, colour.g, colour.b, colour.a];
    this.params.cpu.set_array("clear_colour", rgba_to_array(this.clear_colour));
    this.params.write_to_gpu();

    const get_buffer = () => {
      switch (data_mode) {
      case "voltage_input": return { data: grid.v_index_beta, table: grid.v_table };
      case "dielectric": return { data: grid.ek_index_beta, table: grid.ek_table };
      }
    };
    const { data, table } = get_buffer();
    const total_instances = data.shape.reduce((a,b) => a*b, 1);

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu) },
        { binding: 2, resource: bind_gpu_buffer(grid.x.data) },
        { binding: 3, resource: bind_gpu_buffer(grid.y.data) },
        { binding: 4, resource: bind_gpu_buffer(data.data) },
        { binding: 5, resource: bind_gpu_buffer(table.data) },
      ],
    });

    const render_pass = command_encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.clear_colour,
          loadOp: "clear",
          storeOp: "store",
          view: render_texture.texture_view,
        },
      ],
    });
    render_pass.setViewport(
      0, 0,
      render_texture.size.x, render_texture.size.y,
      0, 1,
    );
    const render_pipeline = this.get_render_pipeline(data_mode, colour_mode);
    render_pass.setPipeline(render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.mesh.vertex_buffer);
    render_pass.setIndexBuffer(this.mesh.index_buffer, this.mesh.index_format);
    render_pass.drawIndexed(this.mesh.total_indices, total_instances);
    render_pass.end();
    return render_pass;
  }
}
