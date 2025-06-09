import {
  default as init_module,
  type MainModule,
  type Uint8PinnedArray, type Int8PinnedArray,
  type Uint16PinnedArray, type Int16PinnedArray,
  type Uint32PinnedArray, type Int32PinnedArray,
  type Float32PinnedArray, type Float64PinnedArray,
  type LU_Solver as _LU_Solver,
} from "./build/wasm_module.js";

// Wrap around the emscripten typescript bindings with something less jank
// Use a singleton for ease of use
let _mod: MainModule | undefined = undefined;
export async function init() {
  if (_mod === undefined) {
    _mod = await init_module();
  }
}

function mod(): MainModule {
  if (_mod === undefined) {
    throw Error(`Wasm module was not initialised yet`);
  }
  return _mod;
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

class ModuleBuffer<T extends TypedPinnedArray, U extends TypedArrayViewConstructor> {
  readonly pin: T;
  readonly ctor: U;

  constructor(arg: number | ArrayLike<number>, get_pin: (length: number) => T, ctor: U) {
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
  }

  get array_view() {
    return new this.ctor(mod().HEAP8.buffer, this.pin.address, this.pin.length);
  }

  delete() {
    this.pin.delete();
  }

  is_deleted() {
    return this.pin.isDeleted();
  }

  set(other: ModuleBuffer<T,U>) {
    this.array_view.set(other.array_view);
  }
}

export class Uint8ModuleBuffer extends ModuleBuffer<Uint8PinnedArray, Uint8ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Uint8PinnedArray.owned_pin_from_malloc(N)!, Uint8Array);
  }
}

export class Int8ModuleBuffer extends ModuleBuffer<Int8PinnedArray, Int8ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Int8PinnedArray.owned_pin_from_malloc(N)!, Int8Array);
  }
}

export class Uint16ModuleBuffer extends ModuleBuffer<Uint16PinnedArray, Uint16ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Uint16PinnedArray.owned_pin_from_malloc(N)!, Uint16Array);
  }
}

export class Int16ModuleBuffer extends ModuleBuffer<Int16PinnedArray, Int16ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Int16PinnedArray.owned_pin_from_malloc(N)!, Int16Array);
  }
}

export class Uint32ModuleBuffer extends ModuleBuffer<Uint32PinnedArray, Uint32ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Uint32PinnedArray.owned_pin_from_malloc(N)!, Uint32Array);
  }
}

export class Int32ModuleBuffer extends ModuleBuffer<Int32PinnedArray, Int32ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Int32PinnedArray.owned_pin_from_malloc(N)!, Int32Array);
  }
}

export class Float32ModuleBuffer extends ModuleBuffer<Float32PinnedArray, Float32ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Float32PinnedArray.owned_pin_from_malloc(N)!, Float32Array);
  }
}

export class Float64ModuleBuffer extends ModuleBuffer<Float64PinnedArray, Float64ArrayConstructor> {
  constructor(arg: number | ArrayLike<number>) {
    super(arg, N => mod().Float64PinnedArray.owned_pin_from_malloc(N)!, Float64Array);
  }
}

export function calculate_homogenous_energy_2d(e_field: Float32ModuleBuffer, dx: Float32ModuleBuffer, dy: Float32ModuleBuffer): number {
  return mod().calculate_homogenous_energy_2d(e_field.pin, dx.pin, dy.pin);
}

export function calculate_inhomogenous_energy_2d(e_field: Float32ModuleBuffer, er_table: Float32ModuleBuffer, er_index_beta: Uint32ModuleBuffer, dx: Float32ModuleBuffer, dy: Float32ModuleBuffer): number {
  return mod().calculate_inhomogenous_energy_2d(e_field.pin, er_table.pin, er_index_beta.pin, dx.pin, dy.pin);
}

export function calculate_e_field(e_field_out: Float32ModuleBuffer, v_field_in: Float32ModuleBuffer, dx_in: Float32ModuleBuffer, dy_in: Float32ModuleBuffer): void {
  return mod().calculate_e_field(e_field_out.pin, v_field_in.pin, dx_in.pin, dy_in.pin);
}

export function convert_f32_to_f16(f32_in: Float32ModuleBuffer, f16_out: Uint16ModuleBuffer): void {
  return mod().convert_f32_to_f16(f32_in.pin, f16_out.pin);
}

export class LU_Solver {
  readonly inner: _LU_Solver;

  constructor(
    A_non_zero_data: Float32ModuleBuffer,
    A_col_indices: Int32ModuleBuffer, A_row_index_pointers: Int32ModuleBuffer,
    total_rows: number, total_columns: number
  ) {
    this.inner = mod().LU_Solver.create(
      A_non_zero_data.pin,
      A_col_indices.pin, A_row_index_pointers.pin,
      total_rows, total_columns,
    )!;
  }

  solve(b: Float32ModuleBuffer): number {
    return this.inner.solve(b.pin);
  }
}
