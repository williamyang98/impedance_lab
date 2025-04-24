import { ShaderRenderTexture } from "./kernels.ts";
import { Ndarray } from "../../utility/ndarray.ts";
import { Grid } from "../../engine/electrostatic_2d.ts";
import { convert_f32_to_f16 } from "../../utility/convert_f32_to_f16.ts";

export class WebgpuGrid2dRenderer {
  adapter: GPUAdapter;
  device: GPUDevice;
  display_texture?: GPUTexture;
  spline_dx_texture?: GPUTexture;
  spline_dy_texture?: GPUTexture;
  shader_render_texture: ShaderRenderTexture;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.shader_render_texture = new ShaderRenderTexture(device);
  }

  upload_grid(grid: Grid) {
    this._upload_texture(grid.e_field);
    this._upload_dx_spline(grid.dx);
    this._upload_dy_spline(grid.dy);
  }

  _upload_texture(data: Ndarray) {
    // TODO: Figure out best way of switching between v-field, e-field, energy normalised,
    //       and grid normalised view (dx, dy lut for coordinate warping to better reflect real shape)
    const shape = data.shape;
    if (shape.length != 3) {
      throw Error(`Tried to update grid 2d renderer with non 3d array: (${shape.join(',')})`);
    }
    const [height, width, channels] = shape;
    if (channels != 2) {
      throw Error(`Expected 2 channels but got ${channels} channels`);
    }
    if (
      this.display_texture === undefined ||
      this.display_texture.width != width ||
      this.display_texture.height != height
    ) {
      this.display_texture = this.device.createTexture({
        dimension: "2d",
        format: "rg16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const N = width*height*channels;
    const f32_data = data.cast(Float32Array);
    const f16_data = new Uint16Array(N);
    convert_f32_to_f16(f32_data, f16_data);
    this.device.queue.writeTexture(
      { texture: this.display_texture },
      f16_data,
      { bytesPerRow: width*(2*channels) },
      { width, height },
    );
  }

  _upload_dy_spline(dy: Ndarray) {
    if (dy.shape.length != 1) {
      throw Error(`dy spline array should be 1 dimensional but got: (${dy.shape.join(',')})`);
    }

    const height: number = dy.shape[0];

    if (
      this.spline_dy_texture === undefined ||
      this.spline_dy_texture.width != height
    ) {
      this.spline_dy_texture = this.device.createTexture({
        dimension: "1d",
        format: "r16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [height, 1, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    const f32_dy = dy.cast(Float32Array);
    const f16_dy = new Uint16Array(height);
    convert_f32_to_f16(f32_dy, f16_dy);
    this.device.queue.writeTexture(
      { texture: this.spline_dy_texture },
      f16_dy,
      { bytesPerRow: height*2 },
      { width: height, height: 1 },
    );
  }

  _upload_dx_spline(dx: Ndarray) {
    if (dx.shape.length != 1) {
      throw Error(`dx spline array should be 1 dimensional but got: (${dx.shape.join(',')})`);
    }

    const width: number = dx.shape[0];

    if (
      this.spline_dx_texture === undefined ||
      this.spline_dx_texture.width != width
    ) {
      this.spline_dx_texture = this.device.createTexture({
        dimension: "1d",
        format: "r16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, 1, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    const f32_dx = dx.cast(Float32Array);
    const f16_dx = new Uint16Array(width);
    convert_f32_to_f16(f32_dx, f16_dx);
    this.device.queue.writeTexture(
      { texture: this.spline_dx_texture },
      f16_dx,
      { bytesPerRow: width*2 },
      { width, height: 1 },
    );
  }

  update_canvas(canvas: HTMLCanvasElement, scale: number, axis: number) {
    if (this.display_texture === undefined) return;
    if (this.spline_dx_texture === undefined) return;
    if (this.spline_dy_texture === undefined) return;

    const canvas_context: GPUCanvasContext | null = canvas.getContext("webgpu");
    if (canvas_context === null) {
      throw Error("Failed to get webgpu context from canvas");
    }
    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });

    const canvas_texture_view = canvas_context.getCurrentTexture().createView();
    const command_encoder = this.device.createCommandEncoder();
    const display_texture_view = this.display_texture.createView({ dimension: "2d" });
    const spline_dx_view = this.spline_dx_texture.createView({ dimension: "1d" });
    const spline_dy_view = this.spline_dy_texture.createView({ dimension: "1d" });
    this.shader_render_texture.create_pass(
      command_encoder,
      canvas_texture_view, display_texture_view, spline_dx_view, spline_dy_view,
      scale, axis,
    );
    this.device.queue.submit([command_encoder.finish()]);
  }

  async wait_finished() {
    await this.device.queue.onSubmittedWorkDone();
  }
}

export function cpu_render_grid_to_canvas(canvas: HTMLCanvasElement, grid: Grid) {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw Error("Failed to retrieve 2d context from canvas");
  }
  const [Ny, Nx] = grid.size;
  canvas.width = Nx;
  canvas.height = Ny;

  const image_data = context.createImageData(Nx, Ny);

  const data = Ndarray.create_zeros([Ny,Nx], "f32");
  const { v_field, e_field, dx, dy } = grid;
  for (let y = 0; y < Ny; y++) {
    for (let x = 0; x < Nx; x++) {
      const _v = v_field.get([y,x]);
      const ex = e_field.get([y,x,0]);
      const ey = e_field.get([y,x,1]);
      const dx_avg = (dx.get([Math.max(x-1,0)]) + dx.get([x]))/2.0;
      const dy_avg = (dy.get([Math.max(y-1,0)]) + dy.get([y]))/2.0;
      // e-field lies on boundary of yee-grid
      const energy = (ex**2)*dx.get([x])*dy_avg + (ey**2)*dy.get([y])*dx_avg;
      // const energy = ey*dy.get([y])*dx_avg;
      // const energy = ex*dx.get([x])*dy_avg;
      // const energy = ey;
      // const energy = ex;
      data.set([y,x], energy);
    }
  }
  const data_max = data.cast(Float32Array).map(Math.abs).reduce((a,b) => Math.max(a,b), 0.0);
  for (let y = 0; y < Ny; y++) {
    for (let x = 0; x < Nx; x++) {
      const i_image = 4*(x + y*Nx);
      const d = data.get([y,x]);
      const scale = 255/data_max;
      const value = Math.min(Math.round(d*scale), 255);
      const r = value;
      const g = value;
      const b = value;
      // const r = Math.min(Math.round(d*scale), 255);
      // const g = Math.min(Math.round(-d*scale), 255);
      // const b = 0;
      const a = 255;
      image_data.data[i_image+0] = r;
      image_data.data[i_image+1] = g;
      image_data.data[i_image+2] = b;
      image_data.data[i_image+3] = a;
    }
  }
  context.putImageData(image_data, 0, 0);

}
