import * as cstruct from "../../utility/cstruct.ts";
import { type Axis3D } from "../../utility/dim_types.ts";
import { type GpuRenderTexture, type GpuMesh, create_square_mesh, GpuCamera2D, NdGpuArray } from "../../utility/gpu_common.ts";
import { GpuGrid } from "./grid.ts";
import shader_render_component_wgsl from "./shader_render_component.wgsl?raw";

type ComponentMode =
  { type: "edge" | "face", axis: Axis3D } |
  { type: "cell" };

type ColourMode = "positive_negative" | "inverse_positive" | "positive";

export type DataMode =
  { type: "V" | "I" | "R" | "C" | "L" | "alpha" | "beta" | "phi", axis: Axis3D } |
  { type: "epsilon_r" | "mu_r" | "sigma_k" };

function component_mode_to_enum_value(mode: ComponentMode): number {
  const get_axis_value = (axis: Axis3D): number => {
    switch (axis) {
    case "x": return 0;
    case "y": return 1;
    case "z": return 2;
    }
  }
  switch (mode.type) {
  case "edge": return get_axis_value(mode.axis) + 0;
  case "face": return get_axis_value(mode.axis) + 3;
  case "cell": return 6;
  }
}

function colour_mode_to_enum_value(mode: ColourMode): number {
  switch (mode) {
  case "positive_negative": return 0;
  case "inverse_positive": return 1;
  case "positive": return 2;
  }
}

function data_mode_to_component_mode(mode: DataMode): ComponentMode {
  const get_component = (type: "edge" | "face", axis: Axis3D) => {
    return { type, axis };
  };
  switch (mode.type) {
  case "V": return get_component("edge", mode.axis);
  case "I": return get_component("face", mode.axis);
  case "R": return get_component("edge", mode.axis);
  case "C": return get_component("edge", mode.axis);
  case "L": return get_component("face", mode.axis);
  case "alpha": return get_component("edge", mode.axis);
  case "beta": return get_component("edge", mode.axis);
  case "phi": return get_component("face", mode.axis);
  case "epsilon_r": return { type: "cell" };
  case "mu_r": return { type: "cell" };
  case "sigma_k": return { type: "cell" };
  }
}

function data_mode_to_colour_mode(mode: DataMode): ColourMode {
  switch (mode.type) {
  case "V": return "positive_negative";
  case "I": return "positive_negative";
  case "R": return "inverse_positive";
  case "C": return "positive";
  case "L": return "positive";
  case "alpha": return "positive";
  case "beta": return "positive";
  case "phi": return "positive";
  case "epsilon_r": return "positive";
  case "mu_r": return "positive";
  case "sigma_k": return "positive";
  }
}

export function get_data_from_grid(grid: GpuGrid, mode: DataMode): NdGpuArray {
  switch (mode.type) {
  case "V": return grid.V[mode.axis];
  case "I": return grid.I[mode.axis];
  case "R": return grid.bake_R[mode.axis];
  case "C": return grid.bake_C[mode.axis];
  case "L": return grid.bake_L[mode.axis];
  case "alpha": return grid.bake_alpha[mode.axis];
  case "beta": return grid.bake_beta[mode.axis];
  case "phi": return grid.bake_phi[mode.axis];
  case "epsilon_r": return grid.epsilon_r;
  case "mu_r": return grid.mu_r;
  case "sigma_k": return grid.sigma_k;
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
    this.mask_colour = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
  }

  get_render_pipeline(data_mode: DataMode): GPURenderPipeline {
    const component_mode = data_mode_to_component_mode(data_mode);
    const colour_mode = data_mode_to_colour_mode(data_mode);
    const component_mode_to_string = () => {
      if (component_mode.type === "cell") return "cell";
      return `${component_mode.type}_${component_mode.axis}`;
    };
    const key = `${component_mode_to_string()}_${colour_mode}`;
    let pipeline = this.render_pipelines.get(key);
    if (pipeline !== undefined) return pipeline;
    pipeline = this.device.createRenderPipeline({
      vertex: {
        module: this.shader_module,
        entryPoint: "vertex_main",
        buffers: [this.mesh.vertex_buffer_layout],
        constants: {
          "component_mode": component_mode_to_enum_value(component_mode),
        }
      },
      fragment: {
        module: this.shader_module,
        entryPoint: "fragment_main",
        constants: {
          "colour_mode": colour_mode_to_enum_value(colour_mode),
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
