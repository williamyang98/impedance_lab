import type { NdarrayType } from "../utility/ndarray.ts";
import {
  type LU_Solver as _LU_Solver,
  type ZipFile as _ZipFile,
  type MainModule,
  default as init_module,
} from "./build/wasm_module.js";
import { ReferenceBlock, type ManagedObject } from "./memory.ts";
import { ModuleNdarray } from "./module_ndarray.ts";

import { ModuleFloat32Array, ModuleInt32Array, ModuleUint16Array, ModuleUint8Array } from "./typed_array.ts";
export * from "./typed_array.ts";
export * from "./module_ndarray.ts";
export * from "./memory.ts";

function assert_dtype(arr: ModuleNdarray, dtype: NdarrayType) {
  if (arr.dtype !== dtype) {
    throw Error(`Mismatching dtype got ${arr.dtype} but expected ${dtype}`);
  }
}

function assert_shape_dim(arr: ModuleNdarray, total_dims: number) {
  if (arr.shape.length !== total_dims)  {
    const format_shape = (shape: number[]) => `[${shape.join(',')}]`;
    throw Error(`Got array.shape=${format_shape(arr.shape)} with ${arr.shape.length} dimensions but expected ${total_dims} total dimensions`);
  }
}

function assert_shape(arr: ModuleNdarray, shape: number[]) {
  let is_mismatch = false;
  if (arr.shape.length !== shape.length)  {
    is_mismatch = true;
  } else {
    for (let i = 0; i < arr.shape.length; i++) {
      if (arr.shape[i] !== shape[i]) {
        is_mismatch = true;
        break;
      }
    }
  }
  if (is_mismatch) {
    const format_shape = (shape: number[]) => `[${shape.join(',')}]`;
    throw Error(`Got array.shape=${format_shape(arr.shape)} but expected ${format_shape(shape)}`);
  }
}

export class WasmModule {
  main: MainModule;
  heap_objects = {
    weak_refs: new WeakMap<ManagedObject, ReferenceBlock>(),
    size: 0,
  };
  finalisation_registry: FinalizationRegistry<ReferenceBlock>;
  debug_console?: Console = import.meta.env.DEV ? console : undefined;

  constructor(main: MainModule) {
    this.main = main;
    this.finalisation_registry = this.create_finalization_registry();
  }

  get heap(): Uint8Array<ArrayBuffer> {
    // NOTE: Before main.HEAP8 gets swapped out every time it grows
    //       If you are using main.HEAP8 inside something like Float32Array(main.HEAP8.buffer, offset, length) it can be invalidated
    //       The original Uint8Array<ArrayBuffer> will detach and the Float32Array will become length 0 and be invalidated
    //       BUT Now with -sGROWABLE_ARRAYBUFFERS=2 this should be resizable and should stay valid
    return this.main.HEAPU8 as Uint8Array<ArrayBuffer>;
  }

  assert_owned(object: ManagedObject) {
    if (this !== object.module) {
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
    return new FinalizationRegistry<ReferenceBlock>((block) => {
      const total_children = block.children.size;
      const dangling_children = [];
      for (const child of block.children) {
        if (!child.is_deleted()) {
          dangling_children.push(child);
        }
      }
      let has_error = false;
      if (block.count != 0) {
        this.debug_console?.warn(`Manually cleaning up reference counted object with ref_count=${block.count}`);
        has_error = true;
      }
      if (dangling_children.length > 0) {
        this.debug_console?.warn(`Manually cleaning up after parent object which left ${dangling_children.length}/${total_children} child objects dangling`);
        has_error = true;
      }
      if (has_error && block.stack_trace) {
        this.debug_console?.warn(block.stack_trace);
      }
      if (dangling_children.length > 0) {
        for (let i = 0; i < dangling_children.length; i++) {
          this.debug_console?.warn(`Deleting child object ${i+1}/${total_children}`);
          const child = dangling_children[i];
          child.delete();
          if (this.debug_console && block.stack_trace) {
            this.debug_console.warn(block.stack_trace);
          }
        }
      }
      this.heap_objects.size -= 1;
    });
  }

  register_object(parent: ManagedObject, parent_reference_block: ReferenceBlock) {
    this.assert_owned(parent);
    let reference_block = this.heap_objects.weak_refs.get(parent);
    if (reference_block === undefined) {
      reference_block = parent_reference_block;
      this.heap_objects.weak_refs.set(parent, reference_block);
      this.heap_objects.size += 1;
      this.finalisation_registry.register(parent, reference_block, reference_block);
    }
  }

  unregister_object(parent: ManagedObject) {
    this.assert_owned(parent);
    const reference_block = this.heap_objects.weak_refs.get(parent);
    if (reference_block === undefined) {
      this.debug_console?.error("Tried to unregister a parent that isn't being tracked");
      return;
    }
    if (!this.finalisation_registry.unregister(reference_block)) {
      this.debug_console?.error("Failed to unregister parent object from finalization entry: ", parent);
    }
    this.heap_objects.weak_refs.delete(parent);
    this.heap_objects.size -= 1;
    for (const child of reference_block.children) {
      if (!child.delete()) {
        this.debug_console?.warn("Tried to unregister and delete a child object that was already deleted: ", child);
      }
    }
  }

  static async init(): Promise<WasmModule> {
    const module = await init_module();
    return new WasmModule(module);
  }

  // module functions
  calculate_homogenous_energy_2d(
    ex_field: ModuleNdarray, ey_field: ModuleNdarray,
    dx: ModuleNdarray, dy: ModuleNdarray,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);
    assert_dtype(ex_field, "f32");
    assert_dtype(ey_field, "f32");
    assert_dtype(dx, "f32");
    assert_dtype(dy, "f32");

    const Nx = dx.shape[0];
    const Ny = dy.shape[0];
    assert_shape(ex_field, [Ny+1,Nx]);
    assert_shape(ey_field, [Ny,Nx+1]);
    assert_shape(dx, [Nx]);
    assert_shape(dy, [Ny]);

    return this.main.calculate_homogenous_energy_2d(
      ex_field.data.typed_pinned_array,
      ey_field.data.typed_pinned_array,
      dx.data.typed_pinned_array,
      dy.data.typed_pinned_array,
    );
  }

  calculate_inhomogenous_energy_2d(
    ex_field: ModuleNdarray, ey_field: ModuleNdarray,
    dx: ModuleNdarray, dy: ModuleNdarray,
    er_table: ModuleNdarray, er_index_beta: ModuleNdarray,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);
    this.assert_owned(er_table);
    this.assert_owned(er_index_beta);
    assert_dtype(ex_field, "f32");
    assert_dtype(ey_field, "f32");
    assert_dtype(dx, "f32");
    assert_dtype(dy, "f32");
    assert_dtype(er_table, "f32");
    assert_dtype(er_index_beta, "u32");

    const Nx = dx.shape[0];
    const Ny = dy.shape[0];
    assert_shape(ex_field, [Ny+1,Nx]);
    assert_shape(ey_field, [Ny,Nx+1]);
    assert_shape(dx, [Nx]);
    assert_shape(dy, [Ny]);
    assert_shape_dim(er_table, 1);
    assert_shape(er_index_beta, [Ny,Nx]);

    return this.main.calculate_inhomogenous_energy_2d(
      ex_field.data.typed_pinned_array,
      ey_field.data.typed_pinned_array,
      dx.data.typed_pinned_array,
      dy.data.typed_pinned_array,
      er_table.data.typed_pinned_array,
      er_index_beta.data.typed_pinned_array,
    );
  }

  calculate_homogenous_energy_cylindrical(
    ex_field: ModuleNdarray, ey_field: ModuleNdarray,
    dx: ModuleNdarray, dy: ModuleNdarray,
    x: ModuleNdarray,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);
    this.assert_owned(x);
    assert_dtype(ex_field, "f32");
    assert_dtype(ey_field, "f32");
    assert_dtype(dx, "f32");
    assert_dtype(dy, "f32");
    assert_dtype(x, "f32");

    const Nx = dx.shape[0];
    const Ny = dy.shape[0];
    assert_shape(ex_field, [Ny+1,Nx]);
    assert_shape(ey_field, [Ny,Nx+1]);
    assert_shape(dx, [Nx]);
    assert_shape(dy, [Ny]);
    assert_shape(x, [Nx+1]);

    return this.main.calculate_homogenous_energy_cylindrical(
      ex_field.data.typed_pinned_array,
      ey_field.data.typed_pinned_array,
      dx.data.typed_pinned_array,
      dy.data.typed_pinned_array,
      x.data.typed_pinned_array,
    );
  }

  calculate_inhomogenous_energy_cylindrical(
    ex_field: ModuleNdarray, ey_field: ModuleNdarray,
    dx: ModuleNdarray, dy: ModuleNdarray,
    x: ModuleNdarray,
    er_table: ModuleNdarray, er_index_beta: ModuleNdarray,
  ): number {
    this.assert_owned(ex_field);
    this.assert_owned(ey_field);
    this.assert_owned(dx);
    this.assert_owned(dy);
    this.assert_owned(x);
    this.assert_owned(er_table);
    this.assert_owned(er_index_beta);
    assert_dtype(ex_field, "f32");
    assert_dtype(ey_field, "f32");
    assert_dtype(dx, "f32");
    assert_dtype(dy, "f32");
    assert_dtype(x, "f32");
    assert_dtype(er_table, "f32");
    assert_dtype(er_index_beta, "u32");

    const Nx = dx.shape[0];
    const Ny = dy.shape[0];
    assert_shape(ex_field, [Ny+1,Nx]);
    assert_shape(ey_field, [Ny,Nx+1]);
    assert_shape(dx, [Nx]);
    assert_shape(dy, [Ny]);
    assert_shape(x, [Nx+1]);
    assert_shape_dim(er_table, 1);
    assert_shape(er_index_beta, [Ny,Nx]);

    return this.main.calculate_inhomogenous_energy_cylindrical(
      ex_field.data.typed_pinned_array,
      ey_field.data.typed_pinned_array,
      dx.data.typed_pinned_array,
      dy.data.typed_pinned_array,
      x.data.typed_pinned_array,
      er_table.data.typed_pinned_array,
      er_index_beta.data.typed_pinned_array,
    );
  }

  calculate_e_field(
    ex_field_out: ModuleNdarray, ey_field_out: ModuleNdarray,
    v_field_in: ModuleNdarray,
    dx_in: ModuleNdarray, dy_in: ModuleNdarray,
  ): void {
    this.assert_owned(ex_field_out);
    this.assert_owned(ey_field_out);
    this.assert_owned(v_field_in);
    this.assert_owned(dx_in);
    this.assert_owned(dy_in);
    assert_dtype(ex_field_out, "f32");
    assert_dtype(ey_field_out, "f32");
    assert_dtype(v_field_in, "f32");
    assert_dtype(dx_in, "f32");
    assert_dtype(dy_in, "f32");

    const Nx = dx_in.shape[0];
    const Ny = dy_in.shape[0];
    assert_shape(ex_field_out, [Ny+1,Nx]);
    assert_shape(ey_field_out, [Ny,Nx+1]);
    assert_shape(dx_in, [Nx]);
    assert_shape(dy_in, [Ny]);

    this.main.calculate_e_field(
      ex_field_out.data.typed_pinned_array,
      ey_field_out.data.typed_pinned_array,
      v_field_in.data.typed_pinned_array,
      dx_in.data.typed_pinned_array,
      dy_in.data.typed_pinned_array,
    );
  }

  convert_f32_to_f16(f32_in: ModuleFloat32Array, f16_out: ModuleUint16Array): void {
    if (f32_in.length !== f16_out.length) {
      throw Error(`Mismatching length between f32_in.length=${f32_in.length} and f16_out.length=${f16_out.length}`);
    }
    this.main.convert_f32_to_f16(f32_in.typed_pinned_array, f16_out.typed_pinned_array);
  }
}


export class LU_Solver implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;
  readonly inner: _LU_Solver;

  constructor(
    module: WasmModule,
    A_non_zero_data: ModuleFloat32Array,
    A_col_indices: ModuleInt32Array, A_row_index_pointers: ModuleInt32Array,
    total_rows: number, total_columns: number
  ) {
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
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
      A_non_zero_data.typed_pinned_array,
      A_col_indices.typed_pinned_array, A_row_index_pointers.typed_pinned_array,
      total_rows, total_columns,
    );
    if (solver === null) {
      throw Error(`WASM module LU_Solver.create returned null with error code: ${lu_factor_info}`);
    }
    this.inner = solver;
  }

  solve(b: ModuleFloat32Array): number {
    if (this.total_cols !== b.length) {
      throw Error(`Mismatch between LU factorised matrix which has ${this.total_cols} columns and expects b with ${this.total_cols} rows but got ${b.length}`);
    }
    return this.inner.solve(b.typed_pinned_array);
  }

  get total_rows(): number { return this.inner.total_rows; }
  get total_cols(): number { return this.inner.total_cols; }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.inner.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }
}

export class ZipFile implements ManagedObject {
  readonly module: WasmModule;
  readonly inner: _ZipFile;
  reference_block: ReferenceBlock;

  constructor(module: WasmModule) {
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    const inner = module.main.ZipFile.create();
    if (inner === null) throw Error("WASM module ZipFile.create returned null");
    this.inner = inner;
  }

  clone() {
    this.reference_block.clone();
    return this;
  }

  delete(): boolean {
    const is_deleted = this.reference_block.delete(this);
    if (is_deleted) {
      this.inner.delete();
    }
    return is_deleted;
  }

  is_deleted(): boolean {
    return this.reference_block.is_deleted();
  }

  write_file(name: string, data: ModuleUint8Array) {
    this.reference_block.module.assert_owned(data);
    this.inner.write_file(name, data.typed_pinned_array);
  }

  get_bytes(): ModuleUint8Array {
    const data = this.inner.get_bytes();
    if (data === null) throw Error("ZipFile.get_bytes returned null");
    return new ModuleUint8Array(this.reference_block.module, data);
  }
}
