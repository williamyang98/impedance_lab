import type { GpuGrid } from "../../app/electrostatic_3d/grid";
import type { Vec2 } from "../../utility/dim_types";
import type { GpuRenderTexture } from "../common";
import { ShaderRenderCrossSection, type CrossSection } from "./shader_render_cross_section";
import { ShaderRenderLines2D } from "../graph/shader_lines_2d";

export class Renderer {
  device: GPUDevice;
  shader_render_cross_section: ShaderRenderCrossSection;
  shader_render_lines_2d: ShaderRenderLines2D;

  constructor(device: GPUDevice) {
    this.device = device;
    this.shader_render_cross_section = new ShaderRenderCrossSection(device);
    this.shader_render_lines_2d = new ShaderRenderLines2D(device);
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: Vec2<number>,
    gpu_grid: GpuGrid,
    scale: number, z_slice: number, zoom: number,
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

    const cross_section: CrossSection = {
      grid_size: gpu_grid.size,
      axis_0: gpu_grid.x,
      axis_1: gpu_grid.y,
      axis_2_slice: z_slice,
      axis_2: "z",
      data: gpu_grid.v_in,
      data_mode: "node",
      // data: gpu_grid.er,
      // data_mode: "face",
      scale: scale,
      zoom: zoom,
    };

    const clear_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    const mask_colour = { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    this.shader_render_cross_section.clear_colour = clear_colour;
    this.shader_render_cross_section.mask_colour = mask_colour;
    this.shader_render_cross_section.create_pass(command_encoder, render_texture, cross_section);
    this.shader_render_lines_2d.clear_colour = clear_colour;
    {
      const colour = { r: 1.0, g: 1.0, b: 1.0, a: 0.65 };
      const depth = 0.1;
      {
        const thickness = 3.0/render_texture.size.x;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, cross_section.axis_0, colour, "x", thickness, depth, zoom);
      }
      {
        const thickness = 3.0/render_texture.size.y;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, cross_section.axis_1, colour, "y", thickness, depth, zoom);
      }
    }
  }
}
