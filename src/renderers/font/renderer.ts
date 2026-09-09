import { type Font } from "./msdf.ts";
import { GpuFont } from "./gpu_font.ts";
import { ShaderMsdfFont } from "./shader_msdf_font.ts";
import { type GpuRenderTexture } from "../common.ts";
import { type Vec2 } from "../../utility/dim_types.ts";
import { Printer } from "./printer.ts";

export class Renderer {
  device: GPUDevice;
  font: GpuFont;
  shader: ShaderMsdfFont;
  printer: Printer;

  constructor(device: GPUDevice, font: Font) {
    this.device = device;
    this.font = new GpuFont(font, device);
    this.shader = new ShaderMsdfFont(device);
    this.printer = new Printer(this.font);
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: Vec2<number>,
    zoom: number, scale: number,
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

    if (this.printer.is_dirty) {
      this.printer.finish();
    }

    this.shader.create_pass(command_encoder, render_texture, this.font, this.printer.glyph_coords, zoom, scale);
  }
}
