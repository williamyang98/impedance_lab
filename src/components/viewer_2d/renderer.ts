import { ShaderRenderTexture, type Axis } from "./kernels.ts";
import {
  Float32ModuleNdarray, Uint32ModuleNdarray, Uint16ModuleNdarray,
} from "../../utility/module_ndarray.ts";
import { Grid } from "../../engine/electrostatic_2d.ts";
import { Globals } from "../../global.ts";

export class Renderer {
  readonly module = Globals.wasm_module;

  adapter: GPUAdapter;
  device: GPUDevice;
  grid_size?: [number, number];
  v_force_texture?: GPUTexture;
  v_field_texture?: GPUTexture;
  e_field_texture?: GPUTexture;
  epsilon_texture?: GPUTexture;
  spline_dx_texture?: GPUTexture;
  spline_dy_texture?: GPUTexture;
  shader_render_texture: ShaderRenderTexture;

  constructor(adapter: GPUAdapter, device: GPUDevice) {
    this.adapter = adapter;
    this.device = device;
    this.shader_render_texture = new ShaderRenderTexture(device);
  }

  upload_grid(grid: Grid) {
    this.grid_size = grid.size;
    this._upload_v_force(grid.v_table, grid.v_index_beta);
    this._upload_v_field(grid.v_field);
    this._upload_e_field(grid.ex_field, grid.ey_field);
    this._upload_dx_spline(grid.dx);
    this._upload_dy_spline(grid.dy);
    this._upload_epsilon(grid.ek_table, grid.ek_index_beta);
  }

  _upload_v_force(v_table: Float32ModuleNdarray, v_index_beta: Uint32ModuleNdarray) {
    const shape = v_index_beta.shape;
    if (shape.length != 2) {
      throw Error(`Tried to update grid 2d renderer with non 2d array: (${shape.join(',')})`);
    }
    if (v_table.shape.length != 1) {
      throw Error(`Voltage table should be 1d but has shape: (${v_table.shape.join(',')})`);
    }
    const [height, width] = shape;
    if (
      this.v_force_texture === undefined ||
      this.v_force_texture.width != width ||
      this.v_force_texture.height != height
    ) {
      // store value/beta pairs in red/green channels
      this.v_force_texture = this.device.createTexture({
        dimension: "2d",
        format: "rg16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const f32_data = new Float32ModuleNdarray(this.module, [...shape, 2]);
    {
      const voltage_arr = f32_data.array_view;
      const v_table_arr = v_table.array_view;
      const v_index_beta_arr = v_index_beta.array_view;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const iv = x + y*width;
          const { index, beta } = Grid.unpack_index_beta(v_index_beta_arr[iv]);
          const v_value = v_table_arr[index];
          voltage_arr[2*iv+0] = v_value;
          voltage_arr[2*iv+1] = beta;
        }
      }
    }
    const f16_data = new Uint16ModuleNdarray(this.module, f32_data.shape);
    this.module.convert_f32_to_f16(f32_data, f16_data);
    this.device.queue.writeTexture(
      { texture: this.v_force_texture },
      f16_data.array_view,
      { bytesPerRow: width*2*2 },
      { width, height },
    );
    f16_data.delete();
    f32_data.delete();
  }

  _upload_v_field(v_field: Float32ModuleNdarray) {
    const shape = v_field.shape;
    if (shape.length != 2) {
      throw Error(`Tried to update grid 2d renderer with non 2d array: (${shape.join(',')})`);
    }
    const [height, width] = shape;
    if (
      this.v_field_texture === undefined ||
      this.v_field_texture.width != width ||
      this.v_field_texture.height != height
    ) {
      this.v_field_texture = this.device.createTexture({
        dimension: "2d",
        format: "r16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const f16_data = new Uint16ModuleNdarray(this.module, shape);
    this.module.convert_f32_to_f16(v_field, f16_data);
    this.device.queue.writeTexture(
      { texture: this.v_field_texture },
      f16_data.array_view,
      { bytesPerRow: width*2 },
      { width, height },
    );
    f16_data.delete();
  }

  _upload_epsilon(ek_table: Float32ModuleNdarray, ek_index_beta: Uint32ModuleNdarray) {
    const shape = ek_index_beta.shape;
    if (shape.length != 2) {
      throw Error(`Tried to update grid 2d renderer with non 2d array: (${shape.join(',')})`);
    }
    const [height, width] = shape;
    if (
      this.epsilon_texture === undefined ||
      this.epsilon_texture.width != width ||
      this.epsilon_texture.height != height
    ) {
      this.epsilon_texture = this.device.createTexture({
        dimension: "2d",
        format: "rg16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const f32_data = new Float32ModuleNdarray(this.module, [...shape, 2]);
    {
      const ek_table_arr = ek_table.array_view;
      const ek_index_beta_arr = ek_index_beta.array_view;
      const epsilon_arr = f32_data.array_view;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const iv = x + y*width;
          const { index, beta } = Grid.unpack_index_beta(ek_index_beta_arr[iv]);
          const er_value = ek_table_arr[index];
          epsilon_arr[2*iv+0] = er_value;
          epsilon_arr[2*iv+1] = beta;
        }
      }
    }
    const f16_data = new Uint16ModuleNdarray(this.module, f32_data.shape);
    this.module.convert_f32_to_f16(f32_data, f16_data);
    this.device.queue.writeTexture(
      { texture: this.epsilon_texture },
      f16_data.array_view,
      { bytesPerRow: width*2*2 },
      { width, height },
    );
    f16_data.delete();
    f32_data.delete();
  }

  _upload_e_field(ex_field: Float32ModuleNdarray, ey_field: Float32ModuleNdarray) {
    const Nx = ex_field.shape[1];
    const Ny = ey_field.shape[0];
    const height = Ny;
    const width = Nx;
    if (
      this.e_field_texture === undefined ||
      this.e_field_texture.width != width ||
      this.e_field_texture.height != height
    ) {
      this.e_field_texture = this.device.createTexture({
        dimension: "2d",
        format: "rg16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    const shape = [Ny,Nx,2];
    const f32_data = new Float32ModuleNdarray(this.module, shape);
    {
      const ex_buf = ex_field.array_view;
      const ey_buf = ey_field.array_view;
      const e_buf = f32_data.array_view;
      for (let y = 0; y < Ny; y++) {
        for (let x = 0; x < Nx; x++) {
          const iex = x + y*Nx;
          const iey = x + y*(Nx+1);
          const ie = 2*(x + y*Nx);
          e_buf[ie+0] = ex_buf[iex];
          e_buf[ie+1] = ey_buf[iey];
        }
      }
    }
    const f16_data = new Uint16ModuleNdarray(this.module, shape);
    this.module.convert_f32_to_f16(f32_data, f16_data);
    this.device.queue.writeTexture(
      { texture: this.e_field_texture },
      f16_data.array_view,
      { bytesPerRow: width*2*2 },
      { width, height },
    );
    f16_data.delete();
    f32_data.delete();
  }

  _upload_dy_spline(dy: Float32ModuleNdarray) {
    if (dy.shape.length != 1) {
      throw Error(`dy spline array should be 1 dimensional but got: (${dy.shape.join(',')})`);
    }

    const height: number = dy.shape[0];

    if (
      this.spline_dy_texture === undefined ||
      this.spline_dy_texture.width != height
    ) {
      this.spline_dy_texture = this.device.createTexture({
        dimension: "2d",
        format: "r16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [height, 1, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    const f16_data = new Uint16ModuleNdarray(this.module, dy.shape);
    this.module.convert_f32_to_f16(dy, f16_data);
    this.device.queue.writeTexture(
      { texture: this.spline_dy_texture },
      f16_data.array_view,
      { bytesPerRow: height*2 },
      { width: height, height: 1 },
    );
    f16_data.delete();
  }

  _upload_dx_spline(dx: Float32ModuleNdarray) {
    if (dx.shape.length != 1) {
      throw Error(`dx spline array should be 1 dimensional but got: (${dx.shape.join(',')})`);
    }

    const width: number = dx.shape[0];

    if (
      this.spline_dx_texture === undefined ||
      this.spline_dx_texture.width != width
    ) {
      this.spline_dx_texture = this.device.createTexture({
        dimension: "2d",
        format: "r16float",
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, 1, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    const f16_data = new Uint16ModuleNdarray(this.module, dx.shape);
    this.module.convert_f32_to_f16(dx, f16_data);
    this.device.queue.writeTexture(
      { texture: this.spline_dx_texture },
      f16_data.array_view,
      { bytesPerRow: width*2 },
      { width, height: 1 },
    );
    f16_data.delete();
  }

  update_canvas(canvas_context: GPUCanvasContext, scale: number, axis: Axis) {
    if (this.grid_size === undefined) return;
    if (this.v_field_texture === undefined) return;
    if (this.e_field_texture === undefined) return;
    if (this.spline_dx_texture === undefined) return;
    if (this.spline_dy_texture === undefined) return;
    if (this.v_force_texture === undefined) return;
    if (this.epsilon_texture === undefined) return;

    canvas_context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: "premultiplied",
    });
    const canvas_size: [number, number] = [canvas_context.canvas.height, canvas_context.canvas.width];

    const canvas_texture_view = canvas_context.getCurrentTexture().createView();
    const command_encoder = this.device.createCommandEncoder();
    const v_field_view = this.v_field_texture.createView({ dimension: "2d" });
    const e_field_view = this.e_field_texture.createView({ dimension: "2d" });
    const spline_dx_view = this.spline_dx_texture.createView({ dimension: "2d" });
    const spline_dy_view = this.spline_dy_texture.createView({ dimension: "2d" });
    const v_force_view = this.v_force_texture.createView({ dimension: "2d" });
    const epsilon_view = this.epsilon_texture.createView({ dimension: "2d" });
    this.shader_render_texture.create_pass(
      command_encoder,
      canvas_texture_view, v_field_view, e_field_view, spline_dx_view, spline_dy_view, v_force_view, epsilon_view,
      this.grid_size, canvas_size, scale, axis,
    );
    this.device.queue.submit([command_encoder.finish()]);
  }

  async wait_finished() {
    await this.device.queue.onSubmittedWorkDone();
  }
}
