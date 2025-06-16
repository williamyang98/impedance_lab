import {
  default as init_module,
  type MainModule, type ClassHandle,
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
  type LU_Solver as _LU_Solver,
} from "./build/wasm_module.js";

interface ManagedObject {
  module: WasmModule;
}

// Wrap around the emscripten typescript bindings with something less jank
export class WasmModule {
  main: MainModule;
  heap_objects = {
    weak_refs: new WeakSet<ManagedObject>(),
    size: 0,
  };
  finalisation_registry: FinalizationRegistry<ClassHandle>;

  private constructor(main: MainModule) {
    this.main = main;

    // NOTE: manually cleanup entries
    //       emscripten generates [Symbol.dispose] which is only supported on ESNext.
    //       Instead we will target ES2022 which is widely available and has FinalizationRegistry
    this.finalisation_registry = new FinalizationRegistry<ClassHandle>((handle) => {
      if (!handle.isDeleted()) {
        handle.delete();
        this.heap_objects.size -= 1;
      }
    });
  }

  static async init(): Promise<WasmModule> {
    const module = await init_module();
    return new WasmModule(module);
  }

  // module memory management
  get heap(): Uint8Array {
    return this.main.HEAP8 as Uint8Array;
  }

  assert_owned(object: ManagedObject) {
    if (this.main !== object.module.main) {
      throw Error("Got differing modules");
    }
  }

  register_heap(object: ManagedObject, handle: ClassHandle) {
    this.assert_owned(object);
    if (this.heap_objects.weak_refs.has(object)) {
      throw Error("Tried to register a heap object again");
    }
    this.heap_objects.size += 1;
    this.heap_objects.weak_refs.add(object);
    this.finalisation_registry.register(object, handle);
  }

  unregister_heap(object: ManagedObject) {
    this.assert_owned(object);
    if (!this.heap_objects.weak_refs.has(object)) {
      throw Error("Tried to unregister a heap object that isn't being tracked");
    }
    this.heap_objects.size -= 1;
    this.heap_objects.weak_refs.delete(object);
    this.finalisation_registry.unregister(object);
  }

  // module functions
  calculate_homogenous_energy_2d(
    ex_field: Float32ModuleBuffer, ey_field: Float32ModuleBuffer,
    dx: Float32ModuleBuffer, dy: Float32ModuleBuffer,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);

    return this.main.calculate_homogenous_energy_2d(ex_field.pin, ey_field.pin, dx.pin, dy.pin);
  }

  calculate_inhomogenous_energy_2d(
    ex_field: Float32ModuleBuffer, ey_field: Float32ModuleBuffer,
    dx: Float32ModuleBuffer, dy: Float32ModuleBuffer,
    er_table: Float32ModuleBuffer, er_index_beta: Uint32ModuleBuffer,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);
    this.assert_owned(er_table);
    this.assert_owned(er_index_beta);

    return this.main.calculate_inhomogenous_energy_2d(
      ex_field.pin, ey_field.pin,
      dx.pin, dy.pin,
      er_table.pin, er_index_beta.pin,
    );
  }

  calculate_e_field(
    ex_field_out: Float32ModuleBuffer, ey_field_out: Float32ModuleBuffer,
    v_field_in: Float32ModuleBuffer,
    dx_in: Float32ModuleBuffer, dy_in: Float32ModuleBuffer,
  ): void {
    this.assert_owned(ex_field_out);
    this.assert_owned(ey_field_out);
    this.assert_owned(v_field_in);
    this.assert_owned(dx_in);
    this.assert_owned(dy_in);

    return this.main.calculate_e_field(
      ex_field_out.pin, ey_field_out.pin,
      v_field_in.pin,
      dx_in.pin, dy_in.pin,
    );
  }

  convert_f32_to_f16(f32_in: Float32ModuleBuffer, f16_out: Uint16ModuleBuffer): void {
    return this.main.convert_f32_to_f16(f32_in.pin, f16_out.pin);
  }
}

type TypedPinnedArray =
  Uint8PinnedArray | Int8PinnedArray |
  Uint16PinnedArray | Int16PinnedArray |
  Uint32PinnedArray | Int32PinnedArray |
  Float32PinnedArray | Float64PinnedArray;

type TypedArrayViewConstructor =
  Uint8ArrayConstructor | Int8ArrayConstructor |
  Uint16ArrayConstructor | Int16ArrayConstructor |
  Uint32ArrayConstructor | Int32ArrayConstructor |
  Float32ArrayConstructor | Float64ArrayConstructor;

export interface IModuleBuffer extends ManagedObject {
  get data_view(): Uint8Array;
}

class ModuleBuffer<T extends TypedPinnedArray, U extends TypedArrayViewConstructor> implements IModuleBuffer {
  readonly module: WasmModule;
  readonly pin: T;
  readonly ctor: U;

  constructor(module: WasmModule, arg: number | ArrayLike<number>, get_pin: (length: number) => T, ctor: U) {
    this.module = module;
    if (typeof arg === "number") {
      const length = arg;
      this.pin = get_pin(length);
      this.ctor = ctor;
    } else {
      const length = arg.length;
      this.pin = get_pin(length);
      this.ctor = ctor;
      this.array_view.set(arg)
    }
    this.module.register_heap(this, this.pin);
  }

  get data_view() {
    const array_view = this.array_view;
    return new Uint8Array(array_view.buffer, array_view.byteOffset, array_view.byteLength);
  }

  get array_view() {
    return new this.ctor(this.module.main.HEAP8.buffer, this.pin.address, this.pin.length);
  }

  get length(): number {
    return this.pin.length;
  }

  set(other: ModuleBuffer<T,U>) {
    this.array_view.set(other.array_view);
  }
}

export class Uint8ModuleBuffer extends ModuleBuffer<Uint8PinnedArray, Uint8ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Uint8PinnedArray.owned_pin_from_malloc(N)!, Uint8Array);
  }
}

export class Int8ModuleBuffer extends ModuleBuffer<Int8PinnedArray, Int8ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Int8PinnedArray.owned_pin_from_malloc(N)!, Int8Array);
  }
}

export class Uint16ModuleBuffer extends ModuleBuffer<Uint16PinnedArray, Uint16ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Uint16PinnedArray.owned_pin_from_malloc(N)!, Uint16Array);
  }
}

export class Int16ModuleBuffer extends ModuleBuffer<Int16PinnedArray, Int16ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Int16PinnedArray.owned_pin_from_malloc(N)!, Int16Array);
  }
}

export class Uint32ModuleBuffer extends ModuleBuffer<Uint32PinnedArray, Uint32ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Uint32PinnedArray.owned_pin_from_malloc(N)!, Uint32Array);
  }
}

export class Int32ModuleBuffer extends ModuleBuffer<Int32PinnedArray, Int32ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Int32PinnedArray.owned_pin_from_malloc(N)!, Int32Array);
  }
}

export class Float32ModuleBuffer extends ModuleBuffer<Float32PinnedArray, Float32ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Float32PinnedArray.owned_pin_from_malloc(N)!, Float32Array);
  }
}

export class Float64ModuleBuffer extends ModuleBuffer<Float64PinnedArray, Float64ArrayConstructor> {
  constructor(module: WasmModule, arg: number | ArrayLike<number>) {
    super(module, arg, N => module.main.Float64PinnedArray.owned_pin_from_malloc(N)!, Float64Array);
  }
}

export type TypedModuleBuffer =
  Uint8ModuleBuffer |
  Int8ModuleBuffer |
  Uint16ModuleBuffer |
  Int16ModuleBuffer |
  Uint32ModuleBuffer |
  Int32ModuleBuffer |
  Float32ModuleBuffer |
  Float64ModuleBuffer;

export class LU_Solver implements ManagedObject {
  readonly inner: _LU_Solver;
  module: WasmModule;

  constructor(
    module: WasmModule,
    A_non_zero_data: Float32ModuleBuffer,
    A_col_indices: Int32ModuleBuffer, A_row_index_pointers: Int32ModuleBuffer,
    total_rows: number, total_columns: number
  ) {
    module.assert_owned(A_non_zero_data);
    module.assert_owned(A_col_indices);
    module.assert_owned(A_row_index_pointers);

    this.module = module;
    const inner = module.main.LU_Solver.create(
      A_non_zero_data.pin,
      A_col_indices.pin, A_row_index_pointers.pin,
      total_rows, total_columns,
    );
    if (inner === null) {
      throw Error("WASM module LU_Solver.create returned null");
    }
    this.inner = inner;
    module.register_heap(this, this.inner);
  }

  solve(b: Float32ModuleBuffer): number {
    return this.inner.solve(b.pin);
  }
}
