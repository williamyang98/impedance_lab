import { GpuCamera2D, type GpuRenderTexture } from "../../utility/gpu_common.ts";
import type { Vec2 } from "../../utility/dim_types.ts";
import { GpuGrid } from "./grid.ts";
import { ShaderRenderComponent, type DataMode as ComponentDataMode } from "./shader_render_component.ts";
import { ShaderRenderIndexBeta, type DataMode as IndexBetaDataMode, type ColourMode as IndexBetaColourMode } from "./shader_render_index_beta.ts";
import { ShaderRenderMagnitude } from "./shader_render_magnitude.ts";
import { ShaderRenderQuiver } from "./shader_render_quiver.ts";
import { ShaderRenderLines2D } from "../graph/shader_lines_2d.ts";

export type RenderMode =
  { type: "component", data: ComponentDataMode } |
  { type: "index_beta", data: IndexBetaDataMode, colour: IndexBetaColourMode } |
  { type: "magnitude" } |
  { type: "quiver" };

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;
  shader_render_component: ShaderRenderComponent;
  shader_render_index_beta: ShaderRenderIndexBeta;
  shader_render_magnitude: ShaderRenderMagnitude;
  shader_render_quiver: ShaderRenderQuiver;
  shader_render_lines_2d: ShaderRenderLines2D;
  camera: GpuCamera2D;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.shader_render_component = new ShaderRenderComponent(device);
    this.shader_render_index_beta = new ShaderRenderIndexBeta(device);
    this.shader_render_magnitude = new ShaderRenderMagnitude(device);
    this.shader_render_quiver = new ShaderRenderQuiver(device);
    this.shader_render_lines_2d = new ShaderRenderLines2D(device);
    this.camera = new GpuCamera2D(device);
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: Vec2<number>,
    grid: GpuGrid,
    mode: RenderMode,
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

    this.camera.cpu.aspect_ratio = render_texture.size.x/render_texture.size.y;
    this.camera.cpu.zoom = zoom;
    this.camera.write_to_gpu();

    switch (mode.type) {
    case "component": {
      this.shader_render_component.clear_colour = clear_colour;
      this.shader_render_component.create_pass(command_encoder, render_texture, grid, this.camera, mode.data, scale);
      break;
    }
    case "index_beta": {
      this.shader_render_index_beta.clear_colour = clear_colour;
      this.shader_render_index_beta.create_pass(command_encoder, render_texture, grid, this.camera, mode.data, mode.colour, scale);
      break;
    }
    case "magnitude": {
      this.shader_render_magnitude.clear_colour = clear_colour;
      this.shader_render_magnitude.create_pass(command_encoder, render_texture, grid, this.camera, scale);
      break;
    }
    case "quiver": {
      this.shader_render_quiver.clear_colour = clear_colour;
      this.shader_render_quiver.create_pass(command_encoder, render_texture, grid, this.camera, scale);
      break;
    }
    }

    this.shader_render_lines_2d.clear_colour = clear_colour;
    {
      const colour = { r: 1.0, g: 1.0, b: 1.0, a: 0.65 };
      const depth = 0.1;
      {
        const thickness = 2.0/render_texture.size.x;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, grid.x, colour, "x", this.camera, thickness, depth);
      }
      {
        const thickness = 2.0/render_texture.size.y;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, grid.y, colour, "y", this.camera, thickness, depth);
      }
    }
  }
}
