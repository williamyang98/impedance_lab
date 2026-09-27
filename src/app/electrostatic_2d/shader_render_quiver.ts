import * as cstruct from "../../utility/cstruct.ts";
import { type GpuRenderTexture, type GpuMesh, GpuCamera2D, create_arrow_mesh } from "../../utility/gpu_common.ts";
import { GpuGrid } from "./grid.ts";
import shader_render_quiver_wgsl from "./shader_render_quiver.wgsl?raw";

const Params =
  cstruct.struct({
    scale: cstruct.primitive("f32"),
    grid_size: cstruct.vector(cstruct.primitive("u32"), 2),
    _pad_0: cstruct.primitive("u32"),
    low_colour: cstruct.vector(cstruct.primitive("f32"), 4),
    high_colour: cstruct.vector(cstruct.primitive("f32"), 4),
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class ShaderRenderQuiver {
  label: string;
  device: GPUDevice;
  params: Params;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipeline: GPURenderPipeline;
  mesh: GpuMesh;
  clear_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.label = " component_shader";
    this.device = device;
    this.params = new Params(device);
    this.shader_source = shader_render_quiver_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });

    this.mesh = create_arrow_mesh(device, {
      arrow_height: 1.0,
      quiver_width: 0.5,
    });
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
    this.render_pipeline = this.create_render_pipeline();
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  }

  create_render_pipeline(): GPURenderPipeline {
    return this.device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.mesh.vertex_buffer_layout],
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
  }

  // axis_mask selects which components to render
  create_pass(
    command_encoder: GPUCommandEncoder,
    render_texture: GpuRenderTexture,
    grid: GpuGrid,
    camera: GpuCamera2D,
    scale: number,
    low_colour?: GPUColorDict, high_colour?: GPUColorDict,
  ) {
    low_colour = low_colour ?? { r: 0.2, g: 0.2, b: 0.2, a: 1.0 };
    high_colour = high_colour ?? { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

    this.params.view.scale = scale;
    this.params.view.grid_size.x = grid.size.x;
    this.params.view.grid_size.y = grid.size.y;
    this.params.view.low_colour.r = low_colour.r;
    this.params.view.low_colour.g = low_colour.g;
    this.params.view.low_colour.b = low_colour.b;
    this.params.view.low_colour.a = low_colour.a;
    this.params.view.high_colour.r = high_colour.r;
    this.params.view.high_colour.g = high_colour.g;
    this.params.view.high_colour.b = high_colour.b;
    this.params.view.high_colour.a = high_colour.a;
    this.params.write_to_gpu();

    const total_instances = grid.size.x*grid.size.y;
    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer, offset: 0, size: buffer.size };
    };
    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu_buffer) },
        { binding: 2, resource: bind_gpu_buffer(grid.x.data) },
        { binding: 3, resource: bind_gpu_buffer(grid.y.data) },
        { binding: 4, resource: bind_gpu_buffer(grid.ex_field.data) },
        { binding: 5, resource: bind_gpu_buffer(grid.ey_field.data) },
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
    render_pass.setPipeline(this.render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.mesh.vertex_buffer);
    render_pass.setIndexBuffer(this.mesh.index_buffer, this.mesh.index_format);
    render_pass.drawIndexed(this.mesh.total_indices, total_instances);
    render_pass.end();
    return render_pass;
  }
}
