import {
  type ManagedObject,
  WasmModule, LU_Solver, ModuleNdarray, ReferenceBlock,
  ModuleFloat32Array, ModuleInt32Array,
} from "../../wasm/index.ts";
import { Profiler } from "../../utility/profiler.ts";
import { type Vec2 } from "../../utility/dim_types.ts";
import { NdGpuArray } from "../../utility/gpu_common.ts";

type Size2D = Vec2<number>;

export class CpuGrid implements ManagedObject {
  readonly module: WasmModule;
  reference_block: ReferenceBlock;

  readonly size: Size2D;
  readonly x: ModuleNdarray;
  readonly y: ModuleNdarray;
  readonly dx: ModuleNdarray;
  readonly dy: ModuleNdarray;
  readonly v_index_beta: ModuleNdarray;
  _v_table: ModuleNdarray;
  readonly v_field: ModuleNdarray;
  readonly ex_field: ModuleNdarray;
  readonly ey_field: ModuleNdarray;
  _ek_table: ModuleNdarray;
  readonly ek_index_beta: ModuleNdarray;

  v_input: number;

  _lu_solver?: LU_Solver;

  static pack_index_beta(index: number, beta: number): number {
    beta = Math.max(Math.min(0xFFFF, beta), 0x0000);
    return ((index & 0xFFFF) << 16) | Math.floor(0xFFFF*beta);
  }

  static unpack_index_beta(packed_data: number): { index: number, beta: number } {
    const beta = (packed_data & 0xFFFF) / 0xFFFF;
    const index = (packed_data >> 16) & 0xFFFF;
    return { index, beta };
  }

  constructor(module: WasmModule, size: Size2D) {
    this.module = module;
    this.reference_block = new ReferenceBlock(module, this);
    this.size = size;
    this.x = ModuleNdarray.create_zeros(module, [size.x+1], "f32");
    this.y = ModuleNdarray.create_zeros(module, [size.y+1], "f32");
    this.dx = ModuleNdarray.create_zeros(module, [size.x], "f32");
    this.dy = ModuleNdarray.create_zeros(module, [size.y], "f32");
    this.v_index_beta = ModuleNdarray.create_zeros(module, [size.y+1,size.x+1], "u32");
    this.v_field = ModuleNdarray.create_zeros(module, [size.y+1,size.x+1], "f32");
    this.ex_field = ModuleNdarray.create_zeros(module, [size.y+1,size.x], "f32");
    this.ey_field = ModuleNdarray.create_zeros(module, [size.y,size.x+1], "f32");
    this.ek_index_beta = ModuleNdarray.create_zeros(module, [size.y,size.x], "u32");
    this.v_input = 1;

    this._v_table = ModuleNdarray.create_zeros(module, [3], "f32");
    this._ek_table = ModuleNdarray.create_zeros(module, [3], "f32");
    this.reference_block.add_children(this);
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

  set v_table(v_table: ModuleNdarray) {
    if (v_table.dtype !== "f32") {
      throw Error(`Got v_table.dtype=${v_table.dtype} but expected 'f32'`);
    }
    this.reference_block.children.delete(this._v_table);
    this.reference_block.children.add(v_table);
    this._v_table.delete();
    this._v_table = v_table;
  }

  get v_table(): ModuleNdarray {
    return this._v_table;
  }

  set ek_table(ek_table: ModuleNdarray) {
    if (ek_table.dtype !== "f32") {
      throw Error(`Got ek_table.dtype=${ek_table.dtype} but expected 'f32'`);
    }
    this.reference_block.children.delete(this._ek_table);
    this.reference_block.children.add(ek_table);
    this._ek_table.delete();
    this._ek_table = ek_table;
  }

  get ek_table(): ModuleNdarray {
    return this._ek_table;
  }

  set lu_solver(lu_solver: LU_Solver | undefined) {
    if (this._lu_solver !== undefined) {
      this.reference_block.children.delete(this._lu_solver);
      this._lu_solver.delete();
    }
    if (lu_solver !== undefined) {
      this.reference_block.children.add(lu_solver);
    }
    this._lu_solver = lu_solver;
  }

  get lu_solver(): LU_Solver | undefined {
    return this._lu_solver;
  }

  reset() {
    this.v_field.fill(0.0);
    this.ex_field.fill(0.0);
    this.ey_field.fill(0.0);
  }

  bake(profiler?: Profiler) {
    // generate A matrix for Av=b in compressed sparse row (csr) representation
    const A_data: number[] = [];
    const A_col_indices: number[] = [];
    const A_row_index_ptr: number[] = [];

    // compressed sparse row representation stores non-zero values along side all non-zero valued olumn indices per row, and last column index per row
    const push_csr_entry = (value: number, column: number) => {
      A_data.push(value);
      A_col_indices.push(column);
    }
    const push_csr_row = () => {
      A_row_index_ptr.push(A_data.length);
    }
    const clamp = (i: number, min: number, max: number): number => {
      return Math.min(Math.max(i, min), max);
    };

    const { x: Nx, y: Ny } = this.size;
    {
      profiler?.begin("create_csr", "Create CSR matrix A to represent grid");

      const Mx = Nx+1;
      const My = Ny+1;
      const v_index_beta = this.v_index_beta.data; // forcing potential
      const dx = this.dx.data;
      const dy = this.dy.data;
      const get_index = (i: number, j: number): number => {
        const ij = i+j*Mx;
        return ij;
      };

      for (let j = 0; j < My; j++) {
        for (let i = 0; i < Mx; i++) {
          push_csr_row();
          const ij = get_index(i,j);
          const index_beta = v_index_beta[ij];
          const { beta } = CpuGrid.unpack_index_beta(index_beta);

          // a_n = A[m,n] where m = i + j*Mx
          if (beta > 0.5) {
            // Equation 2.3
            const a_ij = 1;
            push_csr_entry(a_ij, ij);
            continue;
          }

          // ij = i,j
          // i0j = i-0.5,j
          // i1j = i+0.5,j
          const dx_i0 = dx[clamp(i-1,0,Nx-1)];
          const dx_i1 = dx[clamp(i,0,Nx-1)];
          const dy_j0 = dy[clamp(j-1,0,Ny-1)];
          const dy_j1 = dy[clamp(j,0,Ny-1)];
          const dx_i = (dx_i0+dx_i1)/2.0;
          const dy_j = (dy_j0+dy_j1)/2.0;

          // push sparse column values in order of A matrix column index
          // Equation 2.1
          if (j > 0) {
            const ij0 = get_index(i,j-1);
            const a_ij0 = 1.0/(dy_j*dy_j0);
            push_csr_entry(a_ij0, ij0);
          }

          if (i > 0) {
            const i0j = get_index(i-1,j);
            const a_i0j = 1.0/(dx_i*dx_i0);
            push_csr_entry(a_i0j, i0j);
          }

          const a_ij = -1.0/(dx_i*dx_i1)-1.0/(dy_j*dy_j1)-1.0/(dx_i*dx_i0)-1.0/(dy_j*dy_j0);
          push_csr_entry(a_ij, ij);

          if (i < Nx) {
            const i1j = get_index(i+1,j);
            const a_i1j = 1.0/(dx_i*dx_i1);
            push_csr_entry(a_i1j, i1j);
          }

          if (j < Ny) {
            const ij1 = get_index(i,j+1);
            const a_ij1 = 1.0/(dy_j*dy_j1);
            push_csr_entry(a_ij1, ij1);
          }
        }
      }
      push_csr_row();
      profiler?.end();
    }

    profiler?.begin("alloc_csr", "Allocate temporary CSR A matrix buffers inside WASM heap");
    const pinned_A_data = new ModuleFloat32Array(this.reference_block.module, A_data.length);
    const pinned_A_col_indices = new ModuleInt32Array(this.reference_block.module, A_col_indices.length);
    const pinned_A_row_index_ptr = new ModuleInt32Array(this.reference_block.module, A_row_index_ptr.length);
    pinned_A_data.set(A_data);
    pinned_A_col_indices.set(A_col_indices);
    pinned_A_row_index_ptr.set(A_row_index_ptr);
    profiler?.end();

    const total_voltages = (Ny+1)*(Nx+1);
    profiler?.begin("create_lu_solver", "Calculate new LU factorisations");
    this.lu_solver = new LU_Solver(this.reference_block.module, pinned_A_data, pinned_A_col_indices, pinned_A_row_index_ptr, total_voltages, total_voltages);
    profiler?.end();

    profiler?.begin("free_csr", "Freeing temporary CSR A matrix");
    pinned_A_data.delete();
    pinned_A_col_indices.delete();
    pinned_A_row_index_ptr.delete();
    profiler?.end();
  }

  run(profiler?: Profiler) {
    if (this.lu_solver === undefined) {
      throw Error(`LU Solver has not been factorised yet. Call bake() first`);
    }
    const { x: Nx, y: Ny } = this.size;
    {
      profiler?.begin("create_b", "Generate b column vector from forcing voltage potentials");
      const v_index_beta = this.v_index_beta.data;
      const v_table = this.v_table.data;
      // generate b matrix for Av=b
      const b = this.v_field.data;
      const Mx = Nx+1;
      const My = Ny+1;
      for (let j = 0; j < My; j++) {
        for (let i = 0; i < Mx; i++) {
          const ij = i + j*Mx;
          const index_beta = v_index_beta[ij];
          const { index, beta } = CpuGrid.unpack_index_beta(index_beta);
          const is_forcing_potential = beta > 0.5;
          if (is_forcing_potential) {
            const voltage = v_table[index];
            b[ij] = voltage; // Equation 2.4
          } else {
            b[ij] = 0; // Equation 2.2
          }
        }
      }
      profiler?.end();
    }

    profiler?.begin("solve_v_field", "Solve for voltage field in system Ax=b where A has LU factors");
    const solve_info = this.lu_solver.solve(this.v_field.cast(ModuleFloat32Array));
    profiler?.end();

    profiler?.begin("calc_e_field", "Calculate electric field from voltage field");
    this.module.calculate_e_field(this.ex_field, this.ey_field, this.v_field, this.dx, this.dy);
    profiler?.end();

    if (solve_info !== 0) {
      console.error(`LU solver failed with code: ${solve_info}`);
    }
  }
}

export class GpuGrid {
  device: GPUDevice;
  size: Size2D;
  x: NdGpuArray;
  y: NdGpuArray;
  dx: NdGpuArray;
  dy: NdGpuArray;
  v_index_beta: NdGpuArray;
  v_field: NdGpuArray;
  ex_field: NdGpuArray;
  ey_field: NdGpuArray;
  ek_index_beta: NdGpuArray;
  v_table: NdGpuArray;
  ek_table: NdGpuArray;

  constructor(device: GPUDevice, size: Size2D) {
    this.device = device;
    this.size = size;
    this.x = new NdGpuArray(device, [size.x+1], "f32");
    this.y = new NdGpuArray(device, [size.y+1], "f32");
    this.dx = new NdGpuArray(device, [size.x], "f32");
    this.dy = new NdGpuArray(device, [size.y], "f32");
    this.v_field = new NdGpuArray(device, [size.y+1,size.x+1], "f32");
    this.ex_field = new NdGpuArray(device, [size.y+1,size.x], "f32");
    this.ey_field = new NdGpuArray(device, [size.y,size.x+1], "f32");
    this.v_index_beta = new NdGpuArray(device, [size.y+1,size.x+1], "u32");
    this.ek_index_beta = new NdGpuArray(device, [size.y,size.x], "u32");
    this.v_table = new NdGpuArray(device, [3], "f32");
    this.ek_table = new NdGpuArray(device, [size.y,size.x], "f32");
  }

  from_cpu(cpu: CpuGrid) {
    if (this.size.x !== cpu.size.x || this.size.y !== cpu.size.y) {
      const format_size = (size: Size2D) => `{x:${size.x},y:${size.y}}`;
      throw Error(`Mismatch between gpu.size=${format_size(this.size)}, cpu.size=${format_size(cpu.size)}`);
    }

    const is_shape_equal = (s0: number[], s1: number[]): boolean => {
      if (s0.length !== s1.length) return false;
      for (let i = 0; i < s0.length; i++) {
        if (s0[i] !== s1[i]) return false;
      }
      return true;
    };
    const write_buffer = (gpu: NdGpuArray, cpu: ModuleNdarray) => {
      if (gpu.dtype !== cpu.dtype) {
        throw Error(`Mismatch between dtypes with cpu=${cpu.dtype} and gpu=${gpu.dtype}`);
      }
      if (!is_shape_equal(cpu.shape, gpu.shape)) {
        throw Error(`Mismatch between shapes with cpu=[${cpu.shape.join(',')}] and gpu=[${gpu.shape.join(',')}]`);
      }
      // https://github.com/emscripten-core/emscripten/pull/27242
      // NOTE: Of course WebGPU doesn't like it when we pass a resizable ArrayBuffer to it for "security" reasons
      //       So we have to copy the contents of the resizable ArrayBuffer into a non-resizable buffer
      //       At the moment this problem seems to be an implementation issue with ResizableArrayBuffer being relatively "new"
      const data = cpu.data.slice();
      this.device.queue.writeBuffer(gpu.data, 0, data, 0, data.length);
    };

    write_buffer(this.x, cpu.x);
    write_buffer(this.y, cpu.y);
    write_buffer(this.dx, cpu.dx);
    write_buffer(this.dy, cpu.dy);
    write_buffer(this.v_field, cpu.v_field);
    write_buffer(this.ex_field, cpu.ex_field);
    write_buffer(this.ey_field, cpu.ey_field);
    write_buffer(this.v_index_beta, cpu.v_index_beta);
    write_buffer(this.ek_index_beta, cpu.ek_index_beta);

    if (!is_shape_equal(this.ek_table.shape, cpu.ek_table.shape)) {
      this.ek_table = new NdGpuArray(this.device, cpu.ek_table.shape, "f32");
    }
    if (!is_shape_equal(this.v_table.shape, cpu.v_table.shape)) {
      this.v_table = new NdGpuArray(this.device, cpu.v_table.shape, "f32");
    }
    write_buffer(this.ek_table, cpu.ek_table);
    write_buffer(this.v_table, cpu.v_table);
  }
}
