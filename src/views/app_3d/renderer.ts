import { ComputeCopyToTexture } from "../../wgpu_kernels/view_3d/index.ts";
import { ShaderComponentViewer } from "../../wgpu_kernels/view_2d/index.ts";
import { GpuGrid } from "./grid.ts";

export type AxisDisplayMode = "x" | "y" | "z";
export type FieldDisplayMode = "e_field" | "h_field";

export class Renderer {
  adapter: GPUAdapter;
  device: GPUDevice;

  display_texture?: GPUTexture;
  display_texture_view?: GPUTextureView;
  display_size?: { x: number, y: number };

  kernel_copy_to_texture: ComputeCopyToTexture;
  shader_component_viewer: ShaderComponentViewer;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;

    const texture_copy_workgroup_size = { x: 16, y: 16 };
    this.kernel_copy_to_texture = new ComputeCopyToTexture(texture_copy_workgroup_size, device);
    this.shader_component_viewer = new ShaderComponentViewer(device);
  }

  _update_texture(display_size: { x: number, y: number }) {
    this.display_size = display_size;
    const { x: Nx, y: Ny } = display_size;

    this.display_texture = this.device.createTexture({
      dimension: "2d",
      format: "r32float",
      mipLevelCount: 1,
      sampleCount: 1,
      size: [Nx, Ny, 1],
      usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.display_texture_view = this.display_texture.createView({ dimension: "2d" });
  }

  upload_slice(command_encoder: GPUCommandEncoder, grid: GpuGrid, copy_z: number, field_mode: FieldDisplayMode, axis_mode: AxisDisplayMode) {
    const get_buffer = (field_mode: FieldDisplayMode, axis_mode: AxisDisplayMode) => {
      switch (field_mode) {
        case "e_field": {
          switch (axis_mode) {
            case "x": return grid.E.x;
            case "y": return grid.E.y;
            case "z": return grid.E.z;
          }
          break;
        }
        case "h_field": {
          switch (axis_mode) {
            case "x": return grid.H.x;
            case "y": return grid.H.y;
            case "z": return grid.H.z;
          }
          break;
        }
      }
    };


    const buffer = get_buffer(field_mode, axis_mode);
    const [Nz, Ny, Nx] = buffer.shape;
    const display_size = { x: Nx, y: Ny };
    if (copy_z < 0 || copy_z >= Nz) {
      throw Error(`Attempting to copy z slice (${copy_z}) outside of 3D grid with shape {x:${Nx},y:${Ny},z:${Nz}}`);
    }
    if (this.display_size === undefined || this.display_size.x != Nx || this.display_size.y != Ny) {
      this._update_texture(display_size);
    }
    if (this.display_texture_view === undefined) return;

    this.kernel_copy_to_texture.create_pass(
      command_encoder,
      buffer, this.display_texture_view,
      copy_z,
    );
  }

  update_display(
    command_encoder: GPUCommandEncoder,
    canvas_context: GPUCanvasContext, canvas_size: { width: number, height: number },
    scale: number,
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
    const axis_mode = 1 << 0;
    const mask_mode = 0;
    this.shader_component_viewer.create_pass(
      command_encoder,
      canvas_texture_view, this.display_texture_view,
      canvas_size,
      scale,
      axis_mode,
      mask_mode,
      "single_component",
    );
  }
}
