import { type Axis3D, type Vec3 } from "../../utility/dim_types";
import { type GpuRenderTexture, type GpuMesh, GpuUniform, create_square_mesh } from "../common.ts";
import { NdGpuArray } from "../common.ts";
import shader_wgsl from "./shader_render_cross_section.wgsl?raw";

export type DataMode = "node" | "face";

function data_mode_to_enum_value(mode: DataMode): number {
  switch (mode) {
  case "node": return 0;
  case "face": return 1;
  }
}

function axis_mode_to_enum_value(mode: Axis3D): number {
  switch (mode) {
  case "x": return 0;
  case "y": return 1;
  case "z": return 2;
  }
}

export interface CrossSection {
  grid_size: Vec3<number>;
  axis_0: NdGpuArray;
  axis_1: NdGpuArray;
  axis_2_slice: number;
  axis_2: Axis3D,
  data: NdGpuArray;
  data_mode: DataMode;
  scale: number;
  zoom: number;
}

export class ShaderRenderCrossSection {
  label: string;
  device: GPUDevice;
  params: GpuUniform<{
    scale: "f32",
    size_x: "u32",
    size_y: "u32",
    size_z: "u32",
    clear_colour: ["f32", "f32", "f32", "f32"],
    mask_colour: ["f32", "f32", "f32", "f32"],
    axis_2_slice: "u32",
    zoom: "f32",
    _pad: ["u32", "u32"],
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
      axis_2_slice: "u32",
      zoom: "f32",
      _pad: ["u32", "u32"],
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
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.mask_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  }

  get_render_pipeline(data_mode: DataMode, axis_mode: Axis3D): GPURenderPipeline {
    const key = `${data_mode}_${axis_mode}`;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;
    const constants = {
      "data_mode": data_mode_to_enum_value(data_mode),
      "axis_mode": axis_mode_to_enum_value(axis_mode),
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
    cross_section: CrossSection,
  ) {
    this.params.cpu.set("zoom", cross_section.zoom);
    this.params.cpu.set("scale", cross_section.scale);
    this.params.cpu.set("size_x", cross_section.grid_size.x);
    this.params.cpu.set("size_y", cross_section.grid_size.y);
    this.params.cpu.set("size_z", cross_section.grid_size.z);
    const rgba_to_array = (colour: GPUColorDict) => [colour.r, colour.g, colour.b, colour.a];
    this.params.cpu.set_array("clear_colour", rgba_to_array(this.clear_colour));
    this.params.cpu.set_array("mask_colour", rgba_to_array(this.mask_colour));
    this.params.cpu.set("axis_2_slice", cross_section.axis_2_slice);
    this.params.write_to_gpu();

    const get_total_instances = (data_mode: DataMode) => {
      const size = cross_section.grid_size;
      switch (data_mode) {
      case "face": return size.x*size.y;
      case "node": return (size.x+1)*(size.y+1);
      }
    };
    const total_instances = get_total_instances(cross_section.data_mode);

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu) },
        { binding: 1, resource: bind_gpu_buffer(cross_section.axis_0.data) },
        { binding: 2, resource: bind_gpu_buffer(cross_section.axis_1.data) },
        { binding: 3, resource: bind_gpu_buffer(cross_section.data.data) },
      ],
    });
    const pipeline = this.get_render_pipeline(cross_section.data_mode, cross_section.axis_2);
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
