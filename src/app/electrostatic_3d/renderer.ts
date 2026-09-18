import type { GpuGrid } from "../../app/electrostatic_3d/grid";
import type { Vec2 } from "../../utility/dim_types";
import { GpuCamera2D, type GpuRenderTexture, NdGpuArray } from "../../renderers/common.ts";
import { ShaderRenderCrossSection, type DataMode } from "./shader_render_cross_section";
import { ShaderRenderLines2D } from "../../renderers/graph/shader_lines_2d.ts";
import { ShaderRenderInputVoltage } from "./shader_render_input_voltage.ts";

export type RenderMode = "voltage" | "dielectric" | "residual" | "input";

export class Renderer {
  device: GPUDevice;
  shader_render_input_voltage: ShaderRenderInputVoltage;
  shader_render_cross_section: ShaderRenderCrossSection;
  shader_render_lines_2d: ShaderRenderLines2D;
  camera: GpuCamera2D;

  constructor(device: GPUDevice) {
    this.device = device;
    this.shader_render_cross_section = new ShaderRenderCrossSection(device);
    this.shader_render_lines_2d = new ShaderRenderLines2D(device);
    this.shader_render_input_voltage = new ShaderRenderInputVoltage(device);
    this.camera = new GpuCamera2D(device);
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: Vec2<number>,
    gpu_grid: GpuGrid,
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

    this.camera.cpu.aspect_ratio = render_texture.size.x/render_texture.size.y;
    this.camera.cpu.zoom = zoom;
    this.camera.write_to_gpu();

    if (render_mode === "input") {
      const cross_section = {
        grid_size: gpu_grid.size,
        axis_0: gpu_grid.x,
        axis_1: gpu_grid.y,
        axis_2_slice: z_slice,
        axis_2: "z" as const,
        data: gpu_grid.b,
        mask: gpu_grid.mask,
        scale: scale,
        zoom: zoom,
      };
      this.shader_render_input_voltage.clear_colour = clear_colour;
      this.shader_render_input_voltage.mask_colour = mask_colour;
      this.shader_render_input_voltage.create_pass(command_encoder, render_texture, cross_section, this.camera);
    } else {
      interface RenderModeData {
        array: NdGpuArray;
        mode: DataMode;
      }
      let data: RenderModeData | undefined = undefined;
      switch (render_mode) {
      case "voltage":  data = { array: gpu_grid.v_in, mode: "node" }; break;
      case "dielectric": data = { array: gpu_grid.er, mode: "face" }; break;
      case "residual": data = { array: gpu_grid.r, mode: "node" }; break;
      }
      const cross_section = {
        grid_size: gpu_grid.size,
        axis_0: gpu_grid.x,
        axis_1: gpu_grid.y,
        axis_2_slice: z_slice,
        axis_2: "z" as const,
        data: data.array,
        data_mode: data.mode,
        scale: scale,
        zoom: zoom,
      };
      this.shader_render_cross_section.clear_colour = clear_colour;
      this.shader_render_cross_section.mask_colour = mask_colour;
      this.shader_render_cross_section.create_pass(command_encoder, render_texture, cross_section, this.camera);
    }

    this.shader_render_lines_2d.clear_colour = clear_colour;
    {
      const colour = { r: 1.0, g: 1.0, b: 1.0, a: 0.65 };
      const depth = 0.1;
      {
        const thickness = 2.0/render_texture.size.x;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, gpu_grid.x, colour, "x", this.camera, thickness, depth);
      }
      {
        const thickness = 2.0/render_texture.size.y;
        this.shader_render_lines_2d.create_pass(command_encoder, render_texture, gpu_grid.y, colour, "y", this.camera, thickness, depth);
      }
    }
  }
}
