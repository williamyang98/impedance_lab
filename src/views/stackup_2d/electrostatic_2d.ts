import {
  type ManagedObject,
  LU_Solver,
  Float32ModuleBuffer, Int32ModuleBuffer,
} from "../../wasm/index.ts";
import { Globals } from "../../global.ts";
import { Float32ModuleNdarray, Uint32ModuleNdarray } from "../../utility/module_ndarray.ts";
import { Profiler } from "../../utility/profiler.ts";

export interface ImpedanceResult {
  voltage: number;
  energy_homogenous: number;
  energy_inhomogenous: number;
  Z0: number;
  Ch: number;
  Cih: number;
  Lh: number;
  propagation_speed: number;
  propagation_delay: number;
}

export class Grid implements ManagedObject {
  readonly module = Globals.wasm_module;
  _is_deleted: boolean = false;
  readonly size: [number, number];
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

  constructor(Ny: number, Nx: number) {
    this.size = [Ny, Nx];
    this.dx = Float32ModuleNdarray.from_shape(this.module, [Nx]);
    this.dy = Float32ModuleNdarray.from_shape(this.module, [Ny]);
    this.v_index_beta = Uint32ModuleNdarray.from_shape(this.module, [Ny+1,Nx+1]);
    this.v_field = Float32ModuleNdarray.from_shape(this.module, [Ny+1,Nx+1]);
    this.ex_field = Float32ModuleNdarray.from_shape(this.module, [Ny+1,Nx]);
    this.ey_field = Float32ModuleNdarray.from_shape(this.module, [Ny,Nx+1]);
    this.ek_index_beta = Uint32ModuleNdarray.from_shape(this.module, [Ny,Nx]);
    this.v_input = 1;

    this._v_table = Float32ModuleNdarray.from_shape(this.module, [3]);
    this._ek_table = Float32ModuleNdarray.from_shape(this.module, [Ny,Nx]);
    this.module.register_parent_and_children(this,
      this.dx,
      this.dy,
      this.v_index_beta,
      this.v_field,
      this.ex_field,
      this.ey_field,
      this.ek_index_beta,
      this._v_table,
      this._ek_table,
    );
  }

  set v_table(v_table: Float32ModuleNdarray) {
    this.module.unregister_children_from_parent(this, this._v_table);
    this._v_table = v_table;
    this.module.register_parent_and_children(this, this.v_table);
  }

  get v_table(): Float32ModuleNdarray {
    return this._v_table;
  }

  set ek_table(ek_table: Float32ModuleNdarray) {
    this.module.unregister_children_from_parent(this, this._ek_table);
    this._ek_table = ek_table;
    this.module.register_parent_and_children(this, this.ek_table);
  }

  get ek_table(): Float32ModuleNdarray {
    return this._ek_table;
  }

  set lu_solver(lu_solver: LU_Solver) {
    if (this._lu_solver) {
      this.module.unregister_children_from_parent(this, this._lu_solver);
    }
    this._lu_solver = lu_solver;
    this.module.register_parent_and_children(this, this._lu_solver);
  }

  get lu_solver(): LU_Solver | undefined {
    return this._lu_solver;
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

  reset() {
    this.v_field.array_view.fill(0.0);
    this.ex_field.array_view.fill(0.0);
    this.ey_field.array_view.fill(0.0);
  }

  bake(profiler?: Profiler) {
    // generate A matrix for Ax=b
    const A_data: number[] = [];
    const A_col_indices: number[] = [];
    const A_row_index_ptr: number[] = [];

    const push_csr_entry = (value: number, column: number) => {
      A_data.push(value);
      A_col_indices.push(column);
    }

    const push_csr_row = () => {
      A_row_index_ptr.push(A_data.length);
    }

    const [Ny,Nx] = this.size;
    {
      profiler?.begin("create_csr", "Create CSR matrix A to represent grid");
      const v_index_beta = this.v_index_beta.array_view;
      const dx = this.dx.array_view;
      const dy = this.dy.array_view;

      for (let y = 0; y < Ny+1; y++) {
        for (let x = 0; x < Nx+1; x++) {
          push_csr_row();
          const iv = x + y*(Nx+1);
          const index_beta = v_index_beta[iv];
          const { beta } = Grid.unpack_index_beta(index_beta);
          const has_div_E_constraint = (x > 0 && x < Nx) || (y > 0 && y < Ny);
          if ((beta > 0.5) || !has_div_E_constraint) {
            push_csr_entry(1, iv);
            continue;
          }

          // Creating the following constraint for cell at [y,x]
          // div(E)[y,x] = (Ex[y,x]-Ex[y,x-1])/(dx[x]+dx[x-1]) +
          //               (Ey[y,x]-Ey[y-1,x])/(dy[y]+dy[y-1])
          // div(E)[y,x] = 0
          //
          // Ex[y,x] = -(V[y,x+1]-V[y,x])/dx[x]
          // Ey[y,x] = -(V[y+1,x]-V[y,x])/dy[y]
          //
          // substituting into div(E)[y,x] = 0
          // div(E)[y,x] = - (V[y,x+1]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[y,x]
          //               + (V[y,x+0]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[y,x]
          //               + (V[y,x+0]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[y,x-1]
          //               - (V[y,x-1]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[y,x-1]
          //               - (V[y+1,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[y,x]
          //               + (V[y+0,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[y,x]
          //               + (V[y+0,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[y-1,x]
          //               - (V[y-1,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[y-1,x]
          // div(E)[y,x] = 0
          //
          // This gives us a row for our constraint matrix L and target value b
          // these are the possible columns that are set in a row inside L
          // di = -(Nx+1), -1, 0, +1, +(Nx+1)
          const column_value = [0,0,0,0,0];
          const column_index = [iv-(Nx+1), iv-1, iv, iv+1, iv+(Nx+1)];

          // div(Ex) = 0
          if (x > 0 && x < Nx) {
            const dx_0 = dx[x-1];
            const dx_1 = dx[x];
            const norm = dx_0+dx_1;
            column_value[1] -= (1/dx_0)/norm;
            column_value[2] += (1/dx_0 + 1/dx_1)/norm;
            column_value[3] -= (1/dx_1)/norm;
          }

          // div(Ey) = 0
          if (y > 0 && y < Ny) {
            const dy_0 = dy[y-1];
            const dy_1 = dy[y];
            const norm = dy_0+dy_1;
            column_value[0] -= (1/dy_0)/norm;
            column_value[2] += (1/dy_0 + 1/dy_1)/norm;
            column_value[4] -= (1/dy_1)/norm;
          }

          for (let i = 0; i < 5; i++) {
            const value = column_value[i];
            const index = column_index[i];
            if (value != 0) {
              push_csr_entry(value, index);
            }
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
    const [Ny,Nx] = this.size;
    {
      profiler?.begin("create_b", "Generate b column vector from forcing voltage potentials");
      const v_index_beta = this.v_index_beta.array_view;
      const v_table = this.v_table.array_view;
      // generate b matrix for Ax=b
      const B = this.v_field.array_view;
      for (let y = 0; y < Ny+1; y++) {
        for (let x = 0; x < Nx+1; x++) {
          const iv = x + y*(Nx+1);
          const index_beta = v_index_beta[iv];
          const { index, beta } = Grid.unpack_index_beta(index_beta);
          const voltage = v_table[index];
          B[iv] = (beta > 0.5) ? voltage : 0.0;
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

  calculate_impedance(profiler?: Profiler): ImpedanceResult {
    profiler?.begin("energy_homogenous", "Calculate energy stored without dielectric material");
    const energy_homogenous = this.module.calculate_homogenous_energy_2d(
      this.ex_field, this.ey_field,
      this.dx, this.dy,
    );
    profiler?.end();

    profiler?.begin("energy_inhomogenous", "Calculate energy stored with dielectric material");
    const energy_inhomogenous = this.module.calculate_inhomogenous_energy_2d(
      this.ex_field, this.ey_field,
      this.dx, this.dy,
      this.ek_table, this.ek_index_beta,
    );
    profiler?.end();

    const epsilon_0 = 8.85e-12
    const c_0 = 3e8;
    const v0: number = this.v_input;
    const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
    const Lh = 1/((c_0**2) * Ch);
    const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;
    const Z0 = (Lh/Cih)**0.5;
    const propagation_speed = 1/(Cih*Lh)**0.5;
    const propagation_delay = 1/propagation_speed;

    return {
      voltage: v0,
      energy_homogenous,
      energy_inhomogenous,
      Z0,
      Ch,
      Cih,
      Lh,
      propagation_speed,
      propagation_delay,
    };
  }

  get width(): number {
    return this.dx.length;
  }

  get height(): number {
    return this.dy.length;
  }
}
