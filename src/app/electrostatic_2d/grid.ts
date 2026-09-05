import {
  WasmModule,
  ManagedObject,
  LU_Solver,
  Float32ModuleBuffer, Int32ModuleBuffer,
} from "../../wasm/index.ts";
import { Float32ModuleNdarray, Uint32ModuleNdarray } from "../../utility/module_ndarray.ts";
import { Profiler } from "../../utility/profiler.ts";
import type { Vec2 } from "../../utility/dim_types.ts";

type Size2D = Vec2<number>;

export class Grid extends ManagedObject {
  readonly size: Size2D;
  readonly x: Float32ModuleNdarray;
  readonly y: Float32ModuleNdarray;
  readonly dx: Float32ModuleNdarray;
  readonly dy: Float32ModuleNdarray;
  readonly v_index_beta: Uint32ModuleNdarray;
  _v_table: Float32ModuleNdarray;
  readonly v_field: Float32ModuleNdarray;
  readonly ex_field: Float32ModuleNdarray;
  readonly ey_field: Float32ModuleNdarray;
  _ek_table: Float32ModuleNdarray;
  readonly ek_index_beta: Uint32ModuleNdarray;

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
    super(module);
    this.size = size;
    this.x = Float32ModuleNdarray.from_shape(this.module, [size.x+1]);
    this.y = Float32ModuleNdarray.from_shape(this.module, [size.y+1]);
    this.dx = Float32ModuleNdarray.from_shape(this.module, [size.x]);
    this.dy = Float32ModuleNdarray.from_shape(this.module, [size.y]);
    this.v_index_beta = Uint32ModuleNdarray.from_shape(this.module, [size.y+1,size.x+1]);
    this.v_field = Float32ModuleNdarray.from_shape(this.module, [size.y+1,size.x+1]);
    this.ex_field = Float32ModuleNdarray.from_shape(this.module, [size.y+1,size.x]);
    this.ey_field = Float32ModuleNdarray.from_shape(this.module, [size.y,size.x+1]);
    this.ek_index_beta = Uint32ModuleNdarray.from_shape(this.module, [size.y,size.x]);
    this.v_input = 1;

    this._v_table = Float32ModuleNdarray.from_shape(this.module, [3]);
    this._ek_table = Float32ModuleNdarray.from_shape(this.module, [size.y,size.x]);
    this._child_objects.add(this.x);
    this._child_objects.add(this.y);
    this._child_objects.add(this.dx);
    this._child_objects.add(this.dy);
    this._child_objects.add(this.v_index_beta);
    this._child_objects.add(this.v_field);
    this._child_objects.add(this.ex_field);
    this._child_objects.add(this.ey_field);
    this._child_objects.add(this.ek_index_beta);
    this._child_objects.add(this._v_table);
    this._child_objects.add(this._ek_table);
  }

  set v_table(v_table: Float32ModuleNdarray) {
    this._child_objects.delete(this._v_table);
    this._child_objects.add(v_table);
    this._v_table.delete();
    this._v_table = v_table;
  }

  get v_table(): Float32ModuleNdarray {
    return this._v_table;
  }

  set ek_table(ek_table: Float32ModuleNdarray) {
    this._child_objects.delete(this._ek_table);
    this._child_objects.add(ek_table);
    this._ek_table.delete();
    this._ek_table = ek_table;
  }

  get ek_table(): Float32ModuleNdarray {
    return this._ek_table;
  }

  set lu_solver(lu_solver: LU_Solver | undefined) {
    if (this._lu_solver !== undefined) {
      this._child_objects.delete(this._lu_solver);
      this._lu_solver.delete();
    }
    if (lu_solver !== undefined) {
      this._child_objects.add(lu_solver);
    }
    this._lu_solver = lu_solver;
  }

  get lu_solver(): LU_Solver | undefined {
    return this._lu_solver;
  }

  reset() {
    this.v_field.array_view.fill(0.0);
    this.ex_field.array_view.fill(0.0);
    this.ey_field.array_view.fill(0.0);
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
      const v_index_beta = this.v_index_beta.array_view; // forcing potential
      const dx = this.dx.array_view;
      const dy = this.dy.array_view;
      const get_index = (i: number, j: number): number => {
        const ij = i+j*Mx;
        return ij;
      };

      for (let j = 0; j < My; j++) {
        for (let i = 0; i < Mx; i++) {
          push_csr_row();
          const ij = get_index(i,j);
          const index_beta = v_index_beta[ij];
          const { beta } = Grid.unpack_index_beta(index_beta);

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
    const pinned_A_data = Float32ModuleBuffer.create(this.module, A_data.length);
    const pinned_A_col_indices = Int32ModuleBuffer.create(this.module, A_col_indices.length);
    const pinned_A_row_index_ptr = Int32ModuleBuffer.create(this.module, A_row_index_ptr.length);
    pinned_A_data.array_view.set(A_data);
    pinned_A_col_indices.array_view.set(A_col_indices);
    pinned_A_row_index_ptr.array_view.set(A_row_index_ptr);
    profiler?.end();

    const total_voltages = (Ny+1)*(Nx+1);
    profiler?.begin("create_lu_solver", "Calculate new LU factorisations");
    this.lu_solver = new LU_Solver(this.module, pinned_A_data, pinned_A_col_indices, pinned_A_row_index_ptr, total_voltages, total_voltages);
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
      const v_index_beta = this.v_index_beta.array_view;
      const v_table = this.v_table.array_view;
      // generate b matrix for Av=b
      const b = this.v_field.array_view;
      const Mx = Nx+1;
      const My = Ny+1;
      for (let j = 0; j < My; j++) {
        for (let i = 0; i < Mx; i++) {
          const ij = i + j*Mx;
          const index_beta = v_index_beta[ij];
          const { index, beta } = Grid.unpack_index_beta(index_beta);
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
    const solve_info = this.lu_solver.solve(this.v_field);
    profiler?.end();

    profiler?.begin("calc_e_field", "Calculate electric field from voltage field");
    this.module.calculate_e_field(this.ex_field, this.ey_field, this.v_field, this.dx, this.dy);
    profiler?.end();

    if (solve_info !== 0) {
      console.error(`LU solver failed with code: ${solve_info}`);
    }
  }

  get width(): number {
    return this.dx.length;
  }

  get height(): number {
    return this.dy.length;
  }
}
