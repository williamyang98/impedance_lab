import * as cstruct from "../../utility/cstruct.ts";
import { type Axis3D } from "../../utility/dim_types.ts";
import { type GpuRenderTexture, type GpuMesh, create_square_mesh, GpuCamera2D } from "../../utility/gpu_common.ts";
import { GpuGrid } from "./grid.ts";
import shader_render_edge_current_wgsl from "./shader_render_edge_current.wgsl?raw";


function axis_mode_to_enum_value(axis_mode: Axis3D): number {
  switch (axis_mode) {
  case "x": return 0;
  case "y": return 1;
  case "z": return 2;
  }
}

const Params =
  cstruct.struct({
    scale: cstruct.primitive("f32"),
    grid_size: cstruct.vector(cstruct.primitive("u32"), 3),
    clear_colour: cstruct.vector(cstruct.primitive("f32"), 4),
    mask_colour: cstruct.vector(cstruct.primitive("f32"), 4),
    z_slice: cstruct.primitive("u32"),
    value_min: cstruct.primitive("f32"),
    value_max: cstruct.primitive("f32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 1),
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class ShaderRenderEdgeCurrent {
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
    this.label = "shader_render_edge_current";
    this.params = new Params(device);
    this.shader_source = shader_render_edge_current_wgsl;
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
        { binding: 6, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.mask_colour = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
  }

  get_render_pipeline(axis_mode: Axis3D): GPURenderPipeline {
    const key = axis_mode;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;
    pipeline = this.device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.mesh.vertex_buffer_layout],
        constants: {
          "axis_mode": axis_mode_to_enum_value(axis_mode),
        }
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
    this.render_pipelines.set(key, pipeline);
    return pipeline;
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    render_texture: GpuRenderTexture,
    grid: GpuGrid,
    camera: GpuCamera2D,
    axis_mode: Axis3D,
    z_slice: number,
    scale: number,
  ) {
    this.params.view.scale = scale;
    this.params.view.grid_size.x = grid.size.x;
    this.params.view.grid_size.y = grid.size.y;
    this.params.view.grid_size.z = grid.size.z;
    this.params.view.clear_colour.r = this.clear_colour.r;
    this.params.view.clear_colour.g = this.clear_colour.g;
    this.params.view.clear_colour.b = this.clear_colour.b;
    this.params.view.clear_colour.a = this.clear_colour.a;
    this.params.view.mask_colour.r = this.mask_colour.r;
    this.params.view.mask_colour.g = this.mask_colour.g;
    this.params.view.mask_colour.b = this.mask_colour.b;
    this.params.view.mask_colour.a = this.mask_colour.a;
    this.params.view.z_slice = z_slice;
    const MAX_RANGE = 1e8;
    this.params.view.value_min = -MAX_RANGE;
    this.params.view.value_max = MAX_RANGE;
    this.params.write_to_gpu();

    const data = grid.V[axis_mode]; // edge matrix
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
        { binding: 4, resource: bind_gpu_buffer(grid.I.x.data) },
        { binding: 5, resource: bind_gpu_buffer(grid.I.y.data) },
        { binding: 6, resource: bind_gpu_buffer(grid.I.z.data) },
      ],
    });
    const pipeline = this.get_render_pipeline(axis_mode);
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
