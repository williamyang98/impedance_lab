import {
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
} from "./build/wasm_module.js";
import { type NdarrayType } from "../utility/ndarray.js";
import { ReferenceBlock, type ManagedObject } from "./memory.js";
import { WasmModule } from "./index.ts";

export type TypedModuleArray =
  ModuleUint8Array | ModuleInt8Array |
  ModuleUint16Array | ModuleInt16Array |
  ModuleUint32Array | ModuleInt32Array |
  ModuleFloat32Array | ModuleFloat64Array |
  ModuleUint8ClampedArray;

export function get_typed_module_array(module: WasmModule, length: number, dtype: NdarrayType): TypedModuleArray {
  switch (dtype) {
  case "s8": return new ModuleInt8Array(module, length);
  case "u8": return new ModuleUint8Array(module, length);
  case "s16": return new ModuleInt16Array(module, length);
  case "u16": return new ModuleUint16Array(module, length);
  case "s32": return new ModuleInt32Array(module, length);
  case "u32": return new ModuleUint32Array(module, length);
  case "f32": return new ModuleFloat32Array(module, length);
  case "f64": return new ModuleFloat64Array(module, length);
  case "u8_clamped": return new ModuleUint8ClampedArray(module, length);
  }
}

export class ModuleUint8Array extends Uint8Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Uint8PinnedArray;

  constructor(module: WasmModule, length: number | Uint8PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Uint8PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Uint8PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Uint8Array<ArrayBuffer> {
    const data = new Uint8Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleInt8Array extends Int8Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Int8PinnedArray;

  constructor(module: WasmModule, length: number | Int8PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Int8PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Int8PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Int8Array<ArrayBuffer> {
    const data = new Int8Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleUint16Array extends Uint16Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Uint16PinnedArray;

  constructor(module: WasmModule, length: number | Uint16PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Uint16PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Uint16PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Uint16Array<ArrayBuffer> {
    const data = new Uint16Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleInt16Array extends Int16Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Int16PinnedArray;

  constructor(module: WasmModule, length: number | Int16PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Int16PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Int16PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Int16Array<ArrayBuffer> {
    const data = new Int16Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleUint32Array extends Uint32Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Uint32PinnedArray;

  constructor(module: WasmModule, length: number | Uint32PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Uint32PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Uint32PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Uint32Array<ArrayBuffer> {
    const data = new Uint32Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleInt32Array extends Int32Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Int32PinnedArray;

  constructor(module: WasmModule, length: number | Int32PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Int32PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Int32PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Int32Array<ArrayBuffer> {
    const data = new Int32Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleFloat32Array extends Float32Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Float32PinnedArray;

  constructor(module: WasmModule, length: number | Float32PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Float32PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Float32PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Float32Array<ArrayBuffer> {
    const data = new Float32Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleFloat64Array extends Float64Array<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Float64PinnedArray;

  constructor(module: WasmModule, length: number | Float64PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Float64PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Float64PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Float64Array<ArrayBuffer> {
    const data = new Float64Array(this.length);
    data.set(this);
    return data;
  }
}

export class ModuleUint8ClampedArray extends Uint8ClampedArray<ArrayBuffer> implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  typed_pinned_array: Uint8PinnedArray;

  constructor(module: WasmModule, length: number | Uint8PinnedArray) {
    let typed_pinned_array = undefined;
    if (typeof length === "number") {
      typed_pinned_array = module.main.Uint8PinnedArray.owned_pin_from_malloc(length);
      if (typed_pinned_array === null) {
        throw Error(`malloc failed for Uint8PinnedArray.owned_pin_from_malloc(${length})`);
      }
    } else {
      typed_pinned_array = length;
    }
    super(module.heap.buffer, typed_pinned_array.address, typed_pinned_array.length);
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.typed_pinned_array = typed_pinned_array;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.typed_pinned_array.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  override slice(): Uint8ClampedArray<ArrayBuffer> {
    const data = new Uint8ClampedArray(this.length);
    data.set(this);
    return data;
  }
}
