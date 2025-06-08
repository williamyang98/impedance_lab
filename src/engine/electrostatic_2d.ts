import { type MainModule, type LU_Solver } from "../wasm/build/lu_solver.js";
import { Ndarray } from "../utility/ndarray.ts";
import { toRaw } from "vue";

export interface RunResult {
  total_steps: number;
  time_taken: number;
  cell_rate: number;
  step_rate: number;
  total_cells: number;
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
  dx: Ndarray;
  dy: Ndarray;
  v_index_beta: Ndarray;
  v_table: Ndarray;
  v_field: Ndarray;
  e_field: Ndarray;
  ek_table: Ndarray;
  ek_index_beta: Ndarray;

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
    this.dx = Ndarray.create_zeros([Nx], "f32");
    this.dy = Ndarray.create_zeros([Ny], "f32");
    this.v_table = Ndarray.create_zeros([3], "f32");
    this.v_index_beta = Ndarray.create_zeros([Ny+1,Nx+1], "u32");
    this.v_field = Ndarray.create_zeros([Ny+1,Nx+1], "f32");
    this.e_field = Ndarray.create_zeros([Ny,Nx,2], "f32");
    this.ek_table = Ndarray.create_zeros([Ny,Nx], "f32");
    this.ek_index_beta = Ndarray.create_zeros([Ny,Nx], "u32");
    this.v_input = 1;
  }

  reset() {
    this.v_field.fill(0.0);
    this.e_field.fill(0.0);
  }

  bake(mod: MainModule) {
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
      const start_ms = performance.now();
      for (let y = 0; y < Ny+1; y++) {
        for (let x = 0; x < Nx+1; x++) {
          push_csr_row();
          const iv = x + y*(Nx+1);
          const index_beta = this.v_index_beta.get([y,x]);
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
            const dx_0 = this.dx.get([x-1]);
            const dx_1 = this.dx.get([x]);
            const norm = dx_0+dx_1;
            column_value[1] -= (1/dx_0)/norm;
            column_value[2] += (1/dx_0 + 1/dx_1)/norm;
            column_value[3] -= (1/dx_1)/norm;
          }

          // div(Ey) = 0
          if (y > 0 && y < Ny) {
            const dy_0 = this.dy.get([y-1]);
            const dy_1 = this.dy.get([y]);
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

    const pinned_A_data = mod.Float32PinnedArray.owned_pin_from_malloc(A_data.length)!;
    const pinned_A_col_indices = mod.Int32PinnedArray.owned_pin_from_malloc(A_col_indices.length)!;
    const pinned_A_row_index_ptr = mod.Int32PinnedArray.owned_pin_from_malloc(A_row_index_ptr.length)!;

    new Float32Array(mod.HEAPF32.buffer, pinned_A_data.address, pinned_A_data.length).set(A_data);
    new Int32Array(mod.HEAP32.buffer, pinned_A_col_indices.address, pinned_A_col_indices.length).set(A_col_indices);
    new Int32Array(mod.HEAP32.buffer, pinned_A_row_index_ptr.address, pinned_A_row_index_ptr.length).set(A_row_index_ptr);

    const total_voltages = (Ny+1)*(Nx+1);
    {
      const start_ms = performance.now();
      this.lu_solver = mod.LU_Solver.create(pinned_A_data, pinned_A_col_indices, pinned_A_row_index_ptr, total_voltages, total_voltages)!;
      const end_ms = performance.now();
      const delta_ms = end_ms-start_ms;
      console.log(`LU factorisation took ${delta_ms.toPrecision(3)} ms`);
    }

    pinned_A_data.delete();
    pinned_A_col_indices.delete();
    pinned_A_row_index_ptr.delete();
  }

  run(mod: MainModule): RunResult {
    if (this.lu_solver === undefined) {
      throw Error(`LU Solver has not been factorised yet. Call bake() first`);
    }
    const [Ny,Nx] = this.size;
    const total_steps: number = 1;

    const total_cells = Nx*Ny;
    const total_voltages = (Ny+1)*(Nx+1);
    const pinned_B = mod.Float32PinnedArray.owned_pin_from_malloc(total_voltages)!;
    const B = new Float32Array(mod.HEAPF32.buffer, pinned_B.address, pinned_B.length);

    {
      const start_ms = performance.now();
      // generate b matrix for Ax=b
      for (let y = 0; y < Ny+1; y++) {
        for (let x = 0; x < Nx+1; x++) {
          const iv = x + y*(Nx+1);
          const index_beta = this.v_index_beta.get([y,x]);
          const { index, beta } = Grid.unpack_index_beta(index_beta);
          const voltage = this.v_table.get([index]);
          B[iv] = (beta > 0.5) ? voltage : 0.0;
        }
      }
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`B matrix creation took ${elapsed_ms.toPrecision(3)} ms`);
    }

    const start_ms = performance.now();
    // NOTE: Vue can wrap this as a proxy and mess up emscripten's type checking
    const solve_info = toRaw(this.lu_solver).solve(pinned_B);
    const end_ms = performance.now();
    const elapsed_ms = end_ms-start_ms;
    console.log(`LU solve took ${elapsed_ms.toPrecision(3)} ms`);

    const pin_f32 = (arr: Float32Array) => {
      const pin = mod.Float32PinnedArray.owned_pin_from_malloc(arr.length)!;
      new Float32Array(mod.HEAPF32.buffer, pin.address, pin.length).set(arr);
      return pin;
    };

    {
      const pinned_E = mod.Float32PinnedArray.owned_pin_from_malloc(this.e_field.data.length)!;
      const pinned_dx = pin_f32(this.dx.cast(Float32Array));
      const pinned_dy = pin_f32(this.dy.cast(Float32Array));

      const start_ms = performance.now();
      mod.calculate_e_field(
        pinned_E, pinned_B, pinned_dx, pinned_dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`E field calculation took ${elapsed_ms.toPrecision(3)} ms`);

      this.e_field.data.set(new Float32Array(mod.HEAPF32.buffer, pinned_E.address, pinned_E.length));
      pinned_E.delete();
      pinned_dx.delete();
      pinned_dy.delete();
    }

    this.v_field.cast(Float32Array).set(B);
    pinned_B.delete();

    if (solve_info !== 0) {
      console.error(`LU solver failed with code: ${solve_info}`);
    }


    const time_taken = elapsed_ms*1e-3;
    const cell_rate = (total_cells*total_steps)/time_taken;
    const step_rate = total_steps/time_taken;
    return {
      total_steps,
      time_taken,
      cell_rate,
      step_rate,
      total_cells,
    }
  }

  calculate_impedance(mod: MainModule): ImpedanceResult {
    const epsilon_0 = 8.85e-12
    const c_0 = 3e8;

    const pin_f32 = (arr: Float32Array) => {
      const pin = mod.Float32PinnedArray.owned_pin_from_malloc(arr.length)!;
      new Float32Array(mod.HEAPF32.buffer, pin.address, pin.length).set(arr);
      return pin;
    };

    const pin_u32 = (arr: Uint32Array) => {
      const pin = mod.Uint32PinnedArray.owned_pin_from_malloc(arr.length)!;
      new Uint32Array(mod.HEAPU32.buffer, pin.address, pin.length).set(arr);
      return pin;
    };

    const pinned_e_field = pin_f32(this.e_field.cast(Float32Array));
    const pinned_ek_table = pin_f32(this.ek_table.cast(Float32Array));
    const pinned_ek_index_beta = pin_u32(this.ek_index_beta.cast(Uint32Array));
    const pinned_dx = pin_f32(this.dx.cast(Float32Array));
    const pinned_dy = pin_f32(this.dy.cast(Float32Array));

    let energy_homogenous: number | undefined = undefined;
    let energy_inhomogenous: number | undefined = undefined;

    {
      const start_ms = performance.now();
      energy_homogenous = mod.calculate_homogenous_energy_2d(
        pinned_e_field, pinned_dx, pinned_dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`calculate_homogenous_energy_2d() took ${elapsed_ms.toPrecision(3)} ms`);
    }

    {
      const start_ms = performance.now();
      energy_inhomogenous = mod.calculate_inhomogenous_energy_2d(
        pinned_e_field,
        pinned_ek_table,
        pinned_ek_index_beta,
        pinned_dx,
        pinned_dy,
      );
      const end_ms = performance.now();
      const elapsed_ms = end_ms-start_ms;
      console.log(`calculate_inhomogenous_energy_2d() took ${elapsed_ms.toPrecision(3)} ms`);
    }

    pinned_e_field.delete();
    pinned_ek_table.delete();
    pinned_ek_index_beta.delete();
    pinned_dx.delete();
    pinned_dy.delete();

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
    return this.dx.cast(Float32Array).reduce((a,b) => a+b, 0);
  }

  get height(): number {
    return this.dy.cast(Float32Array).reduce((a,b) => a+b, 0);
  }
}
