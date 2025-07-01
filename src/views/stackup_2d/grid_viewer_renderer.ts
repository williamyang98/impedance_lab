import {
  Float32ModuleNdarray, Uint32ModuleNdarray, Uint16ModuleNdarray,
  type IModuleNdarray,
} from "../../utility/module_ndarray.ts";
import { Ndarray } from "../../utility/ndarray.ts";
import { Grid } from "./electrostatic_2d.ts";
import {
  ShaderComponentViewer, ShaderQuiverGrid, ShaderIndexBeta,
  type IndexBetaMode,
} from "../../wgpu_kernels/view_2d/index.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";

const assert = {
  texture_size(texture: GPUTexture, width: number, height: number) {
    if (texture.width === width && texture.height === height) return;
    throw Error(`Mismatching texture size, got: [${texture.width},${texture.height}], expected [${width},${height}]`);
  },
  texture_format(texture: GPUTexture, format: GPUTextureFormat) {
    if (texture.format === format) return;
    throw Error(`Mismatching texture format, got: ${texture.format}, expected ${format}`);
  },
  texture(texture: GPUTexture, width: number, height: number, format: GPUTextureFormat) {
    this.texture_size(texture, width, height);
    this.texture_format(texture, format);
  },
  array_dim(arr: IModuleNdarray, total_dims: number) {
    if (arr.shape.length === total_dims) return;
    throw Error(`Unexpected array dimensionality, got: ${arr.shape.length}, expected: ${total_dims}`);
  },
  array_shape(arr: IModuleNdarray, shape: (number | undefined)[]) {
    function shape_str(): string[] {
      return shape.map(x => x === undefined ? '?' : `${x}`);
    }
    if (arr.shape.length !== shape.length) {
      throw Error(`Unexpected array dimensionality, got: [${arr.shape.join(',')}], expected: ${shape_str().join(',')}`);
    }
    for (let i = 0; i < arr.shape.length; i++) {
      if (arr.shape[i] !== shape[i]) {
        throw Error(`Unexpected array shape, got: [${arr.shape.join(',')}], expected: ${shape_str().join(',')}`);
      }
    }
  },
}

const upload_texture = {
  index_beta: (gpu_device: GPUDevice, texture: GPUTexture, table: Float32ModuleNdarray, index_beta: Uint32ModuleNdarray) => {
    assert.array_dim(index_beta, 2);
    assert.array_dim(table, 1);

    const shape = index_beta.shape;
    const [height, width] = shape;
    assert.texture(texture, width, height, "rg16float"); // store value/beta pairs in red/green channels

    const module = table.module;
    const total_channels = 2;
    const sizeof_f16 = 2;
    const f32_data = Float32ModuleNdarray.from_shape(module, [...shape, total_channels]);
    {
      const data_arr = f32_data.array_view;
      const table_arr = table.array_view;
      const index_beta_arr = index_beta.array_view;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const iv = x + y*width;
          const { index, beta } = Grid.unpack_index_beta(index_beta_arr[iv]);
          const v_value = table_arr[index];
          data_arr[total_channels*iv+0] = v_value;
          data_arr[total_channels*iv+1] = beta;
        }
      }
    }
    const f16_data = Uint16ModuleNdarray.from_shape(module, f32_data.shape);
    module.convert_f32_to_f16(f32_data, f16_data);
    gpu_device.queue.writeTexture(
      { texture },
      f16_data.array_view,
      { bytesPerRow: width*sizeof_f16*total_channels },
      { width, height },
    );
    f16_data.delete();
    f32_data.delete();
  },
  scalar: (gpu_device: GPUDevice, texture: GPUTexture, f32_data: Float32ModuleNdarray) => {
    assert.array_dim(f32_data, 2);
    const [height, width] = f32_data.shape;
    assert.texture(texture, width, height, "r16float");

    const module = f32_data.module;
    const total_channels = 1;
    const sizeof_f16 = 2;
    const f16_data = Uint16ModuleNdarray.from_shape(module, f32_data.shape);
    module.convert_f32_to_f16(f32_data, f16_data);
    gpu_device.queue.writeTexture(
      { texture },
      f16_data.array_view,
      { bytesPerRow: width*sizeof_f16*total_channels },
      { width, height },
    );
    f16_data.delete();
  },
  xy_components: (gpu_device: GPUDevice, texture: GPUTexture, x_data: Float32ModuleNdarray, y_data: Float32ModuleNdarray) => {
    assert.array_dim(x_data, 2);
    assert.array_dim(y_data, 2);

    const Nx = x_data.shape[1];
    const Ny = y_data.shape[0];
    assert.array_shape(x_data, [Ny+1,Nx]);
    assert.array_shape(y_data, [Ny,Nx+1]);
    assert.texture(texture, Nx, Ny, "rg16float");

    const module = x_data.module;

    const total_channels = 2;
    const sizeof_f16 = 2;
    const shape = [Ny,Nx,total_channels];
    const f32_data = Float32ModuleNdarray.from_shape(module, shape);
    {
      const x_arr = x_data.array_view;
      const y_arr = y_data.array_view;
      const data_arr = f32_data.array_view;
      for (let y = 0; y < Ny; y++) {
        for (let x = 0; x < Nx; x++) {
          const iex = x + y*Nx;
          const iey = x + y*(Nx+1);
          const ie = 2*(x + y*Nx);
          data_arr[ie+0] = x_arr[iex];
          data_arr[ie+1] = y_arr[iey];
        }
      }
    }
    const f16_data = Uint16ModuleNdarray.from_shape(module, shape);
    module.convert_f32_to_f16(f32_data, f16_data);
    gpu_device.queue.writeTexture(
      { texture },
      f16_data.array_view,
      { bytesPerRow: Nx*sizeof_f16*total_channels },
      { width: Nx, height: Ny },
    );
    f16_data.delete();
    f32_data.delete();
  },
};

export class TextureCache {
  cache = new Map<string, GPUTexture>();
  gpu_device: GPUDevice;

  constructor(gpu_device: GPUDevice) {
    this.gpu_device = gpu_device;
  }

  clear() {
    this.cache.clear();
  }

  get(key: string, format: GPUTextureFormat, width: number, height: number): GPUTexture {
    let texture = this.cache.get(key);
    if (
      texture === undefined ||
      texture.width !== width ||
      texture.height !== height ||
      texture.format !== format
    ) {
      texture = this.gpu_device.createTexture({
        dimension: "2d",
        format,
        mipLevelCount: 1,
        sampleCount: 1,
        size: [width, height, 1],
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.cache.set(key, texture);
    }
    return texture;
  }
}

// common items used by all renderers
export class RendererCore {
  gpu_device: GPUDevice;
  texture_cache: TextureCache;
  shader_component: ShaderComponentViewer;
  shader_quiver: ShaderQuiverGrid;
  shader_index_beta: ShaderIndexBeta;
  grid: Grid;

  constructor(grid: Grid, gpu_device: GPUDevice) {
    this.grid = grid;
    this.gpu_device = gpu_device;
    this.texture_cache = new TextureCache(this.gpu_device);
    this.shader_component = new ShaderComponentViewer(this.gpu_device);
    this.shader_quiver = new ShaderQuiverGrid(this.gpu_device);
    this.shader_index_beta = new ShaderIndexBeta(this.gpu_device);
  }
}

export type Tooltip = { label: string, value: string }[];

export interface Renderer {
  create_pass: (
    command_encoder: GPUCommandEncoder,
    output_texture: GPUTextureView,
    canvas_size: { width: number, height: number },
  ) => void;
  upload_data: () => void;
  get_tooltip: (x: number, y: number) => Tooltip;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function nearest_sample_2d(arr: Ndarray, x: number, y: number) {
  if (arr.shape.length !== 2) {
    throw Error(`Expected array to be 2d but got shape: [${arr.shape.join(',')}]`);
  }
  const [Ny,Nx] = arr.shape;
  const iy = clamp(Math.floor(Ny*y), 0, Ny-1);
  const ix = clamp(Math.floor(Nx*x), 0, Nx-1);
  const value = arr.get([iy,ix]);
  return { value, ix, iy, Nx, Ny };
}

class VoltageFieldRenderer implements Renderer {
  readonly type = "v_field";
  core: RendererCore;
  scale: number = 1.0;
  alpha: number = 1.0;

  constructor(core: RendererCore) {
    this.core = core;
  }

  get_texture(): GPUTexture {
    const v_field = this.core.grid.v_field;
    const [Ny,Nx] = v_field.shape;
    const texture = this.core.texture_cache.get("v_field", "r16float", Nx, Ny);
    return texture;
  }

  upload_data() {
    const v_field = this.core.grid.v_field;
    const texture = this.get_texture();
    upload_texture.scalar(this.core.gpu_device, texture, v_field);
  }


  create_pass(
    command_encoder: GPUCommandEncoder, output_texture: GPUTextureView,
    canvas_size: { width: number, height: number },
  ) {
    const texture = this.get_texture();
    const texture_view = texture.createView({ dimension: "2d" });
    this.core.shader_component.create_pass(
      command_encoder, output_texture,
      texture_view, canvas_size, this.scale, 1, "single_component", this.alpha, "nearest",
    );
  }

  get_tooltip(x: number, y: number): Tooltip {
    const sample = nearest_sample_2d(this.core.grid.v_field.ndarray, x, y);
    return [
      { label: "Voltage", value: `${with_standard_suffix(sample.value, "V")}` },
      { label: "Coord", value: `[${sample.ix}/${sample.Nx}, ${sample.iy}/${sample.Ny}]` },
    ];
  }
}

class ElectricFieldRenderer implements Renderer {
  readonly type = "e_field";
  core: RendererCore;
  scale: number = 5.0; // e-field is generally small so this shouldn't be 0
  alpha: number = 1.0;
  quiver_size: number = 15.0;
  mode: "x" | "y" | "vec" | "mag" | "quiver" = "quiver";

  constructor(core: RendererCore) {
    this.core = core;
  }

  get_texture(): GPUTexture {
    const Nx = this.core.grid.ex_field.shape[1];
    const Ny = this.core.grid.ey_field.shape[0];
    const texture = this.core.texture_cache.get("e_field", "rg16float", Nx, Ny);
    return texture;
  }

  upload_data() {
    const ex_field = this.core.grid.ex_field;
    const ey_field = this.core.grid.ey_field;
    const texture = this.get_texture();
    upload_texture.xy_components(this.core.gpu_device, texture, ex_field, ey_field);
  }

  create_pass(
    command_encoder: GPUCommandEncoder, output_texture: GPUTextureView,
    canvas_size: { width: number, height: number },
  ) {
    const texture = this.get_texture();
    const texture_view = texture.createView({ dimension: "2d" });

    if (this.mode == "x") {
      this.core.shader_component.create_pass(
        command_encoder, output_texture,
        texture_view, canvas_size, this.scale, 1, "single_component", this.alpha, "nearest",
      );
    } else if (this.mode == "y") {
      this.core.shader_component.create_pass(
        command_encoder, output_texture,
        texture_view, canvas_size, this.scale, 2, "single_component", this.alpha, "nearest",
      );
    } else if (this.mode == "vec") {
      this.core.shader_component.create_pass(
        command_encoder, output_texture,
        texture_view, canvas_size, this.scale, (1 | 2), "vector", this.alpha, "nearest",
      );
    } else if (this.mode == "mag") {
      this.core.shader_component.create_pass(
        command_encoder, output_texture,
        texture_view, canvas_size, this.scale, (1 | 2), "magnitude", this.alpha, "nearest",
      );
    } else if (this.mode == "quiver") {
      this.core.shader_quiver.create_pass(
        command_encoder, output_texture,
        texture_view,
        canvas_size,
        this.scale, this.quiver_size,
      );
    }
  }

  get_tooltip(x: number, y: number): Tooltip {
    const sample_x = nearest_sample_2d(this.core.grid.ex_field.ndarray, x, y);
    const sample_y = nearest_sample_2d(this.core.grid.ey_field.ndarray, x, y);
    const Ex = sample_x.value;
    const Ey = sample_y.value;
    const Emag = Math.sqrt(Ex*Ex + Ey*Ey);
    return [
      { label: "Ex", value: `${with_standard_suffix(Ex, "V/m")}` },
      { label: "Ey", value: `${with_standard_suffix(Ey, "V/m")}` },
      { label: "|E|", value: `${with_standard_suffix(Emag, "V/m")}` },
      { label: "Coord-X", value: `[${sample_x.ix}/${sample_x.Nx}, ${sample_x.iy}/${sample_x.Ny}]` },
      { label: "Coord-Y", value: `[${sample_y.ix}/${sample_y.Nx}, ${sample_y.iy}/${sample_y.Ny}]` },
    ];
  }
}

abstract class IndexBetaRenderer implements Renderer {
  scale: number = 1.0;
  alpha: number = 1.0;
  mode: IndexBetaMode = "signed_value";
  core: RendererCore;

  constructor(core: RendererCore) {
    this.core = core;
  }

  abstract get_name(): string;
  abstract get_unit(): string;
  abstract get_key(): string;
  abstract get_index_beta(): Uint32ModuleNdarray;
  abstract get_table(): Float32ModuleNdarray;

  get_index_beta_texture(): GPUTexture {
    const key = this.get_key();
    const index_beta = this.get_index_beta();
    assert.array_dim(index_beta, 2);
    const [Ny,Nx] = index_beta.shape;
    const texture = this.core.texture_cache.get(`${key}_index_beta`, "r32uint", Nx, Ny);
    return texture;
  }

  get_table_texture(): GPUTexture {
    const key = this.get_key();
    const table = this.get_table();
    assert.array_dim(table, 1);
    const N = table.shape[0];
    const texture = this.core.texture_cache.get(`${key}_table`, "r32float", N, 1);
    return texture;
  }

  upload_table() {
    const data = this.get_table();
    const texture = this.get_table_texture();
    const sizeof_f32 = 4;;
    this.core.gpu_device.queue.writeTexture(
      { texture },
      data.array_view,
      { bytesPerRow: texture.width*sizeof_f32 },
      { width: texture.width, height: texture.height },
    );
  }

  upload_index_beta() {
    const data = this.get_index_beta();
    const texture = this.get_index_beta_texture();
    const sizeof_u32 = 4;;
    this.core.gpu_device.queue.writeTexture(
      { texture },
      data.array_view,
      { bytesPerRow: texture.width*sizeof_u32 },
      { width: texture.width, height: texture.height },
    );
  }

  upload_data() {
    this.upload_table();
    this.upload_index_beta();
  }

  create_pass(
    command_encoder: GPUCommandEncoder, output_texture: GPUTextureView,
    canvas_size: { width: number, height: number },
  ) {
    const table_texture = this.get_table_texture();
    const index_beta_texture = this.get_index_beta_texture();
    const table_texture_view = table_texture.createView({ dimension: "2d" });
    const index_beta_texture_view = index_beta_texture.createView({ dimension: "2d" });
    this.core.shader_index_beta.create_pass(
      command_encoder, output_texture,
      canvas_size,
      table_texture_view, index_beta_texture_view,
      table_texture.width,
      { width: index_beta_texture.width, height: index_beta_texture.height },
      this.scale, this.mode, this.alpha,
    )
  }

  get_tooltip(x: number, y: number): Tooltip {
    const table = this.get_table();
    const sample = nearest_sample_2d(this.get_index_beta().ndarray, x, y);
    const index_beta = sample.value;
    const { index, beta } = Grid.unpack_index_beta(index_beta);
    const value = table.array_view[index];
    return [
      { label: this.get_name(), value: `${with_standard_suffix(value, this.get_unit())}` },
      { label: "Index", value: `${index}` },
      { label: "Beta", value: `${beta.toPrecision(3)}` },
      { label: "Coord", value: `[${sample.ix}/${sample.Nx}, ${sample.iy}/${sample.Ny}]` },
    ];
  }
}

class VoltageForceRenderer extends IndexBetaRenderer {
  readonly type = "v_force";
  constructor(core: RendererCore) {
    super(core);
  }
  override get_name(): string { return "Voltage"; };
  override get_unit(): string { return "V"; };
  override get_key(): string { return "v_force"; };
  override get_index_beta(): Uint32ModuleNdarray { return this.core.grid.v_index_beta; };
  override get_table(): Float32ModuleNdarray { return this.core.grid.v_table; };
}

class EpsilonRenderer extends IndexBetaRenderer {
  readonly type = "epsilon";
  constructor(core: RendererCore) {
    super(core);
    this.scale = 1/4.0; // common dielectric value is around 4
    this.mode = "index"; // more useful to view types of dielectric present
  }
  override get_name(): string { return "Epsilon"; };
  override get_unit(): string { return ""; };
  override get_key(): string { return "epsilon"; };
  override get_index_beta(): Uint32ModuleNdarray { return this.core.grid.ek_index_beta; };
  override get_table(): Float32ModuleNdarray { return this.core.grid.ek_table; };
}

export class MasterRenderer implements Renderer {
  core: RendererCore;
  v_field_renderer: VoltageFieldRenderer;
  e_field_renderer: ElectricFieldRenderer;
  v_force_renderer: VoltageForceRenderer;
  epsilon_renderer: EpsilonRenderer;
  mode: "v_field" | "e_field" | "v_force" | "epsilon" = "e_field";

  constructor(core: RendererCore) {
    this.core = core;
    this.v_field_renderer = new VoltageFieldRenderer(core);
    this.e_field_renderer = new ElectricFieldRenderer(core);
    this.v_force_renderer = new VoltageForceRenderer(core);
    this.epsilon_renderer = new EpsilonRenderer(core);
  }

  get selected() {
    switch (this.mode) {
      case "v_field": return this.v_field_renderer;
      case "e_field": return this.e_field_renderer;
      case "v_force": return this.v_force_renderer;
      case "epsilon": return this.epsilon_renderer;
    }
  }

  create_pass(
    command_encoder: GPUCommandEncoder, output_texture: GPUTextureView,
    canvas_size: { width: number, height: number },
  ) {
    return this.selected.create_pass(command_encoder, output_texture, canvas_size);
  }

  upload_data() {
    return this.selected.upload_data();
  }

  get_tooltip(x: number, y: number): Tooltip {
    return this.selected.get_tooltip(x, y);
  }
}
