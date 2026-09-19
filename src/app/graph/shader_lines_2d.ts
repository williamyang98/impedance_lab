import shader_wgsl from "./shader_lines_2d.wgsl?raw";
import { type GpuRenderTexture, type GpuMesh, GpuUniform, create_square_mesh, NdGpuArray, GpuCamera2D } from "../../utility/gpu_common.ts";
import type { Axis2D } from "../../utility/dim_types.ts";

function get_axis_mode_value(axis_mode: Axis2D): number {
  switch (axis_mode) {
  case "x": return 0;
  case "y": return 1;
  }
}

export class ShaderRenderLines2D {
  label: string;
  device: GPUDevice;
  params: GpuUniform<{
    colour: ["f32", "f32", "f32", "f32"],
    thickness: "f32",
    depth: "f32",
    _pad_0: "u32",
    _pad_1: "u32",
  }>;
  shader_source: string;
  shader_module: GPUShaderModule;
  bind_group_layout: GPUBindGroupLayout;
  pipeline_layout: GPUPipelineLayout;
  render_pipelines = new Map<Axis2D, GPURenderPipeline>;
  mesh: GpuMesh;
  clear_colour: GPUColorDict;

  constructor(device: GPUDevice) {
    this.device = device;
    this.label = "electrostatic_3d_shader";
    const params = new GpuUniform(device, {
      colour: ["f32", "f32", "f32", "f32"],
      thickness: "f32",
      depth: "f32",
      _pad_0: "u32",
      _pad_1: "u32",
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
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    this.pipeline_layout = device.createPipelineLayout({
      bindGroupLayouts: [this.bind_group_layout],
    });
    this.clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
  }

  get_render_pipeline(axis_mode: Axis2D): GPURenderPipeline {
    const key = axis_mode;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;
    const constants = {
      "axis_mode": get_axis_mode_value(axis_mode),
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
    lines: NdGpuArray,
    colour: { r: number, g: number, b: number, a: number },
    axis_mode: Axis2D,
    camera: GpuCamera2D,
    thickness: number,
    depth: number,
  ) {
    if (lines.shape.length !== 1) {
      throw Error(`Expected lines array to be 1 dimensional but got shape [${lines.shape.join(',')}]`);
    }
    const total_lines = lines.shape[0];

    this.params.cpu.set_array("colour", [colour.r, colour.g, colour.b, colour.a]);
    this.params.cpu.set("thickness", thickness);
    this.params.cpu.set("depth", depth);
    this.params.write_to_gpu();

    const bind_gpu_buffer = (buffer: GPUBuffer) => {
      return { buffer: buffer, offset: 0, size: buffer.size };
    };

    const bind_group = this.device.createBindGroup({
      layout: this.bind_group_layout,
      entries: [
        { binding: 0, resource: bind_gpu_buffer(this.params.gpu) },
        { binding: 1, resource: bind_gpu_buffer(camera.gpu) },
        { binding: 2, resource: bind_gpu_buffer(lines.data) },
      ],
    });
    const render_pass = command_encoder.beginRenderPass({
      colorAttachments: [
        {
          // clearValue: this.clear_colour,
          // loadOp: "clear",
          loadOp: "load",
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
    const render_pipeline = this.get_render_pipeline(axis_mode);
    render_pass.setPipeline(render_pipeline);
    render_pass.setBindGroup(0, bind_group);
    render_pass.setVertexBuffer(0, this.mesh.vertex_buffer);
    render_pass.setIndexBuffer(this.mesh.index_buffer, this.mesh.index_format);
    render_pass.drawIndexed(this.mesh.total_indices, total_lines);
    render_pass.end();
    return render_pass;
  }
}
