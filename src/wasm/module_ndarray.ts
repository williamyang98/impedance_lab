import { ReferenceBlock, type ManagedObject } from "./memory.js";
import { WasmModule } from "./index.ts";
import { get_dtype_from_array, type NdarrayData, type NdarrayType, NdarrayView, type NdarrayWriter } from "../utility/ndarray.js";
import { ModuleUint8Array, type TypedModuleArray, get_typed_module_array } from "./typed_array.ts";

export class ModuleNdarray extends NdarrayView implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  override shape: number[];
  override dtype: NdarrayType;
  data: TypedModuleArray;
  stride: number[];

  private constructor(module: WasmModule, data: TypedModuleArray, shape: number[], dtype: NdarrayType) {
    super();
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.reference_block.children.add(data);
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

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    return this.reference_block.delete(this);
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  static create_zeros(module: WasmModule, shape: number[], dtype: NdarrayType): ModuleNdarray {
    const total_elems = shape.reduce((a,b) => a*b, 1);
    const data = get_typed_module_array(module, total_elems, dtype);
    return new ModuleNdarray(module, data, shape.slice(), dtype);
  };

  static create_from_buffer(module: WasmModule, shape: number[], data: NdarrayData): ModuleNdarray {
    const total_elems = shape.reduce((a,b) => a*b, 1);
    if (total_elems != data.length) {
      throw Error(`Mismatch between specified shape (${shape.join(',')}) => ${total_elems} and provided data with size ${data.length} for data: ${data.toString()}`);
    }
    const dtype = get_dtype_from_array(data);
    const module_data = get_typed_module_array(module, total_elems, dtype);
    module_data.set(data);
    return new ModuleNdarray(module, module_data, shape.slice(), dtype);
  };

  static create_linspace(module: WasmModule, start: number, step: number, shape: number[], dtype: NdarrayType): ModuleNdarray {
    const arr = ModuleNdarray.create_zeros(module, shape.slice(), dtype);
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

  static create_arange(module: WasmModule, shape: number[], dtype: NdarrayType): ModuleNdarray {
    return ModuleNdarray.create_linspace(module, 0, 1, shape.slice(), dtype);
  }

  static own_from_view(module: WasmModule, view: NdarrayView): ModuleNdarray {
    const arr = ModuleNdarray.create_zeros(module, view.shape.slice(), view.dtype);
    const index = new Array(view.shape.length).fill(0);
    while (true) {
      const value = view.get(index);
      arr.set(index, value);
      let is_finished = false;
      for (let i = 0; i < index.length; i++) {
        const j = index.length-1-i;
        index[j]++;
        if (index[j] < view.shape[j]) break;
        index[j] = 0;
        if (j == 0) is_finished = true;
      }
      if (is_finished) break;
    }
    return arr;
  }

  get_data_index(index: number[]): number {
    if (index.length != this.shape.length) {
      throw Error(`Index (${index.join(',')}) has mismatching dimension (${index.length}) to array shape (${this.shape.join(',')}) with dimension (${this.shape.length})`);
    }
    let array_index = 0;
    for (let i = 0; i < index.length; i++) {
      array_index += this.stride[i]*index[i];
    }
    return array_index;
  }

  override get(index: number[]): number {
    const i = this.get_data_index(index);
    return this.data[i];
  }

  override set(index: number[], value: number) {
    const i = this.get_data_index(index);
    this.data[i] = value;
  }

  override fill(value: number): this {
    this.data.fill(value);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cast<T extends TypedModuleArray>(type: { new (...args: any[]): T }): T {
    if (this.data instanceof type) {
      return this.data;
    }
    throw Error(`Invalid cast from '${this.dtype}' to '${type.toString()}'`)
  }
}

export class ModuleNdarrayWriter implements NdarrayWriter, ManagedObject {
  readonly module: WasmModule;
  buffer?: ModuleUint8Array;
  reference_block: ReferenceBlock;

  constructor(module: WasmModule) {
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
  }

  init(size: number): Uint8Array<ArrayBuffer> {
    this.buffer = new ModuleUint8Array(this.reference_block.module, size);
    this.reference_block.children.add(this.buffer);
    return this.buffer;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    return this.reference_block.delete(this);
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }
}
