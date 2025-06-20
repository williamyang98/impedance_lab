import { KernelCopyToTexture, ShaderRenderTexture } from "./kernels.ts";
import { GpuGrid } from "../../engine/fdtd_3d/grid.ts";

export type GridDisplayMode = "x" | "y" | "z" | "mag";
export type FieldDisplayMode = "e_field" | "h_field";

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;

  display_texture?: GPUTexture;
  display_texture_view?: GPUTextureView;
  display_size?: [number, number];

  kernel_copy_to_texture: KernelCopyToTexture;
  shader_render_texture: ShaderRenderTexture;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;

    const texture_copy_workgroup_size: [number, number] = [1, 256];
    this.kernel_copy_to_texture = new KernelCopyToTexture(texture_copy_workgroup_size, device);
    this.shader_render_texture = new ShaderRenderTexture(device);

  }

  _update_texture(display_size: [number, number]) {
    this.display_size = display_size;
    const [Ny, Nx] = display_size;

    this.display_texture = this.device.createTexture({
      dimension: "2d",
      format: "rgba16float",
      mipLevelCount: 1,
      sampleCount: 1,
      size: [Nx, Ny, 1],
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.display_texture_view = this.display_texture.createView({ dimension: "2d" });
  }

  upload_slice(command_encoder: GPUCommandEncoder, grid: GpuGrid, copy_z: number, field_mode: FieldDisplayMode) {
    const [Nz, Ny, Nx] = grid.size;
    const display_size: [number, number] = [Ny, Nx];
    if (this.display_size === undefined || this.display_size[0] != Ny || this.display_size[1] != Nx) {
      this._update_texture(display_size);
    }

    if (copy_z < 0 || copy_z >= Nz) {
      throw Error(`Attempting to copy z slice (${copy_z}) outside of 3D grid with shape (${grid.size.join(',')})`);
    }

    const get_field_buffer = (mode: FieldDisplayMode): GPUBuffer => {
      switch (mode) {
      case "e_field": return grid.e_field;
      case "h_field": return grid.h_field;
      }
    };
    const field_buffer = get_field_buffer(field_mode);
    if (this.display_texture_view === undefined) return;

    this.kernel_copy_to_texture.create_pass(
      command_encoder,
      field_buffer, this.display_texture_view, grid.size,
      copy_z,
    );
  }

  update_display(command_encoder: GPUCommandEncoder, canvas_context: GPUCanvasContext, scale: number, axis_mode: GridDisplayMode) {
    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    const get_display_id = (mode: GridDisplayMode): number => {
      switch (mode) {
      case "x": return 0;
      case "y": return 1;
      case "z": return 2;
      case "mag": return 3;
      }
    };

    const axis_id = get_display_id(axis_mode);
    if (this.display_texture_view === undefined) {
      throw Error(`Attempted to update render texture without perform an initial upload`);
    }

    // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
    const canvas_texture_view = canvas_context.getCurrentTexture().createView();
    this.shader_render_texture.create_pass(
      command_encoder,
      canvas_texture_view, this.display_texture_view,
      scale, axis_id,
    );
  }
}
