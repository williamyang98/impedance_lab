import { Ndarray, type NdarrayWriter } from "./ndarray.ts";
import {
  WasmModule,
  type ManagedObject,
  type IModuleBuffer, ModuleBuffer,
  type TypedPinnedArray, type TypedArrayViewConstructor,
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
  Uint8ModuleBuffer,
} from "../wasm/index.ts";

export interface IModuleNdarray extends IModuleBuffer {
  readonly shape: number[];
  get ndarray(): Ndarray;
}

export class ModuleNdarray<T extends TypedPinnedArray, U extends TypedArrayViewConstructor> extends ModuleBuffer<T, U> implements IModuleNdarray {
  readonly shape: number[];

  constructor(module: WasmModule, pin: T, ctor: U, shape: number[], is_owned: boolean) {
    super(module, pin, ctor, is_owned);
    this.shape = shape;
  }

  get ndarray(): Ndarray {
    return Ndarray.create_from_buffer(this.shape, this.array_view);
  }
}

export class Uint8ModuleNdarray extends ModuleNdarray<Uint8PinnedArray, Uint8ArrayConstructor> {
  constructor(module: WasmModule, pin: Uint8PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Uint8Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Uint8ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Uint8PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint8PinnedArray.owned_pin_from_malloc returned null");
    return new Uint8ModuleNdarray(module, pin, shape, true);
  }
}

export class Int8ModuleNdarray extends ModuleNdarray<Int8PinnedArray, Int8ArrayConstructor> {
  constructor(module: WasmModule, pin: Int8PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Int8Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Int8ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Int8PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int8PinnedArray.owned_pin_from_malloc returned null");
    return new Int8ModuleNdarray(module, pin, shape, true);
  }
}

export class Uint16ModuleNdarray extends ModuleNdarray<Uint16PinnedArray, Uint16ArrayConstructor> {
  constructor(module: WasmModule, pin: Uint16PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Uint16Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Uint16ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Uint16PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint16PinnedArray.owned_pin_from_malloc returned null");
    return new Uint16ModuleNdarray(module, pin, shape, true);
  }
}

export class Int16ModuleNdarray extends ModuleNdarray<Int16PinnedArray, Int16ArrayConstructor> {
  constructor(module: WasmModule, pin: Int16PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Int16Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Int16ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Int16PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int16PinnedArray.owned_pin_from_malloc returned null");
    return new Int16ModuleNdarray(module, pin, shape, true);
  }
}

export class Uint32ModuleNdarray extends ModuleNdarray<Uint32PinnedArray, Uint32ArrayConstructor> {
  constructor(module: WasmModule, pin: Uint32PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Uint32Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Uint32ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Uint32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint32PinnedArray.owned_pin_from_malloc returned null");
    return new Uint32ModuleNdarray(module, pin, shape, true);
  }
}

export class Int32ModuleNdarray extends ModuleNdarray<Int32PinnedArray, Int32ArrayConstructor> {
  constructor(module: WasmModule, pin: Int32PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Int32Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Int32ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Int32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int32PinnedArray.owned_pin_from_malloc returned null");
    return new Int32ModuleNdarray(module, pin, shape, true);
  }
}

export class Float32ModuleNdarray extends ModuleNdarray<Float32PinnedArray, Float32ArrayConstructor> {
  constructor(module: WasmModule, pin: Float32PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Float32Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Float32ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Float32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Float32PinnedArray.owned_pin_from_malloc returned null");
    return new Float32ModuleNdarray(module, pin, shape, true);
  }
}

export class Float64ModuleNdarray extends ModuleNdarray<Float64PinnedArray, Float64ArrayConstructor> {
  constructor(module: WasmModule, pin: Float64PinnedArray, shape: number[], is_owned: boolean) {
    super(module, pin, Float64Array, shape, is_owned);
  }

  static from_shape(module: WasmModule, shape: number[]): Float64ModuleNdarray {
    const length = shape.reduce((a,b) => a*b, 1);
    const pin = module.main.Float64PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Float64PinnedArray.owned_pin_from_malloc returned null");
    return new Float64ModuleNdarray(module, pin, shape, true);
  }
}

export class ModuleNdarrayWriter implements NdarrayWriter, ManagedObject {
  readonly module: WasmModule;
  _is_deleted: boolean = false;
  write_buffer?: Uint8ModuleBuffer;

  constructor(module: WasmModule) {
    this.module = module;
  }

  init(size: number): Uint8Array {
    const buffer = Uint8ModuleBuffer.create(this.module, size);
    this.write_buffer = buffer;
    this.module.register_parent_and_children(this, buffer);
    return buffer.data_view;
  }

  delete(): boolean {
    if (this._is_deleted) return false;
    this._is_deleted = true;
    this.module.unregister_parent_and_children(this);
    return true;
  }

  is_deleted(): boolean {
    return this._is_deleted;
  }
}
