export type NdarrayData =
    Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export type NdarrayType =
  "s8" | "u8" | "u8_clamped" |
  "s16" | "u16" |
  "s32" | "u32" |
  "f32" | "f64";

const get_array_constructor_from_dtype = (dtype: NdarrayType) => {
  switch (dtype) {
  case "s8": return Int8Array;
  case "u8": return Uint8Array;
  case "u8_clamped": return Uint8ClampedArray;
  case "s16": return Int16Array;
  case "u16": return Uint16Array;
  case "s32": return Int32Array;
  case "u32": return Uint32Array;
  case "f32": return Float32Array;
  case "f64": return Float64Array;
  }
}

const get_dtype_from_array = (buffer: NdarrayData): NdarrayType => {
  if (buffer instanceof Int8Array) return "s8";
  if (buffer instanceof Uint8Array) return "u8";
  if (buffer instanceof Uint8ClampedArray) return "u8_clamped";
  if (buffer instanceof Int16Array) return "s16";
  if (buffer instanceof Uint16Array) return "u16";
  if (buffer instanceof Int32Array) return "s32";
  if (buffer instanceof Uint32Array) return "u32";
  if (buffer instanceof Float32Array) return "f32";
  if (buffer instanceof Float64Array) return "f64";
  return "f32";
}

export abstract class NdarrayView {
  abstract get shape(): number[];
  abstract get dtype(): NdarrayType;
  abstract get: (index: number[]) => number;
  abstract set: (index: number[], value: number) => void;

  lo = (offset: number[]): NdarrayViewLow => {
    return new NdarrayViewLow(this, offset);
  }

  hi = (offset: number[]): NdarrayViewHigh => {
    return new NdarrayViewHigh(this, offset);
  }

  step = (step: number[]): NdarrayViewStride => {
    return new NdarrayViewStride(this, step);
  }

  transpose = (order: number[]): NdarrayViewTranspose => {
    return new NdarrayViewTranspose(this, order);
  }

  reshape = (shape: number[]): NdarrayView => {
    return new NdarrayViewReshape(this, shape);
  };

  flatten = (): NdarrayView => {
    const total_elems = this.shape.reduce((a,b) => a*b, 1);
    return this.reshape([total_elems]);
  }

  reverse = (): NdarrayView => {
    return new NdarrayViewReverse(this);
  }

  fill = (value: number): NdarrayView => {
    const index = new Array(this.shape.length).fill(0);
    while (true) {
      this.set(index, value);
      let is_finished = false;
      for (let i = 0; i < index.length; i++) {
        const j = index.length-1-i;
        index[j]++;
        if (index[j] < this.shape[j]) break;
        index[j] = 0;
        if (j == 0) is_finished = true;
      }
      if (is_finished) break;
    }
    return this;
  }

  assign = (view: NdarrayView): NdarrayView => {
    const is_shape_match =
      (view.shape.length == this.shape.length) &&
      view.shape.map((e,i) => e == this.shape[i]).reduce((a,b) => a && b, true);
    if (!is_shape_match) {
      throw Error(`Assigned failed with shape ismatch between dest (${this.shape.join(',')}) and source (${view.shape.join(',')})`);
    }
    const index = new Array(this.shape.length).fill(0);
    while (true) {
      const value = view.get(index);
      this.set(index, value);
      let is_finished = false;
      for (let i = 0; i < index.length; i++) {
        const j = index.length-1-i;
        index[j]++;
        if (index[j] < this.shape[j]) break;
        index[j] = 0;
        if (j == 0) is_finished = true;
      }
      if (is_finished) break;
    }
    return this;
  }

  to_owned = (): Ndarray => {
    const arr = Ndarray.create_zeros(this.shape, this.dtype);
    const index = new Array(this.shape.length).fill(0);
    while (true) {
      const value = this.get(index);
      arr.set(index, value);
      let is_finished = false;
      for (let i = 0; i < index.length; i++) {
        const j = index.length-1-i;
        index[j]++;
        if (index[j] < this.shape[j]) break;
        index[j] = 0;
        if (j == 0) is_finished = true;
      }
      if (is_finished) break;
    }
    return arr;
  }
}

export class NdarrayViewReverse extends NdarrayView {
  shape: number[];
  view: NdarrayView;

  constructor(view: NdarrayView) {
    super();
    this.shape = [...view.shape];
    this.view = view;
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  get = (index: number[]): number => {
    const i = index.map((e,i) => this.shape[i]-1-e);
    return this.view.get(i);
  }

  set = (index: number[], value: number) => {
    const i = index.map((e,i) => this.shape[i]-1-e);
    this.view.set(i, value);
  }
}

export class NdarrayViewReshape extends NdarrayView {
  shape: number[];
  stride: number[];
  view_stride: number[];
  view: NdarrayView;

  constructor(view: NdarrayView, shape: number[]) {
    super();
    const reshape_size = shape.reduce((a,b) => a*b, 1);
    const view_size = view.shape.reduce((a,b) => a*b, 1);
    if (reshape_size != view_size) {
      throw Error(`Reshape total elements mismatch with original shape (${view.shape.join(',')}) => ${view_size} and target shape ${shape.join(',')} => ${reshape_size}`);
    }
    this.shape = shape;
    this.view = view;
    // precalculate stride for indexing
    {
      let curr_stride = 1;
      const stride = [];
      for (let i = 0; i < shape.length; i++) {
        stride.push(curr_stride);
        const j = shape.length-1-i;
        curr_stride *= shape[j];
      }
      stride.reverse();
      this.stride = stride;
    }
    {
      let curr_stride = 1;
      const stride = [];
      const view_shape = view.shape;
      for (let i = 0; i < view_shape.length; i++) {
        stride.push(curr_stride);
        const j = view_shape.length-1-i;
        curr_stride *= view_shape[j];
      }
      stride.reverse();
      this.view_stride = stride;
    }
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  private get_original_index = (index: number[]): number[] => {
    let array_index = 0;
    for (let i = 0; i < index.length; i++) {
      array_index += this.stride[i]*index[i];
    }
    const original_index = [];
    for (let i = 0; i < this.view_stride.length; i++) {
      const stride = this.view_stride[i];
      const axis_index = Math.floor(array_index / stride);
      array_index -= axis_index*stride;
      original_index.push(axis_index);
    }
    return original_index;
  }

  get = (index: number[]): number => {
    const i = this.get_original_index(index);
    return this.view.get(i);
  }

  set = (index: number[], value: number) => {
    const i = this.get_original_index(index);
    this.view.set(i, value);
  }
}

export class NdarrayViewLow extends NdarrayView {
  shape: number[];
  offset: number[];
  view: NdarrayView;

  constructor(view: NdarrayView, offset: number[]) {
    super();
    if (offset.length != view.shape.length) {
      throw Error(`Offset (${offset.join(',')}) has mismatching dimension (${offset.length}) to array view shape (${view.shape.join(',')}) with dimension (${view.shape.length})`);
    }
    for (let i = 0; i < offset.length; i++) {
      if (offset[i] >= view.shape[i] || offset[i] < 0) {
        throw Error(`Offset (${offset.join(',')}) at axis ${i} is outside of shape (${view.shape.join(',')})`);
      }
    }
    const shape = view.shape.map((e,i) => e-offset[i]);
    this.offset = offset;
    this.view = view;
    this.shape = shape
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  get = (index: number[]): number => {
    const i = index.map((e,i) => e+this.offset[i]);
    return this.view.get(i);
  }

  set = (index: number[], value: number) => {
    const i = index.map((e,i) => e+this.offset[i]);
    this.view.set(i, value);
  }
}

export class NdarrayViewHigh extends NdarrayView {
  shape: number[];
  view: NdarrayView;

  constructor(view: NdarrayView, offset: number[]) {
    super();
    if (offset.length != view.shape.length) {
      throw Error(`Offset (${offset.join(',')}) has mismatching dimension (${offset.length}) to array view shape (${view.shape.join(',')}) with dimension (${view.shape.length})`);
    }
    for (let i = 0; i < offset.length; i++) {
      if (offset[i] > view.shape[i] || offset[i] <= 0) {
        throw Error(`Offset (${offset.join(',')}) at axis ${i} is outside of shape (${view.shape.join(',')})`);
      }
    }
    this.shape = offset;
    this.view = view;
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  get = (index: number[]): number => {
    return this.view.get(index);
  }

  set = (index: number[], value: number) => {
    this.view.set(index, value);
  }
}

export class NdarrayViewTranspose extends NdarrayView {
  view: NdarrayView;
  order: number[];
  shape: number[];

  constructor(view: NdarrayView, order: number[]) {
    super();

    const shape = view.shape;
    if (order.length != shape.length) {
      throw Error(`Transposed axis (${order.join(',')}) has mismatching size to view shape (${shape.join(',')})`);
    }

    const unique_dims = new Set(order);
    if (unique_dims.size != shape.length) {
      throw Error(`Duplicate dimension in tranposed axis (${order.join(',')})`);
    }

    for (let i = 0; i < order.length; i++) {
      const axis = order[i];
      if (axis >= order.length || axis < 0) {
        throw Error(`Transposed axis (${order.join(',')}) outside of range along dimension ${i}`);
      }
    }

    this.view = view;
    this.order = order;
    this.shape = order.map((i) => shape[i]);
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  private get_transposed_index = (index: number[]): number[] => {
    return this.order.map((i) => index[i]);
  }

  get = (index: number[]): number => {
    const i = this.get_transposed_index(index);
    return this.view.get(i);
  }

  set = (index: number[], value: number) => {
    const i = this.get_transposed_index(index);
    this.view.set(i, value);
  }
}

export class NdarrayViewStride extends NdarrayView {
  view: NdarrayView;
  shape: number[];
  stride: number[];

  constructor(view: NdarrayView, stride: number[]) {
    super();

    const shape = view.shape;
    if (stride.length != shape.length) {
      throw Error(`Stride (${stride.join(',')}) has mismatching dimensionality to view shape (${shape.join(',')})`);
    }

    this.view = view;
    this.stride = stride.slice();
    const new_shape = stride.map((e,i) => Math.ceil(shape[i]/e));
    this.shape = new_shape;
  }

  get dtype(): NdarrayType {
    return this.view.dtype;
  }

  private get_stride_index = (index: number[]): number[] => {
    return this.stride.map((e,i) => index[i]*e);
  }

  get = (index: number[]): number => {
    const i = this.get_stride_index(index);
    return this.view.get(i);
  }

  set = (index: number[], value: number) => {
    const i = this.get_stride_index(index);
    this.view.set(i, value);
  }
}

export class Ndarray extends NdarrayView {
  data: NdarrayData;
  shape: number[];
  stride: number[];
  dtype: NdarrayType;

  private constructor(data: NdarrayData, shape: number[], dtype: NdarrayType) {
    super();
    this.data = data;
    this.shape = shape;
    this.dtype = dtype;
    // precalculate stride for indexing
    let curr_stride = 1;
    const stride = [];
    for (let i = 0; i < shape.length; i++) {
      stride.push(curr_stride);
      const j = shape.length-1-i;
      curr_stride *= shape[j];
    }
    stride.reverse();
    this.stride = stride;
  }

  static create_zeros = (shape: number[], dtype: NdarrayType): Ndarray => {
    const total_elems = shape.reduce((a,b) => a*b, 1);
    const T = get_array_constructor_from_dtype(dtype);
    const data = new T(total_elems);
    return new Ndarray(data, shape.slice(), dtype);
  };

  static create_from_buffer = (shape: number[], data: NdarrayData): Ndarray => {
    const total_elems = shape.reduce((a,b) => a*b, 1);
    if (total_elems != data.length) {
      throw Error(`Mismatch between specified shape (${shape.join(',')}) => ${total_elems} and provided data with size ${data.length} for data: ${data.toString()}`);
    }
    const dtype = get_dtype_from_array(data);
    return new Ndarray(data, shape.slice(), dtype);
  };

  static create_arange = (shape: number[], dtype: NdarrayType): Ndarray => {
    return Ndarray.create_linspace(0, 1, shape, dtype);
  }

  static create_linspace = (start: number, step: number, shape: number[], dtype: NdarrayType): Ndarray => {
    const arr = Ndarray.create_zeros(shape, dtype);
    const index = new Array(shape.length).fill(0);
    let value = start;
    while (true) {
      arr.set(index, value);
      value += step;
      let is_finished = false;
      for (let i = 0; i < index.length; i++) {
        const j = index.length-1-i;
        index[j]++;
        if (index[j] < shape[j]) break;
        index[j] = 0;
        if (j == 0) is_finished = true;
      }
      if (is_finished) break;
    }
    return arr;
  }

  get_data_index = (index: number[]): number => {
    if (index.length != this.shape.length) {
      throw Error(`Index (${index.join(',')}) has mismatching dimension (${index.length}) to array shape (${this.shape.join(',')}) with dimension (${this.shape.length})`);
    }
    let array_index = 0;
    for (let i = 0; i < index.length; i++) {
      array_index += this.stride[i]*index[i];
    }
    return array_index;
  }

  get = (index: number[]): number => {
    const i = this.get_data_index(index);
    return this.data[i];
  }

  set = (index: number[], value: number) => {
    const i = this.get_data_index(index);
    this.data[i] = value;
  }

  cast<T extends NdarrayData>(type: { new (): T }): T {
    if (this.data instanceof type) {
      return this.data;
    }
    throw Error(`Invalid cast from '${this.dtype}' to '${type.toString()}'`)
  }

  fill = (value: number): Ndarray => {
    this.data.fill(value);
    return this;
  }

  export_as_numpy_bytecode = (writer: NdarrayWriter) => {
    // NUMPY file format
    // header | descriptor_length | descriptor | padding | newline
    //        | 2 bytes           |            |         | 1 byte

    // header
    const text_encoder = new TextEncoder();
    const magic_number = 0x93;
    const magic_label = text_encoder.encode("NUMPY");
    const major_version = 0x01;
    const minor_version = 0x00;
    const header = new Uint8Array([magic_number, ...magic_label, major_version, minor_version]);

    // descriptor
    let type_id = null;
    switch (this.dtype) {
      case "u8": type_id = "<B"; break;
      case "u8_clamped": type_id = "<B"; break;
      case "s8": type_id = "<b"; break;
      case "u16": type_id = "<u2"; break;
      case "s16": type_id = "<i2"; break;
      case "u32": type_id = "<u4"; break;
      case "s32": type_id = "<i4"; break;
      case "f32": type_id = "<f4"; break;
      case "f64": type_id = "<f8"; break;
    }
    const descriptor_string = `{`+
      `'descr':'${type_id}',` +
      `'fortran_order':False,` +
      `'shape':(${this.shape.join(",")},),` +
    `}`;
    const descriptor = text_encoder.encode(descriptor_string);

    // padding
    const unpadded_length = header.length + descriptor.length + 2 + 1;
    const padding_alignment = 64;
    const padded_length = Math.ceil(unpadded_length / padding_alignment) * padding_alignment;
    const total_padding = padded_length-unpadded_length;

    // data
    const total_elems = this.shape.reduce((a,b) => a*b, 1);
    const total_data_bytes = total_elems*this.data.BYTES_PER_ELEMENT;

    // assemble
    const u8_buf = writer.init(padded_length+total_data_bytes);
    const data_view = new DataView(u8_buf.buffer, u8_buf.byteOffset, u8_buf.byteLength);
    // header
    let write_offset = 0;
    u8_buf.set(header, write_offset);
    write_offset += header.length;
    // descriptor size
    const is_little_endian = true;
    data_view.setUint16(write_offset, descriptor.length+total_padding+1, is_little_endian);
    write_offset += 2;
    // descriptor
    u8_buf.set(descriptor, write_offset);
    write_offset += descriptor.length;
    // padding and newline
    const [space, newline] = text_encoder.encode(" \n");
    u8_buf.fill(space, write_offset, write_offset+total_padding);
    write_offset += total_padding;
    data_view.setUint8(write_offset, newline);
    write_offset += 1;
    // data
    const T = get_array_constructor_from_dtype(this.dtype);
    new T(u8_buf.buffer, u8_buf.byteOffset+write_offset, total_elems).set(this.data)
  }
}

export interface NdarrayWriter {
  init: (size: number) => Uint8Array;
}

export class Uint8ArrayNdarrayWriter implements NdarrayWriter {
  buffer?: Uint8Array;
  init(size: number): Uint8Array {
    this.buffer = new Uint8Array(size);
    return this.buffer;
  }
}
