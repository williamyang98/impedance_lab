import { ShaderComponentViewer } from "../../wgpu_kernels/view_2d";
import { ComputeCopySliceToTexture, type Size2D } from "../../wgpu_kernels/electrostatic_3d";
import { GpuGrid } from "./grid.ts";

export type DisplayMode = "x" | "r";

export class Renderer {
  device: GPUDevice;
  kernel_copy_to_texture: ComputeCopySliceToTexture;
  shader_component_viewer: ShaderComponentViewer;
  slice?: {
    texture: GPUTexture;
    view: GPUTextureView;
    size: Size2D;
  };

  constructor(device: GPUDevice) {
    this.device = device;
    this.kernel_copy_to_texture = new ComputeCopySliceToTexture({ x: 16, y: 16 }, device);
    this.shader_component_viewer = new ShaderComponentViewer(device);
  }

  _update_slice_size(size: Size2D) {
    if (this.slice === undefined || this.slice.size.x !== size.x || this.slice.size.y !== size.y) {
      const texture = this.device.createTexture({
        dimension: "2d",
        format: "rgba16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [size.x, size.y, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      const view = texture.createView({ dimension: "2d" });
      this.slice = {
        texture,
        view,
        size,
      };
      return this.slice;
    }
    return this.slice;
  }

  upload_slice(command_encoder: GPUCommandEncoder, grid: GpuGrid, copy_z: number) {
    const slice = this._update_slice_size({ x: grid.size.x, y: grid.size.y });
    this.kernel_copy_to_texture.create_pass(
      command_encoder,
      grid.xin,
      grid.r,
      slice.view,
      grid.size,
      copy_z,
    );
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: { width: number, height: number },
    display_mode: DisplayMode, scale: number,
  ) {
    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    if (this.slice === undefined) {
      throw Error("Tried to update render texture without uploading initial slice");
    }

    // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
    const canvas_texture_view = canvas_context.getCurrentTexture().createView();
    let axis = undefined;
    switch (display_mode) {
      case "x": axis = 1; break;
      case "r": axis = 2; break;
    }

    this.shader_component_viewer.create_pass(
      command_encoder,
      canvas_texture_view, this.slice.view,
      canvas_size,
      scale, axis, "single_component",
    );
  }
}
