import { GpuCamera2D, type GpuRenderTexture } from "../../utility/gpu_common.ts";
import { AXES_2D, type Vec2 } from "../../utility/dim_types.ts";
import { GpuGrid } from "./grid.ts";
import { ShaderRenderComponent, type DataMode } from "./shader_render_component.ts";
import { ShaderRenderLines2D, Params as GraphLineParams } from "../graph/shader_lines_2d.ts";

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;
  shader_render_component: ShaderRenderComponent;
  shader_render_lines_2d: ShaderRenderLines2D;
  camera: GpuCamera2D;
  graph_line_params: Vec2<GraphLineParams>;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.shader_render_component = new ShaderRenderComponent(device);
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
    data_mode: DataMode,
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

    this.shader_render_component.clear_colour = clear_colour;
    this.shader_render_component.mask_colour = mask_colour;
    this.shader_render_component.create_pass(command_encoder, render_texture, grid, this.camera, data_mode, z_slice, scale);

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
