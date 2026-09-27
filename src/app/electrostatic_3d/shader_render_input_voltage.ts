import * as cstruct from "../../utility/cstruct.ts";
import { type Axis3D, type Vec3 } from "../../utility/dim_types";
import { type GpuRenderTexture, type GpuMesh, create_square_mesh, NdGpuArray, GpuCamera2D } from "../../utility/gpu_common.ts";
import shader_wgsl from "./shader_render_input_voltage.wgsl?raw";

export interface CrossSection {
  grid_size: Vec3<number>;
  axis_0: NdGpuArray;
  axis_1: NdGpuArray;
  axis_2_slice: number;
  axis_2: Axis3D,
  data: NdGpuArray;
  mask: NdGpuArray;
  scale: number;
  zoom: number;
}

const Params =
  cstruct.struct({
    scale: cstruct.primitive("f32"),
    size: cstruct.vector(cstruct.primitive("u32"), 3), // 16 bytes
    clear_colour: cstruct.vector(cstruct.primitive("f32"), 4), // 32 bytes
    mask_colour: cstruct.vector(cstruct.primitive("f32"), 4), // 48 bytes
    axis_2_slice: cstruct.primitive("u32"),
    _pad: cstruct.array(cstruct.primitive("u32"), 3), // 64 bytes
  })
  .layout()
  .gpu_buffer();
type Params = InstanceType<typeof Params>;

export class ShaderRenderInputVoltage {
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
  mask_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.device = device;
    this.label = "electrostatic_3d_shader";
    this.params = new Params(device);
    this.shader_source = shader_wgsl;
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
    this.mask_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.render_pipeline = this.create_render_pipeline();
  }

  create_render_pipeline(): GPURenderPipeline {
    const constants = {
    };
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
    cross_section: CrossSection,
    camera: GpuCamera2D,
  ) {
    this.params.view.scale = cross_section.scale;
    this.params.view.size.x = cross_section.grid_size.x;
    this.params.view.size.y = cross_section.grid_size.y;
    this.params.view.size.z = cross_section.grid_size.z;
    this.params.view.clear_colour.r = this.clear_colour.r;
    this.params.view.clear_colour.g = this.clear_colour.g;
    this.params.view.clear_colour.b = this.clear_colour.b;
    this.params.view.clear_colour.a = this.clear_colour.a;
    this.params.view.mask_colour.r = this.mask_colour.r;
    this.params.view.mask_colour.g = this.mask_colour.g;
    this.params.view.mask_colour.b = this.mask_colour.b;
    this.params.view.mask_colour.a = this.mask_colour.a;
    this.params.view.axis_2_slice = cross_section.axis_2_slice;
    this.params.write_to_gpu();

    const size = cross_section.grid_size;
    const total_instances = (size.x+1)*(size.y+1);

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };
    if (cross_section.mask.dtype !== "u32") {
      throw Error(`Expected dtype='u32' for mask but got ${cross_section.mask.dtype}`);
    }
    if (cross_section.data.dtype !== "f32") {
      throw Error(`Expected dtype='f32' for mask but got ${cross_section.data.dtype}`);
    }

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu_buffer) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu_buffer) },
        { binding: 2, resource: bind_gpu_buffer(cross_section.axis_0.data) },
        { binding: 3, resource: bind_gpu_buffer(cross_section.axis_1.data) },
        { binding: 4, resource: bind_gpu_buffer(cross_section.data.data) },
        { binding: 5, resource: bind_gpu_buffer(cross_section.mask.data) },
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
