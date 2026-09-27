import * as cstruct from "../../utility/cstruct.ts";
import { type GpuRenderTexture, type GpuMesh, create_square_mesh, GpuCamera2D, NdGpuArray } from "../../utility/gpu_common.ts";
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

const Params =
  cstruct.struct({
    scale: cstruct.primitive("f32"),
    size: cstruct.vector(cstruct.primitive("u32"), 3), // 16 bytes
    clear_colour: cstruct.vector(cstruct.primitive("f32"), 4), // 32 bytes
    mask_colour: cstruct.vector(cstruct.primitive("f32"), 4), // 48 bytes
    z_slice: cstruct.primitive("u32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 3), // 64 bytes
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class ShaderRenderComponent {
  label: string;
  device: GPUDevice;
  params: Params;
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
    this.params = new Params(device);
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
    this.params.view.scale = scale;
    this.params.view.size.x = grid.size.x;
    this.params.view.size.y = grid.size.y;
    this.params.view.size.z = grid.size.z;
    this.params.view.clear_colour.r = this.clear_colour.r;
    this.params.view.clear_colour.g = this.clear_colour.g;
    this.params.view.clear_colour.b = this.clear_colour.b;
    this.params.view.clear_colour.a = this.clear_colour.a;
    this.params.view.mask_colour.r = this.mask_colour.r;
    this.params.view.mask_colour.g = this.mask_colour.g;
    this.params.view.mask_colour.b = this.mask_colour.b;
    this.params.view.mask_colour.a = this.mask_colour.a;
    this.params.view.z_slice = z_slice;
    this.params.write_to_gpu();

    const data = get_data_from_grid(grid, data_mode);
    const total_instances = data.shape[1]*data.shape[2];
    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu_buffer) },
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
