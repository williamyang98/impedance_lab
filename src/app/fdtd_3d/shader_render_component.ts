import { type GpuRenderTexture, type GpuMesh, GpuUniform, create_square_mesh, GpuCamera2D, NdGpuArray } from "../../renderers/common.ts";
import type { GpuGrid } from "./grid.ts";
import shader_render_component_wgsl from "./shader_render_component.wgsl?raw";

export type DataMode = "Ex" | "Ey" | "Ez" | "Hx" | "Hy" | "Hz";

function data_mode_to_enum_value(mode: DataMode): number {
  switch (mode) {
  case "Ex": return 0;
  case "Ey": return 1;
  case "Ez": return 2;
  case "Hx": return 3;
  case "Hy": return 4;
  case "Hz": return 5;
  }
}

export function get_data_from_grid(grid: GpuGrid, mode: DataMode): NdGpuArray {
  switch (mode) {
  case "Ex": return grid.E.x;
  case "Ey": return grid.E.y;
  case "Ez": return grid.E.z;
  case "Hx": return grid.H.x;
  case "Hy": return grid.H.y;
  case "Hz": return grid.H.z;
  }
}

export class ShaderRenderComponent {
  label: string;
  device: GPUDevice;
  params: GpuUniform<{
    scale: "f32",
    size_x: "u32",
    size_y: "u32",
    size_z: "u32",
    clear_colour: ["f32", "f32", "f32", "f32"],
    mask_colour: ["f32", "f32", "f32", "f32"],
    z_slice: "u32",
    _pad: ["u32", "u32", "u32"],
  }>;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipelines = new Map<string, GPURenderPipeline>;
  mesh: GpuMesh;
  clear_colour: GPUColorDict;
  mask_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.device = device;
    this.label = "electrostatic_3d_shader";
    const params = new GpuUniform(device, {
      scale: "f32",
      size_x: "u32",
      size_y: "u32",
      size_z: "u32",
      clear_colour: ["f32", "f32", "f32", "f32"],
      mask_colour: ["f32", "f32", "f32", "f32"],
      z_slice: "u32",
      zoom: "f32",
      _pad: ["u32", "u32"],
    });
    this.params = params;
    this.shader_source = shader_render_component_wgsl;
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
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.mask_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  }

  get_render_pipeline(data_mode: DataMode): GPURenderPipeline {
    const key = data_mode;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;
    const constants = {
      "data_mode": data_mode_to_enum_value(data_mode),
    };
    pipeline = this.device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.mesh.vertex_buffer_layout],
        constants,
      },
      fragment: {
        module: this.shader_module,
        entryPoint: "fragment_main",
        constants,
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

  create_pass(
    command_encoder: GPUCommandEncoder,
    render_texture: GpuRenderTexture,
    grid: GpuGrid,
    camera: GpuCamera2D,
    data_mode: DataMode,
    z_slice: number,
    scale: number,
  ) {
    this.params.cpu.set("scale", scale);
    this.params.cpu.set("size_x", grid.size.x);
    this.params.cpu.set("size_y", grid.size.y);
    this.params.cpu.set("size_z", grid.size.z);
    const rgba_to_array = (colour: GPUColorDict) => [colour.r, colour.g, colour.b, colour.a];
    this.params.cpu.set_array("clear_colour", rgba_to_array(this.clear_colour));
    this.params.cpu.set_array("mask_colour", rgba_to_array(this.mask_colour));
    this.params.cpu.set("z_slice", z_slice);
    this.params.write_to_gpu();


    const data = get_data_from_grid(grid, data_mode);
    const total_instances = data.shape[1]*data.shape[2];
    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu) },
        { binding: 2, resource: bind_gpu_buffer(grid.grid_lines.x.data) },
        { binding: 3, resource: bind_gpu_buffer(grid.grid_lines.y.data) },
        { binding: 4, resource: bind_gpu_buffer(data.data) },
      ],
    });
    const pipeline = this.get_render_pipeline(data_mode);
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
    render_pass.setPipeline(pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.mesh.vertex_buffer);
    render_pass.setIndexBuffer(this.mesh.index_buffer, this.mesh.index_format);
    render_pass.drawIndexed(this.mesh.total_indices, total_instances);
    render_pass.end();
    return render_pass;
  }
}
