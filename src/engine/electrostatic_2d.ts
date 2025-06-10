import {
  LU_Solver,
  Float32ModuleBuffer, Int32ModuleBuffer,
  calculate_e_field, calculate_homogenous_energy_2d, calculate_inhomogenous_energy_2d,
} from "../wasm";
import { Float32ModuleNdarray, Uint32ModuleNdarray } from "../utility/module_ndarray.ts";

export interface RunResult {
  time_taken: number;
}

export interface ImpedanceResult {
  Z0: number;
  Cih: number;
  Lh: number;
  propagation_speed: number;
  propagation_delay: number;
}

export class Grid {
  size: [number, number];
  dx: Float32ModuleNdarray;
  dy: Float32ModuleNdarray;
  v_index_beta: Uint32ModuleNdarray;
  v_table: Float32ModuleNdarray;
  v_field: Float32ModuleNdarray;
  e_field: Float32ModuleNdarray;
  ek_table: Float32ModuleNdarray;
  ek_index_beta: Uint32ModuleNdarray;

  v_input: number;

  lu_solver?: LU_Solver;

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
    this.dx = new Float32ModuleNdarray([Nx]);
    this.dy = new Float32ModuleNdarray([Ny]);
    this.v_table = new Float32ModuleNdarray([3]);
    this.v_index_beta = new Uint32ModuleNdarray([Ny+1,Nx+1]);
    this.v_field = new Float32ModuleNdarray([Ny+1,Nx+1]);
    this.e_field = new Float32ModuleNdarray([Ny,Nx,2]);
    this.ek_table = new Float32ModuleNdarray([Ny,Nx]);
    this.ek_index_beta = new Uint32ModuleNdarray([Ny,Nx]);
    this.v_input = 1;
  }

  delete() {
    this.dx.delete();
    this.dy.delete();
    this.v_table.delete();
    this.v_index_beta.delete();
    this.v_field.delete();
    this.e_field.delete();
    this.ek_table.delete();
    this.ek_index_beta.delete();
    this.lu_solver?.delete();
  }

  reset() {
    this.v_field.array_view.fill(0.0);
    this.e_field.array_view.fill(0.0);
  }

  bake() {
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
      const v_index_beta = this.v_index_beta.array_view;
      const dx = this.dx.array_view;
      const dy = this.dy.array_view;

      const start_ms = performance.now();
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
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`CSR matrix creation took ${elapsed_ms.toPrecision(3)} ms`);
    }

    const pinned_A_data = new Float32ModuleBuffer(A_data.length);
    const pinned_A_col_indices = new Int32ModuleBuffer(A_col_indices.length);
    const pinned_A_row_index_ptr = new Int32ModuleBuffer(A_row_index_ptr.length);

    pinned_A_data.array_view.set(A_data);
    pinned_A_col_indices.array_view.set(A_col_indices);
    pinned_A_row_index_ptr.array_view.set(A_row_index_ptr);

    const total_voltages = (Ny+1)*(Nx+1);
    {
      const start_ms = performance.now();
      this.lu_solver?.delete();
      this.lu_solver = new LU_Solver(pinned_A_data, pinned_A_col_indices, pinned_A_row_index_ptr, total_voltages, total_voltages);
      const end_ms = performance.now();
      const delta_ms = end_ms-start_ms;
      console.log(`LU factorisation took ${delta_ms.toPrecision(3)} ms`);
    }

    pinned_A_data.delete();
    pinned_A_col_indices.delete();
    pinned_A_row_index_ptr.delete();
  }

  run(): RunResult {
    if (this.lu_solver === undefined) {
      throw Error(`LU Solver has not been factorised yet. Call bake() first`);
    }
    const [Ny,Nx] = this.size;
    {
      const start_ms = performance.now();
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
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`B matrix creation took ${elapsed_ms.toPrecision(3)} ms`);
    }

    const start_ms = performance.now();
    const solve_info = this.lu_solver.solve(this.v_field);
    const end_ms = performance.now();
    const elapsed_ms = end_ms-start_ms;
    console.log(`LU solve took ${elapsed_ms.toPrecision(3)} ms`);

    {
      const start_ms = performance.now();
      calculate_e_field(
        this.e_field, this.v_field, this.dx, this.dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`E field calculation took ${elapsed_ms.toPrecision(3)} ms`);
    }

    if (solve_info !== 0) {
      console.error(`LU solver failed with code: ${solve_info}`);
    }

    const time_taken = elapsed_ms*1e-3;
    return {
      time_taken,
    }
  }

  calculate_impedance(): ImpedanceResult {
    const epsilon_0 = 8.85e-12
    const c_0 = 3e8;

    let energy_homogenous: number | undefined = undefined;
    let energy_inhomogenous: number | undefined = undefined;

    {
      const start_ms = performance.now();
      energy_homogenous = calculate_homogenous_energy_2d(
        this.e_field, this.dx, this.dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`calculate_homogenous_energy_2d() took ${elapsed_ms.toPrecision(3)} ms`);
    }

    {
      const start_ms = performance.now();
      energy_inhomogenous = calculate_inhomogenous_energy_2d(
        this.e_field,
        this.ek_table,
        this.ek_index_beta,
        this.dx,
        this.dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`calculate_inhomogenous_energy_2d() took ${elapsed_ms.toPrecision(3)} ms`);
    }

    const v0: number = this.v_input;
    const Ch = 1/(v0**2) * epsilon_0 * energy_homogenous;
    const Lh = 1/((c_0**2) * Ch);
    const Cih = 1/(v0**2) * epsilon_0 * energy_inhomogenous;
    const Z0 = (Lh/Cih)**0.5;
    const propagation_speed = 1/(Cih*Lh)**0.5;
    const propagation_delay = 1/propagation_speed;
    return {
      Z0,
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
