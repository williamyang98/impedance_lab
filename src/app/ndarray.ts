export type NdarrayData =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export type NdarrayType =
  "s8" | "u8" | "u8_clamped"|
  "s16" | "u16" |
  "s32" | "u32" |
  "f32" | "f64";

const create_array = (size: number, dtype: NdarrayType): NdarrayData => {
  switch (dtype) {
  case "s8": return new Int8Array(size);
  case "u8": return new Uint8Array(size);
  case "u8_clamped": return new Uint8ClampedArray(size);
  case "s16": return new Int16Array(size);
  case "u16": return new Uint16Array(size);
  case "s32": return new Int32Array(size);
  case "u32": return new Uint32Array(size);
  case "f32": return new Float32Array(size);
  case "f64": return new Float64Array(size);
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
  throw Error(`Unknown dtype for buffer: ${buffer}`);
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
      throw Error(`Offset (${offset}) has mismatching dimension (${offset.length}) to array view shape (${view.shape}) with dimension (${view.shape.length})`);
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
      throw Error(`Offset (${offset}) has mismatching dimension (${offset.length}) to array view shape (${view.shape}) with dimension (${view.shape.length})`);
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
    const data = create_array(total_elems, dtype);
    return new Ndarray(data, shape.slice(), dtype);
  };

  static create_from_buffer = (shape: number[], data: NdarrayData): Ndarray => {
    const total_elems = shape.reduce((a,b) => a*b, 1);
    if (total_elems != data.length) {
      throw Error(`Mismatch between specified shape (${shape.join(',')}) => ${total_elems} and provided data with size ${data.length} for data: ${data}`);
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
      throw Error(`Index (${index}) has mismatching dimension (${index.length}) to array shape (${this.shape}) with dimension (${this.shape.length})`);
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
    throw Error(`Invalid cast from '${this.dtype}' to '${type}'`)
  }
}
