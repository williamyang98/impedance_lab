import {
  default as init_module,
  type MainModule,
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
  type LU_Solver as _LU_Solver,
  type ZipFile as _ZipFile,
} from "./build/wasm_module.js";

export {
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
} from "./build/wasm_module.js";

export interface ReferenceCount {
  count: number;
}

export abstract class ManagedObject {
  readonly module: WasmModule;
  reference_count: ReferenceCount;
  _child_objects: Set<ManagedObject>;

  constructor(module: WasmModule) {
    this.module = module;
    this.reference_count = { count: 1 };
    this._child_objects = new Set();
    this.module.register_object(this);
  }

  clone() {
    this.reference_count.count += 1;
    return this;
  }

  on_delete(): void {
    this.module.unregister_object(this);
  }

  delete(): boolean {
    this.reference_count.count -= 1;
    if (this.reference_count.count > 0) return false;
    if (this.reference_count.count < 0) {
      console.error(`Attempted to double free with ref_count=${this.reference_count.count}`);
      return true;
    }
    this.on_delete();
    return true;
  }

  is_deleted(): boolean {
    return this.reference_count.count <= 0;
  }
}

type StackTrace = string;
interface FinalizationEntry {
  children: Set<ManagedObject>;
  reference_count: ReferenceCount;
  parent_stack_trace?: StackTrace; // need to track this separately since parent is deallocated
}

// Wrap around the emscripten typescript bindings with something less jank
export class WasmModule {
  main: MainModule;
  heap_objects = {
    stack_trace: new WeakMap<ManagedObject, StackTrace>(),
    weak_refs: new WeakMap<ManagedObject, FinalizationEntry>(),
    size: 0,
  };
  finalisation_registry: FinalizationRegistry<FinalizationEntry>;
  debug_console?: Console = import.meta.env.DEV ? console : undefined;

  private constructor(main: MainModule) {
    this.main = main;
    this.finalisation_registry = this.create_finalization_registry();
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

  // NOTE: Our manual memory management setup to free/track parent/children allocations
  // 1. We should always try to use register/unregister to perform manual cleanup of children.
  //    This has to be done anyway to avoid WASM memory leaks, so we should by default rely on it
  //    to free memory dependencies between parent and child ManagedObjects.
  // 2. Cannot rely on javascript engine to garbage collect ManagedObjects in a timely manner.
  //    This delay in garbage collection causes the WASM linear heap to grow to an extremely large size.
  //    Since the WASM heap cannot shrink (https://github.com/WebAssembly/design/issues/1397) this results
  //    in a permanent waste of heap space.
  //    By freeing manually we keep the heap size to a relatively small size.
  // 3. Additionally even though emscripten generates [Symbol.dispose] this is only supported on ESNext.
  //    The proposal is not finalised: (https://github.com/tc39/proposal-explicit-resource-management).
  //    Instead we will target ES2022 which is widely available and has FinalizationRegistry.
  //    Compatability matrix: (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry#browser_compatibility).
  create_finalization_registry() {
    return new FinalizationRegistry<FinalizationEntry>((entry) => {
      const children = entry.children;
      const total_children = children.size;
      const dangling_children = [];
      for (const child of entry.children) {
        if (!child.is_deleted()) {
          dangling_children.push(child);
        }
      }
      const reference_count = entry.reference_count.count;
      let has_error = false;
      if (reference_count != 0) {
        this.debug_console?.warn(`Manually cleaning up reference counted object with ref_count=${reference_count}`);
        has_error = true;
      }
      if (dangling_children.length > 0) {
        this.debug_console?.warn(`Manually cleaning up after parent object which left ${dangling_children.length}/${total_children} child objects dangling`);
        has_error = true;
      }
      if (has_error && entry.parent_stack_trace) {
        this.debug_console?.warn(entry.parent_stack_trace);
      }
      if (dangling_children.length > 0) {
        for (let i = 0; i < dangling_children.length; i++) {
          this.debug_console?.warn(`Deleting child object ${i+1}/${total_children}`);
          const child = dangling_children[i];
          child.delete();
          if (this.debug_console) {
            const stack_trace = this.heap_objects.stack_trace.get(child);
            if (stack_trace) {
              this.debug_console.warn(stack_trace);
            }
          }
        }
      }
      this.heap_objects.size -= 1;
    });
  }

  register_object(parent: ManagedObject) {
    this.assert_owned(parent);
    let finalization_entry = this.heap_objects.weak_refs.get(parent);
    if (finalization_entry === undefined) {
      let stack_trace: StackTrace | undefined = undefined;
      if (import.meta.env.DEV) {
        stack_trace = new Error().stack
      }
      if (stack_trace) {
        this.heap_objects.stack_trace.set(parent, stack_trace);
      }
      finalization_entry = {
        parent_stack_trace: stack_trace,
        reference_count: parent.reference_count,
        children: new Set(),
      };
      this.heap_objects.weak_refs.set(parent, finalization_entry);
      this.heap_objects.size += 1;
      this.finalisation_registry.register(parent, finalization_entry, finalization_entry);
    }
  }

  unregister_object(parent: ManagedObject) {
    this.assert_owned(parent);
    const finalization_entry = this.heap_objects.weak_refs.get(parent);
    if (finalization_entry === undefined) {
      this.debug_console?.error("Tried to unregister a parent that isn't being tracked");
      return;
    }
    if (!this.finalisation_registry.unregister(finalization_entry)) {
      this.debug_console?.error("Failed to unregister parent object from finalization entry: ", parent);
    }
    this.heap_objects.weak_refs.delete(parent);
    this.heap_objects.size -= 1;
    for (const child of parent._child_objects) {
      if (!child.delete()) {
        this.debug_console?.warn("Tried to unregister and delete a child object that was already deleted: ", child);
      }
    }
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

export type TypedPinnedArray =
  Uint8PinnedArray | Int8PinnedArray |
  Uint16PinnedArray | Int16PinnedArray |
  Uint32PinnedArray | Int32PinnedArray |
  Float32PinnedArray | Float64PinnedArray;

export type TypedArrayViewConstructor =
  Uint8ArrayConstructor | Int8ArrayConstructor |
  Uint16ArrayConstructor | Int16ArrayConstructor |
  Uint32ArrayConstructor | Int32ArrayConstructor |
  Float32ArrayConstructor | Float64ArrayConstructor;

export abstract class IModuleBuffer extends ManagedObject {
  abstract get data_view(): Uint8Array;
  abstract get module_data_view(): Uint8ModuleBuffer;
}

export class ModuleBuffer<T extends TypedPinnedArray, U extends TypedArrayViewConstructor> extends IModuleBuffer {
  readonly pin: T;
  readonly ctor: U;
  readonly is_owned: boolean;

  constructor(module: WasmModule, pin: T, ctor: U, is_owned: boolean) {
    super(module);
    this.pin = pin;
    this.ctor = ctor;
    this.is_owned = is_owned;
  }

  override on_delete(): void {
    if (this.is_owned) {
      this.pin.delete();
    }
    super.on_delete();
  }

  override get data_view() {
    const array_view = this.array_view;
    return new Uint8Array(array_view.buffer, array_view.byteOffset, array_view.byteLength);
  }

  override get module_data_view(): Uint8ModuleBuffer {
    const pin = this.module.main.Uint8PinnedArray.from_pin(this.pin.pin);
    if (pin === null) throw Error("Uint8PinnedArray.from_pin returned null");
    return new Uint8ModuleBuffer(this.module, pin, false);
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
  constructor(module: WasmModule, pin: Uint8PinnedArray, is_owned: boolean) {
    super(module, pin, Uint8Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Uint8ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Uint8PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint8PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Uint8ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Int8ModuleBuffer extends ModuleBuffer<Int8PinnedArray, Int8ArrayConstructor> {
  constructor(module: WasmModule, pin: Int8PinnedArray, is_owned: boolean) {
    super(module, pin, Int8Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Int8ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Int8PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int8PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Int8ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Uint16ModuleBuffer extends ModuleBuffer<Uint16PinnedArray, Uint16ArrayConstructor> {
  constructor(module: WasmModule, pin: Uint16PinnedArray, is_owned: boolean) {
    super(module, pin, Uint16Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Uint16ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Uint16PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint16PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Uint16ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Int16ModuleBuffer extends ModuleBuffer<Int16PinnedArray, Int16ArrayConstructor> {
  constructor(module: WasmModule, pin: Int16PinnedArray, is_owned: boolean) {
    super(module, pin, Int16Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Int16ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Int16PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int16PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Int16ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Uint32ModuleBuffer extends ModuleBuffer<Uint32PinnedArray, Uint32ArrayConstructor> {
  constructor(module: WasmModule, pin: Uint32PinnedArray, is_owned: boolean) {
    super(module, pin, Uint32Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Uint32ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Uint32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Uint32PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Uint32ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Int32ModuleBuffer extends ModuleBuffer<Int32PinnedArray, Int32ArrayConstructor> {
  constructor(module: WasmModule, pin: Int32PinnedArray, is_owned: boolean) {
    super(module, pin, Int32Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Int32ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Int32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Int32PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Int32ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Float32ModuleBuffer extends ModuleBuffer<Float32PinnedArray, Float32ArrayConstructor> {
  constructor(module: WasmModule, pin: Float32PinnedArray, is_owned: boolean) {
    super(module, pin, Float32Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Float32ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Float32PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Float32PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Float32ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
  }
}

export class Float64ModuleBuffer extends ModuleBuffer<Float64PinnedArray, Float64ArrayConstructor> {
  constructor(module: WasmModule, pin: Float64PinnedArray, is_owned: boolean) {
    super(module, pin, Float64Array, is_owned);
  }

  static create(module: WasmModule, arg: number | ArrayLike<number>): Float64ModuleBuffer {
    const length = (typeof arg === "number") ? arg : arg.length;
    const pin = module.main.Float64PinnedArray.owned_pin_from_malloc(length);
    if (pin === null) throw Error("Float64PinnedArray.owned_pin_from_malloc returned null");
    const buffer = new Float64ModuleBuffer(module, pin, true);
    if (typeof arg !== "number") buffer.array_view.set(arg);
    return buffer;
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

export class LU_Solver extends ManagedObject {
  readonly inner: _LU_Solver;

  constructor(
    module: WasmModule,
    A_non_zero_data: Float32ModuleBuffer,
    A_col_indices: Int32ModuleBuffer, A_row_index_pointers: Int32ModuleBuffer,
    total_rows: number, total_columns: number
  ) {
    super(module);
    module.assert_owned(A_non_zero_data);
    module.assert_owned(A_col_indices);
    module.assert_owned(A_row_index_pointers);

    if (A_non_zero_data.length !== A_col_indices.length) {
      throw new Error(`Mismatching number of non-zero elements in data (${A_non_zero_data.length}) and number of column-indices (${A_col_indices.length})`);
    }
    if (A_row_index_pointers.length !== (total_rows+1)) {
      throw new Error(`Mismatching number of row index pointers (${A_row_index_pointers.length}) and total_rows+1 (${total_rows}+1)`);
    }

    const { solver, lu_factor_info } = module.main.LU_Solver.create(
      A_non_zero_data.pin,
      A_col_indices.pin, A_row_index_pointers.pin,
      total_rows, total_columns,
    );
    if (solver === null) {
      throw Error(`WASM module LU_Solver.create returned null with error code: ${lu_factor_info}`);
    }
    this.inner = solver;
  }

  solve(b: Float32ModuleBuffer): number {
    if (this.total_cols !== b.length) {
      throw Error(`Mismatch between LU factorised matrix which has ${this.total_cols} columns and expects b with ${this.total_cols} rows but got ${b.length}`);
    }
    return this.inner.solve(b.pin);
  }

  get total_rows(): number { return this.inner.total_rows; }
  get total_cols(): number { return this.inner.total_cols; }

  override on_delete() {
    this.inner.delete();
    super.on_delete();
  }
}

export class ZipFile extends ManagedObject {
  readonly inner: _ZipFile;

  constructor(
    module: WasmModule,
  ) {
    super(module);
    const inner = module.main.ZipFile.create();
    if (inner === null) throw Error("WASM module ZipFile.create returned null");
    this.inner = inner;
  }

  override on_delete() {
    this.inner.delete();
    super.on_delete();
  }

  write_file(name: string, data: Uint8ModuleBuffer) {
    this.module.assert_owned(data);
    this.inner.write_file(name, data.pin);
  }

  get_bytes(): Uint8ModuleBuffer {
    const data = this.inner.get_bytes();
    if (data === null) throw Error("ZipFile.get_bytes returned null");
    return new Uint8ModuleBuffer(this.module, data, true);
  }
}
