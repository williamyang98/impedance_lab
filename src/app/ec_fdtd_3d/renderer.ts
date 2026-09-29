import { GpuCamera2D, type GpuRenderTexture } from "../../utility/gpu_common.ts";
import { AXES_2D, type Axis3D, type Vec2 } from "../../utility/dim_types.ts";
import { GpuGrid } from "./grid.ts";
import { ShaderRenderComponent, type DataMode } from "./shader_render_component.ts";
import { ShaderRenderLines2D, Params as GraphLineParams } from "../graph/shader_lines_2d.ts";
import { ShaderRenderEdgeCurrent } from "./shader_render_edge_current.ts";

export type RenderMode = DataMode | {
  type: "I_edge",
  axis: Axis3D,
};

export function get_data_shape_from_render_mode(mode: RenderMode, grid: GpuGrid) {
  switch (mode.type) {
  case "I_edge": return grid.V[mode.axis].shape;
  case "V": return grid.V[mode.axis].shape;
  case "I": return grid.I[mode.axis].shape;
  case "R": return grid.bake_R[mode.axis].shape;
  case "C": return grid.bake_C[mode.axis].shape;
  case "L": return grid.bake_L[mode.axis].shape;
  case "alpha": return grid.bake_alpha[mode.axis].shape;
  case "beta": return grid.bake_beta[mode.axis].shape;
  case "phi": return grid.bake_phi[mode.axis].shape;
  case "epsilon_r": return grid.epsilon_r.shape;
  case "mu_r": return grid.mu_r.shape;
  case "sigma_k": return grid.sigma_k.shape;
  }
}

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;
  shader_render_component: ShaderRenderComponent;
  shader_render_edge_current: ShaderRenderEdgeCurrent;
  shader_render_lines_2d: ShaderRenderLines2D;
  camera: GpuCamera2D;
  graph_line_params: Vec2<GraphLineParams>;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.shader_render_component = new ShaderRenderComponent(device);
    this.shader_render_edge_current = new ShaderRenderEdgeCurrent(device);
    this.shader_render_lines_2d = new ShaderRenderLines2D(device);
    this.camera = new GpuCamera2D(device);
    this.graph_line_params = {
      x: new GraphLineParams(device),
      y: new GraphLineParams(device),
    };
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: Vec2<number>,
    grid: GpuGrid,
    render_mode: RenderMode,
    z_slice: number,
    scale: number, zoom: number,
  ) {
    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
    const texture = canvas_context.getCurrentTexture();
    const texture_view = texture.createView();
    const render_texture: GpuRenderTexture = {
      texture,
      texture_view,
      size: canvas_size,
    };
    const clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    const mask_colour = { r: 1.0, g: 1.0, b: 1.0, a: 0.8 };

    this.camera.view.aspect_ratio = render_texture.size.x/render_texture.size.y;
    this.camera.view.zoom = zoom;
    this.camera.write_to_gpu();

    switch (render_mode.type) {
    case "I_edge": {
      this.shader_render_edge_current.clear_colour = clear_colour;
      this.shader_render_edge_current.mask_colour = mask_colour;
      this.shader_render_edge_current.create_pass(command_encoder, render_texture, grid, this.camera, render_mode.axis, z_slice, scale);
      break;
    }
    case "V": // @fallthrough
    case "I": // @fallthrough
    case "R": // @fallthrough
    case "C": // @fallthrough
    case "L": // @fallthrough
    case "alpha": // @fallthrough
    case "beta": // @fallthrough
    case "phi": // @fallthrough
    case "epsilon_r": // @fallthrough
    case "mu_r": // @fallthrough
    case "sigma_k": {
      this.shader_render_component.clear_colour = clear_colour;
      this.shader_render_component.mask_colour = mask_colour;
      this.shader_render_component.create_pass(command_encoder, render_texture, grid, this.camera, render_mode, z_slice, scale);
      break;
    }
    }

    this.shader_render_lines_2d.clear_colour = clear_colour;
    {
      const colour = { r: 1.0, g: 1.0, b: 1.0, a: 0.65 };
      const depth = 0.1;
      for (const axis of AXES_2D) {
        const grid_lines = grid.grid_lines[axis];
        const params = this.graph_line_params[axis];
        const thickness = 2.0/render_texture.size[axis];
        params.view.colour.r = colour.r;
        params.view.colour.g = colour.g;
        params.view.colour.b = colour.b;
        params.view.colour.a = colour.a;
        params.view.depth = depth;
        params.view.thickness = thickness;
        params.write_to_gpu();
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, grid_lines, axis, this.camera, params);
      }
    }
  }
}
