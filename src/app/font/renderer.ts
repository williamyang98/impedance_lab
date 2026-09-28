import { type Font } from "./msdf.ts";
import { GpuFont } from "./gpu_font.ts";
import { ShaderMsdfFont, Params as MsdfFontParams } from "./shader_msdf_font.ts";
import { GpuCamera2D, type GpuRenderTexture } from "../../utility/gpu_common.ts";
import { type Vec2 } from "../../utility/dim_types.ts";
import { Printer } from "./printer.ts";

export class Renderer {
  device: GPUDevice;
  gpu_font: GpuFont;
  shader: ShaderMsdfFont;
  printer: Printer;
  camera: GpuCamera2D;
  msdf_font_params: MsdfFontParams;

  constructor(device: GPUDevice, font: Font) {
    this.device = device;
    this.gpu_font = new GpuFont(font, device);
    this.shader = new ShaderMsdfFont(device);
    this.printer = new Printer(this.gpu_font);
    this.camera = new GpuCamera2D(device);
    this.msdf_font_params = new MsdfFontParams(device);
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

    this.msdf_font_params.view.scale = scale;
    const cpu_font = this.gpu_font.font;
    this.msdf_font_params.view.atlas_width = cpu_font.layout.atlas.width;
    this.msdf_font_params.view.atlas_height = cpu_font.layout.atlas.height;
    this.msdf_font_params.view.atlas_distance_range = cpu_font.layout.atlas.distanceRange;
    this.msdf_font_params.write_to_gpu();

    const aspect_ratio = render_texture.size.x/render_texture.size.y;
    this.camera.view.aspect_ratio = aspect_ratio;
    this.camera.view.zoom = zoom;
    this.camera.view.offset.x = -1.0*aspect_ratio/zoom; // offset to top left corner
    this.camera.view.offset.y = -1.0/zoom;
    this.camera.write_to_gpu();

    this.shader.create_pass(command_encoder, render_texture, this.msdf_font_params, this.camera, this.gpu_font, this.printer.glyph_coords);
  }
}
