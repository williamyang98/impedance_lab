export type DataType =
  "s8" | "u8" |
  "s16" | "u16" |
  "s32" | "u32" |
  "f32" | "f64";

export type VectorSize = 2 | 3 | 4;

export type Indices<N extends number, A extends unknown[] = []> =
  A["length"] extends N ?
  never :
  A["length"] | Indices<N, [...A, unknown]>; // A = [unknown x N]

export type FixedSizeArray<T, N extends number> = {
  [K in Indices<N>]: T;
} & {
  readonly length: N;
}

export interface DynamicSizeArray<T> {
  get(index: number): T | undefined;
  set(index: number, value: T): void;
}

// Schema -> Layout -> View = [object, ArrayBuffer]
export type SchemaType =
  PrimitiveSchema<DataType> |
  VectorSchema<SchemaType, VectorSize, LayoutType> |
  ArraySchema<SchemaType, number, LayoutType> |
  StructSchema<Record<string, SchemaType>, Record<string, LayoutType>, Record<string, unknown>>;

export type LayoutType =
  PrimitiveLayout<DataType> |
  VectorLayout<LayoutType, VectorSize> |
  ArrayLayout<LayoutType, number> |
  StructLayout<Record<string, LayoutType>, Record<string, unknown>>;

export interface DataViewType<Output = unknown> {
  readonly __output: Output;
  size_bytes: number;
  offset_bytes: number;
  data_view: DataView;
  view: Output;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataViewClass<Output> = new (...args: any) => DataViewType<Output>;

export interface ArrayBufferType<Output> extends DataViewType<Output> {
  array_buffer: ArrayBuffer;
}

export interface GpuBufferType<Output> extends ArrayBufferType<Output> {
  gpu_buffer: GPUBuffer;
  gpu_device: GPUDevice;
  write_to_gpu(): void;
}

function create_array_buffer_class<T extends LayoutType>(layout: T, name?: string) {
  type Output = T["__output"];
  const size_bytes = layout.size_bytes;
  const offset_bytes = layout.offset_bytes;
  const new_class = class ArrayBufferClass implements ArrayBufferType<Output> {
    readonly __output!: Output;
    size_bytes: number;
    offset_bytes: number;
    data_view: DataView;
    view: Output;
    array_buffer: ArrayBuffer;

    constructor(array_buffer?: ArrayBuffer) {
      this.size_bytes = size_bytes;
      this.offset_bytes = offset_bytes;
      this.array_buffer = array_buffer ?? new ArrayBuffer(offset_bytes+size_bytes);
      this.data_view = new DataView(this.array_buffer);
      const output_view = layout.data_view(this.data_view);
      this.view = output_view.view;
    }
  }
  name = name ?? `ArrayBufferClass<${layout.type}>`;
  Object.defineProperty(new_class, "name", { value: name, configurable: true });
  return new_class;
}

function create_gpu_buffer_class<T extends LayoutType>(layout: T, name?: string) {
  type Output = T["__output"];
  const size_bytes = layout.size_bytes;
  const offset_bytes = layout.offset_bytes;
  const new_class = class GpuBufferClass implements GpuBufferType<Output> {
    readonly __output!: Output;
    size_bytes: number;
    offset_bytes: number;
    data_view: DataView;
    view: Output;
    array_buffer: ArrayBuffer;
    gpu_buffer: GPUBuffer;
    gpu_device: GPUDevice;

    constructor(gpu_device: GPUDevice) {
      this.gpu_device = gpu_device;
      this.size_bytes = size_bytes;
      this.offset_bytes = offset_bytes;
      this.array_buffer = new ArrayBuffer(offset_bytes+size_bytes);
      this.data_view = new DataView(this.array_buffer);
      const output_view = layout.data_view(this.data_view);
      this.view = output_view.view;
      this.gpu_buffer = this.gpu_device.createBuffer({
        size: this.array_buffer.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    write_to_gpu() {
      this.gpu_device.queue.writeBuffer(this.gpu_buffer, 0, this.array_buffer, 0, this.array_buffer.byteLength);
    }
  }

  name = name ?? `GpuBufferClass<${layout.type}>`;
  Object.defineProperty(new_class, "name", { value: name, configurable: true });
  return new_class;
}

export function get_dtype_size_bytes(dtype: DataType): number {
  switch (dtype) {
  case "s8": return 1;
  case "u8": return 1;
  case "s16": return 2;
  case "u16": return 2;
  case "s32": return 4;
  case "u32": return 4;
  case "f32": return 4;
  case "f64": return 8;
  }
}

interface FieldAccessor {
  getter(view: DataView, offset: number): number;
  setter(view: DataView, offset: number, value: number): void;
}

function get_dtype_data_view(dtype: DataType, is_little_endian: boolean): FieldAccessor {
  switch (dtype) {
  case "s8":  return {
    getter(view, offset) { return view.getInt8(offset); },
    setter(view, offset, value) { view.setInt8(offset, value); },
  };
  case "u8":  return {
    getter(view, offset) { return view.getUint8(offset); },
    setter(view, offset, value) { view.setUint8(offset, value); },
  };
  case "s16": return {
    getter(view, offset) { return view.getInt16(offset, is_little_endian); },
    setter(view, offset, value) { view.setInt16(offset, value, is_little_endian); },
  };
  case "u16": return {
    getter(view, offset) { return view.getUint16(offset, is_little_endian); },
    setter(view, offset, value) { view.setUint16(offset, value, is_little_endian); },
  };
  case "s32": return {
    getter(view, offset) { return view.getInt32(offset, is_little_endian); },
    setter(view, offset, value) { view.setInt32(offset, value, is_little_endian); },
  };
  case "u32": return {
    getter(view, offset) { return view.getUint32(offset, true); },
    setter(view, offset, value) { view.setUint32(offset, value, is_little_endian); },
  };
  case "f32": return {
    getter(view, offset) { return view.getFloat32(offset, true); },
    setter(view, offset, value) { view.setFloat32(offset, value, is_little_endian); },
  };
  case "f64": return {
    getter(view, offset) { return view.getFloat64(offset, true); },
    setter(view, offset, value) { view.setFloat64(offset, value, is_little_endian); },
  };
  }
}

// primitive
export class PrimitiveLayout<T extends DataType, Output = unknown> {
  readonly type: "primitive";
  readonly __output!: Output;
  readonly dtype: T;
  offset_bytes: number;
  size_bytes: number;

  constructor(dtype: T, offset?: number) {
    this.type = "primitive";
    this.dtype = dtype;
    this.offset_bytes = offset ?? 0;
    this.size_bytes = get_dtype_size_bytes(dtype);
  }

  add_offset_bytes(offset_bytes: number) {
    return new PrimitiveLayout<T, Output>(this.dtype, this.offset_bytes+offset_bytes);
  }

  object(): Output {
    return 0 as Output;
  }

  data_view(data_view: DataView): DataViewType<Output> {
    const output_view = get_dtype_data_view(this.dtype, true);
    const size_bytes = this.size_bytes;
    const offset_bytes = this.offset_bytes;
    return {
      __output: undefined as Output,
      size_bytes,
      offset_bytes,
      data_view,
      get view(): Output {
        return output_view.getter(data_view, offset_bytes) as Output;
      },
      set view(value: Output) {
        output_view.setter(data_view, offset_bytes, value as number);
      },
    };
  }

  array_buffer(name?: string) {
    return create_array_buffer_class(this, name);
  }

  gpu_buffer(name?: string) {
    return create_gpu_buffer_class(this, name);
  }
}

export class PrimitiveSchema<T extends DataType, Output = unknown> {
  readonly type: "primitive";
  readonly dtype: T;
  readonly __output!: Output;
  readonly __layout!: PrimitiveLayout<T, Output>;

  constructor(dtype: T) {
    this.type = "primitive";
    this.dtype = dtype;
  }

  layout(): typeof this.__layout {
    return new PrimitiveLayout<T, Output>(this.dtype);
  }
}

export function primitive<T extends DataType>(dtype: T) {
  type Output = number;
  return new PrimitiveSchema<T, Output>(dtype);
}

// vector
export type Vector2View<T = number> =
  { x: T; y: T; } &
  { r: T; g: T; } &
  { readonly length: 2; } &
  [T, T];

export type Vector3View<T = number> =
  { x: T; y: T; z: T } &
  { r: T; g: T; b: T } &
  { readonly length: 3; } &
  [T, T, T];

export type Vector4View<T = number> =
  { x: T; y: T; z: T; w: T; } &
  { r: T; g: T; b: T; a: T; } &
  { readonly length: 4; } &
  [T, T, T, T];

export type VectorView<T, N extends VectorSize> =
  N extends 2 ? Vector2View<T> :
  N extends 3 ? Vector3View<T> :
  N extends 4 ? Vector4View<T> :
  never;

export class VectorLayout<T extends LayoutType, N extends VectorSize, Output = unknown> {
  readonly type: "vector";
  readonly __output!: Output;
  offset_bytes: number;
  size_bytes: number;
  total_elements: N;
  _element_layout: T;
  element_layouts: VectorView<T, N>;

  constructor(element_layout: T, size: N, offset?: number) {
    this.type = "vector";
    this._element_layout = element_layout;
    this.total_elements = size;

    const element_layouts = new Array(size);
    const xyzw = ["x", "y", "z", "w"];
    const rgba = ["r", "g", "b", "a"];
    let current_size_bytes = 0;
    offset = offset ?? 0;
    let current_offset_bytes = offset;
    for (let i = 0; i < element_layouts.length; i++) {
      const offset_element_layout = element_layout.add_offset_bytes(current_offset_bytes);
      element_layouts[i] = offset_element_layout;
      current_offset_bytes += offset_element_layout.size_bytes;
      current_size_bytes += offset_element_layout.size_bytes;
      Object.defineProperty(element_layouts, xyzw[i], {
        get() { return element_layouts[i]; },
        set(value: T) { element_layouts[i] = value; },
      });
      Object.defineProperty(element_layouts, rgba[i], {
        get() { return element_layouts[i]; },
        set(value: T) { element_layouts[i] = value; },
      });
    }
    this.offset_bytes = offset;
    this.size_bytes = current_size_bytes;
    this.element_layouts = element_layouts as VectorView<T, N>;
  }

  add_offset_bytes(offset_bytes: number) {
    const new_offset_bytes = this.offset_bytes+offset_bytes;
    return new VectorLayout<T, N, Output>(this._element_layout, this.total_elements, new_offset_bytes);
  }

  object(): Output {
    const output_view: unknown[] = [];
    const xyzw = ["x", "y", "z", "w"];
    const rgba = ["r", "g", "b", "a"];
    for (let i = 0; i < this.total_elements; i++) {
      const element_layout = this.element_layouts[i];
      output_view.push(element_layout.object());
      for (const key of [xyzw[i], rgba[i]]) {
        Object.defineProperty(output_view, key, {
          get() { return output_view[i]; },
          set(value: unknown) { output_view[i] = value; },
        });
      }
    }
    return output_view as Output;
  }

  data_view(data_view: DataView): DataViewType<Output> {
    const size_bytes = this.size_bytes;
    const offset_bytes = this.offset_bytes;
    const output_view = {
      length: this.total_elements,
    };
    const xyzw = ["x", "y", "z", "w"];
    const rgba = ["r", "g", "b", "a"];
    for (let i = 0; i < this.total_elements; i++) {
      const element_layout = this.element_layouts[i];
      const element_view = element_layout.data_view(data_view);
      for (const key of [i, xyzw[i], rgba[i]]) {
        Object.defineProperty(output_view, key, {
          get() { return element_view.view; },
          set(value: unknown) { element_view.view = value; },
        });
      }
    }

    return {
      __output: undefined as Output,
      size_bytes,
      offset_bytes,
      data_view,
      view: output_view as Output,
    };
  }

  array_buffer(name?: string) {
    return create_array_buffer_class(this, name);
  }

  gpu_buffer(name?: string) {
    return create_gpu_buffer_class(this, name);
  }
}

export class VectorSchema<T extends SchemaType, N extends VectorSize, L extends LayoutType, Output = unknown> {
  readonly type: "vector";
  readonly dtype: T;
  readonly size: N;
  readonly __output!: Output;
  readonly __layout!: VectorLayout<L, N, Output>;

  constructor(dtype: T, size: N) {
    this.type = "vector";
    this.dtype = dtype;
    this.size = size;
  }

  layout(): typeof this.__layout {
    return new VectorLayout(this.dtype.layout(), this.size) as typeof this.__layout;
  }
}

export function vector<T extends SchemaType, N extends VectorSize>(dtype: T, size: N) {
  type Output = VectorView<T["__output"], N>;
  type ElementLayout = T["__layout"];
  return new VectorSchema<T, N, ElementLayout, Output>(dtype, size);
}

// array
export class ArrayLayout<T extends LayoutType, N extends number, Output = unknown> {
  readonly type: "array";
  readonly __output!: Output;
  offset_bytes: number;
  size_bytes: number;
  total_elements: N;
  _element_layout: T;
  element_layouts: T[];

  constructor(element_layout: T, size: N, offset?: number) {
    offset = offset ?? 0;
    this.type = "array";
    this.total_elements = size;
    this._element_layout = element_layout;

    const element_layouts = new Array(size) as T[];
    let curr_offset_bytes = offset;
    let curr_size_bytes = 0;
    for (let i = 0; i < size; i++) {
      const offset_element_layout = element_layout.add_offset_bytes(curr_offset_bytes);
      element_layouts[i] = offset_element_layout as T;
      curr_offset_bytes += offset_element_layout.size_bytes;
      curr_size_bytes += offset_element_layout.size_bytes;
    }

    this.offset_bytes = offset;
    this.size_bytes = curr_size_bytes;
    this.element_layouts = element_layouts;
  }

  add_offset_bytes(offset_bytes: number) {
    const new_offset_bytes = this.offset_bytes+offset_bytes;
    return new ArrayLayout<T, N, Output>(this._element_layout, this.total_elements, new_offset_bytes);
  }

  object(): Output {
    const view = [];
    for (let i = 0; i < this.total_elements; i++) {
      view.push(this._element_layout.object());
    }
    return view as Output;
  }

  data_view(data_view: DataView): DataViewType<Output> {
    const size_bytes = this.size_bytes;
    const offset_bytes = this.offset_bytes;
    const output_view = {
      length: this.total_elements,
    };
    for (let i = 0; i < this.total_elements; i++) {
      const element_layout = this.element_layouts[i];
      const element_view = element_layout.data_view(data_view);
      Object.defineProperty(output_view, i, {
        get() { return element_view.view; },
        set(value: unknown) { element_view.view = value; },
      });
    }
    return {
      __output: undefined as Output,
      size_bytes,
      offset_bytes,
      data_view,
      view: output_view as Output,
    };
  }

  array_buffer(name?: string) {
    return create_array_buffer_class(this, name);
  }

  gpu_buffer(name?: string) {
    return create_gpu_buffer_class(this, name);
  }
}

export class ArraySchema<T extends SchemaType, N extends number, L extends LayoutType, Output = unknown> {
  readonly type: "array";
  readonly dtype: T;
  readonly size: N;
  readonly __output!: Output;
  readonly __layout!: ArrayLayout<L, N, Output>;

  constructor(dtype: T, size: N) {
    this.type = "array";
    this.dtype = dtype;
    this.size = size;
  }

  layout(): typeof this.__layout {
    return new ArrayLayout(this.dtype.layout(), this.size) as typeof this.__layout;
  }
}

export function array<T extends SchemaType, N extends number>(dtype: T, size: N) {
  type Output = FixedSizeArray<T["__output"], N>;
  type ElementLayout = T["__layout"];
  return new ArraySchema<T, N, ElementLayout, Output>(dtype, size);
}

// struct
export class StructLayout<F extends Record<string, LayoutType>, Output extends Record<string, unknown>> {
  readonly type: "struct";
  readonly __output!: Output;
  offset_bytes: number;
  size_bytes: number;
  total_fields: number;
  _non_offset_element_layouts: F;
  element_layouts: F;

  constructor(fields: F, offset?: number) {
    this.type = "struct";
    offset = offset ?? 0;

    let curr_offset_bytes = offset;
    let curr_size_bytes = 0;

    type Layouts = { [K in keyof F]: LayoutType };
    const element_layouts = {} as Layouts;
    let total_fields = 0;
    for (const [_key, value] of Object.entries(fields)) {
      const key = _key as keyof F;
      const element_layout = value.add_offset_bytes(curr_offset_bytes);
      element_layouts[key] = element_layout;
      curr_offset_bytes += element_layout.size_bytes;
      curr_size_bytes += element_layout.size_bytes;
      total_fields++;
    }

    this.offset_bytes = offset;
    this.size_bytes = curr_size_bytes;
    this.element_layouts = element_layouts as F;
    this._non_offset_element_layouts = fields;
    this.total_fields = total_fields;
  }

  add_offset_bytes(offset_bytes: number) {
    const new_offset_bytes = this.offset_bytes + offset_bytes;
    return new StructLayout<F, Output>(this._non_offset_element_layouts, new_offset_bytes);
  }

  object(): Output {
    const output_view: Record<string, unknown> = {};
    for (const [key, element_layout] of Object.entries(this.element_layouts)) {
      output_view[key] = element_layout.object();
    }
    return output_view as Output;
  }

  data_view(data_view: DataView): DataViewType<Output> {
    const size_bytes = this.size_bytes;
    const offset_bytes = this.offset_bytes;
    const output_view = {};
    for (const [key, element_layout] of Object.entries(this.element_layouts)) {
      const element_view = element_layout.data_view(data_view);
      Object.defineProperty(output_view, key, {
        get() { return element_view.view; },
        set(value: unknown) { element_view.view = value; },
      });
    }

    return {
      __output: undefined as unknown as Output,
      size_bytes,
      offset_bytes,
      data_view,
      view: output_view as Output,
    };
  }

  array_buffer(name?: string) {
    return create_array_buffer_class(this, name);
  }

  gpu_buffer(name?: string) {
    return create_gpu_buffer_class(this, name);
  }
}

class StructSchema<F extends Record<string, SchemaType>, L extends Record<string, LayoutType>, Output extends Record<string, unknown>> {
  readonly type: "struct";
  readonly fields: F;
  readonly __output!: Output;
  readonly __layout!: StructLayout<L, Output>;

  constructor(fields: F) {
    this.type = "struct";
    this.fields = fields;
  }

  layout(): typeof this.__layout {
    type Layouts = {
      [K in keyof F]: F[K]["__layout"];
    };
    const layouts = {} as Layouts;
    for (const [_key, value] of Object.entries(this.fields)) {
      const key = _key as keyof F;
      layouts[key] = value.layout();
    }
    return new StructLayout<L, Output>(layouts as L);
  }

  extend<T extends StructSchema<Record<string, SchemaType>, Record<string, LayoutType>, Record<string, unknown>>>(other: T) {
    type FieldsExtended = F & T["fields"];
    type LayoutExtended = { [K in keyof FieldsExtended]: FieldsExtended[K]["__layout"] };
    type OutputExtended = { [K in keyof FieldsExtended]: FieldsExtended[K]["__output"] };
    const fields = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(this.fields)) {
      fields[key] = value;
    }
    for (const [key, value] of Object.entries(other.fields)) {
      fields[key] = value;
    }
    return new StructSchema<FieldsExtended, LayoutExtended, OutputExtended>(fields as FieldsExtended);
  }
}

export function struct<F extends Record<string, SchemaType>>(fields: F) {
  type Output = { [K in keyof F]: F[K]["__output"] };
  type FieldLayouts = { [K in keyof F]: F[K]["__layout"] };
  return new StructSchema<F, FieldLayouts, Output>(fields);
}

export function matrix<T extends SchemaType, N extends number, M extends number>(dtype: T, shape: [N, M]) {
  const row = array(dtype, shape[1]);
  const matrix = array(row, shape[0]);
  return matrix;
}

export function vector_matrix<T extends SchemaType, N extends VectorSize, M extends VectorSize>(dtype: T, shape: [N, M]) {
  const row = vector(dtype, shape[1]);
  const matrix = vector(row, shape[0]);
  return matrix;
}

// dynamic sized array
export class DynamicArrayLayout<T extends LayoutType, Output = unknown> {
  readonly type: "dynamic_array";
  readonly __output!: Output;
  offset_bytes: number;
  _element_layout: T;

  constructor(element_layout: T, offset?: number) {
    offset = offset ?? 0;
    this.type = "dynamic_array";
    this._element_layout = element_layout;
    this.offset_bytes = offset;
  }

  add_offset_bytes(offset_bytes: number) {
    const new_offset_bytes = this.offset_bytes+offset_bytes;
    return new DynamicArrayLayout<T, Output>(this._element_layout, new_offset_bytes);
  }

  object(): Output {
    const view: unknown[] = [];
    return view as Output;
  }

  data_view(data_view: DataView): DataViewType<Output> {
    const offset_bytes = this.offset_bytes;
    const element_layout = this._element_layout;
    const element_size_bytes = element_layout.size_bytes;
    const total_elements = Math.floor((data_view.byteLength-this.offset_bytes)/element_size_bytes);
    const size_bytes = total_elements*element_size_bytes;
    const output_view = {
      get(index: number): unknown {
        const element_offset_bytes = offset_bytes + element_size_bytes*index;
        const offset_element_layout = element_layout.add_offset_bytes(element_offset_bytes);
        const element_view = offset_element_layout.data_view(data_view);
        return element_view.view;
      },
      set(index: number, value: number): void {
        const element_offset_bytes = offset_bytes + element_size_bytes*index;
        const offset_element_layout = element_layout.add_offset_bytes(element_offset_bytes);
        const element_view = offset_element_layout.data_view(data_view);
        element_view.view = value;
      },
    };
    return {
      __output: undefined as Output,
      size_bytes,
      offset_bytes,
      data_view,
      view: output_view as Output,
    };
  }

  array_buffer(array_buffer: ArrayBuffer): DataViewType<Output> {
    const data_view = new DataView(array_buffer);
    return this.data_view(data_view);
  }
}

export class DynamicArraySchema<T extends SchemaType, L extends LayoutType, Output = unknown> {
  readonly type: "dynamic_array";
  readonly dtype: T;
  readonly __output!: Output;
  readonly __layout!: DynamicArrayLayout<L, Output>;

  constructor(dtype: T) {
    this.type = "dynamic_array";
    this.dtype = dtype;
  }

  layout(): typeof this.__layout {
    return new DynamicArrayLayout(this.dtype.layout()) as typeof this.__layout;
  }
}

export function dynamic_array<T extends SchemaType>(dtype: T) {
  type Output = DynamicSizeArray<T["__output"]>;
  type ElementLayout = T["__layout"];
  return new DynamicArraySchema<T, ElementLayout, Output>(dtype);
}

export type HasOutputType = SchemaType | LayoutType | DataViewType | DataViewClass<unknown>;
export type InferOutput<T extends HasOutputType> =
  T extends DataViewClass<unknown> ?
  InstanceType<T>["__output"] :
  T extends SchemaType | LayoutType | DataViewType ?
  T["__output"] :
  never;
export type InferLayout<T extends SchemaType> = T["__layout"];
