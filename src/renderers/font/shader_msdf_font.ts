import { GpuUniform, type GpuRenderTexture, type GpuMesh, create_square_mesh } from "../common.ts";
import { GlyphCoords } from "./glyph_coords.ts";
import { GpuFont } from "./gpu_font.ts";
import shader_wgsl from "./shader_msdf_font.wgsl?raw";

export class ShaderMsdfFont {
  label: string;
  device: GPUDevice;
  params: GpuUniform<{
    scale: "f32",
    zoom: "f32",
    atlas_width: "f32",
    atlas_height: "f32",
    atlas_distance_range: "f32",
    _pad_0: "u32",
    _pad_1: "u32",
    _pad_2: "u32",
  }>;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipeline: GPURenderPipeline;
  mesh: GpuMesh;
  atlas_sampler: GPUSampler;
  clear_colour: GPUColorDict;
  mask_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.device = device;
    this.label = "electrostatic_3d_shader";
    const params = new GpuUniform(device, {
      scale: "f32",
      zoom: "f32",
      atlas_width: "f32",
      atlas_height: "f32",
      atlas_distance_range: "f32",
      _pad_0: "u32",
      _pad_1: "u32",
      _pad_2: "u32",
    });
    this.params = params;
    this.shader_source = shader_wgsl;
    this.shader_module = device.createShaderModule({
      code: this.shader_source,
    });
    this.mesh = create_square_mesh(device);
    this.bind_group_layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.mask_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.atlas_sampler = device.createSampler({
      magFilter: "linear", // signed distance fields are linear
      minFilter: "linear",
    });
    this.render_pipeline = this.create_render_pipeline();
  }

  create_render_pipeline(): GPURenderPipeline {
    const constants = {};
    return this.device.createRenderPipeline({
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
  }

  create_pass(
    command_encoder: GPUCommandEncoder,
    render_texture: GpuRenderTexture,
    gpu_font: GpuFont,
    glyph_coords: GlyphCoords,
    zoom: number, scale: number,
  ) {
    if (glyph_coords.gpu === undefined) {
      throw Error("Glyph coords has not been written to gpu buffer yet");
    }

    const font = gpu_font.font;
    this.params.cpu.set("zoom", zoom);
    this.params.cpu.set("scale", scale);
    this.params.cpu.set("atlas_width", font.layout.atlas.width);
    this.params.cpu.set("atlas_height", font.layout.atlas.height);
    this.params.cpu.set("atlas_distance_range", font.layout.atlas.distanceRange);
    this.params.write_to_gpu();
    const total_instances = glyph_coords.length;

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu) },
        { binding: 1, resource: this.atlas_sampler },
        { binding: 2, resource: gpu_font.atlas },
        { binding: 3, resource: bind_gpu_buffer(gpu_font.glyph_coords) },
        { binding: 4, resource: { buffer: glyph_coords.gpu, offset: 0, size: glyph_coords.byte_length } },
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
