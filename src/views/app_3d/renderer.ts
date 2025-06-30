import { ComputeCopyToTexture } from "../../wgpu_kernels/view_3d/index.ts";
import { ShaderComponentViewer } from "../../wgpu_kernels/view_2d/index.ts";
import { GpuGrid } from "./grid.ts";

export type GridDisplayMode = "x" | "y" | "z" | "mag";
export type FieldDisplayMode = "e_field" | "h_field";

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;

  display_texture?: GPUTexture;
  display_texture_view?: GPUTextureView;
  display_size?: [number, number];

  kernel_copy_to_texture: ComputeCopyToTexture;
  shader_component_viewer: ShaderComponentViewer;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;

    const texture_copy_workgroup_size: [number, number] = [1, 256];
    this.kernel_copy_to_texture = new ComputeCopyToTexture(texture_copy_workgroup_size, device);
    this.shader_component_viewer = new ShaderComponentViewer(device);

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

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: { width: number, height: number },
    scale: number, axis_mode: GridDisplayMode,
  ) {
    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    if (this.display_texture_view === undefined) {
      throw Error(`Attempted to update render texture without perform an initial upload`);
    }

    // NOTE: canvas texture view has to be retrieved here since the browser swaps it out in the swapchain
    const canvas_texture_view = canvas_context.getCurrentTexture().createView();
    switch (axis_mode) {
      case "x": {
        this.shader_component_viewer.create_pass(
          command_encoder,
          canvas_texture_view, this.display_texture_view,
          canvas_size,
          scale, 1, "single_component",
        );
        break;
      }
      case "y": {
        this.shader_component_viewer.create_pass(
          command_encoder,
          canvas_texture_view, this.display_texture_view,
          canvas_size,
          scale, 2, "single_component",
        );
        break;
      }
      case "z": {
        this.shader_component_viewer.create_pass(
          command_encoder,
          canvas_texture_view, this.display_texture_view,
          canvas_size,
          scale, 4, "single_component",
        );
        break;
      }
      case "mag": {
        this.shader_component_viewer.create_pass(
          command_encoder,
          canvas_texture_view, this.display_texture_view,
          canvas_size,
          scale, (1 | 2 | 4), "magnitude",
        );
        break;
      }
    }
  }
}
