<script lang="ts" setup>
import { Globals } from "../../global";
import {
  LU_Solver,
  Float32ModuleBuffer, Int32ModuleBuffer,
} from "../../wasm/index.ts";
import { Profiler } from "../../utility/profiler.ts";
import ProfilerFlameChart from "../../utility/ProfilerFlameChart.vue";
import { ref, toRaw } from "vue";
import { Uint8ArrayNdarrayWriter } from "../../utility/ndarray.ts";
import { Float32ModuleNdarray } from "../../utility/module_ndarray.ts";

const module = Globals.wasm_module;
const profiler = ref<Profiler | undefined>(undefined);
const B_data = ref<Float32ModuleNdarray | undefined>(undefined);

function run_lu_solver() {
  const A_data: number[] = [];
  const A_col_indices: number[] = [];
  const A_row_index_ptr: number[] = [];
  const B: number[] = [];

  const push_csr_entry = (value: number, column: number) => {
    A_data.push(value);
    A_col_indices.push(column);
  }

  const push_csr_row = () => {
    A_row_index_ptr.push(A_data.length);
  }

  const Nz = 20;
  const Ny = 24;
  const Nx = 24;

  const dx = new Float32Array(Nx);
  const dy = new Float32Array(Ny);
  const dz = new Float32Array(Nz);
  dx.fill(1.0);
  dy.fill(1.0);
  dz.fill(1.0);

  const new_profile = new Profiler();

  const H = 10;
  const DH = Math.ceil((Nz-H)/2);
  const D0 = 4; // barrel
  const D1 = 8; // pad
  const D2 = 7; // antipad

  for (let i = 0; i < DH; i++) {
    const delta = Math.pow(1.25, DH-i);
    dz[i] = delta;
    dz[Nz-i-1] = delta;
  }

  const Dmax = Math.max(D0,D1,D2)
  const xy_padding = Math.floor((Ny-Dmax)/2);
  for (let i = 0; i < xy_padding; i++) {
    const delta = Math.pow(1.25, xy_padding-i);
    dy[i] = delta;
    dy[Ny-i-1] = delta;
    dx[i] = delta;
    dx[Nx-i-1] = delta;
  }

  new_profile.begin("create_csr");
  for (let z = 0; z < Nz+1; z++) {
    for (let y = 0; y < Ny+1; y++) {
      for (let x = 0; x < Nx+1; x++) {
        push_csr_row();
        const iv = x + y*(Nx+1) + z*(Ny+1)*(Nx+1);
        let beta = 0.0;
        // antipad reference plane
        if (z === Math.ceil(Nz/2) && ((y-Ny/2)**2 + (x-Nx/2)**2) >= D2**2) {
          beta = 1.0;
          B.push(0);
        // pad
        } else if ((z === DH || z === Nz-DH) && ((y-Ny/2)**2 + (x-Nx/2)**2 <= D1**2)) {
          beta = 1.0;
          B.push(1);
        // barrel
        } else if ((z >= DH && z <= (Nz-DH)) &&  ((y-Ny/2)**2 + (x-Nx/2)**2 <= D0**2)) {
          beta = 1.0;
          B.push(1);
        } else {
          beta = 0.0;
          B.push(0);
        }

        const has_div_E_constraint = (x > 0 && x < Nx) || (y > 0 && y < Ny) || (z > 0 && z < Nz);
        if ((beta > 0.5) || !has_div_E_constraint) {
          push_csr_entry(1, iv);
          continue;
        }

        // div(E)[z,y,x] = (Ex[z,y,x]-Ex[z,y,x-1])/(dx[x]+dx[x-1]) +
        //                 (Ey[z,y,x]-Ey[z,y-1,x])/(dy[y]+dy[y-1]) +
        //                 (Ez[z,y,x]-Ey[z-1,y,x])/(dz[z]+dz[z-1])
        // div(E)[z,y,x] = 0
        //
        // Ex[z,y,x] = -(V[z,y,x+1]-V[z,y,x])/dx[x]
        // Ey[z,y,x] = -(V[z,y+1,x]-V[z,y,x])/dy[y]
        // Ez[z,y,x] = -(V[z+1,y,x]-V[z,y,x])/dz[z]
        //
        // substituting into div(E)[z,y,z] = 0
        // div(E)[z,y,z] = - (V[z,y,x+1]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[z,y,x]
        //                 + (V[z,y,x+0]/dx[x+0])/(dx[x]+dx[x-1]) # Ex[z,y,x]
        //                 + (V[z,y,x+0]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[z,y,x-1]
        //                 - (V[z,y,x-1]/dx[x-1])/(dx[x]+dx[x-1]) # Ex[z,y,x-1]
        //                 - (V[z,y+1,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[z,y,x]
        //                 + (V[z,y+0,x]/dy[y+0])/(dy[y]+dy[y-1]) # Ey[z,y,x]
        //                 + (V[z,y+0,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[z,y-1,x]
        //                 - (V[z,y-1,x]/dy[y-1])/(dy[y]+dy[y-1]) # Ey[z,y-1,x]
        //                 - (V[z+1,y,x]/dz[z+0])/(dz[z]+dz[z-1]) # Ez[z,y,x]
        //                 + (V[z+0,y,x]/dz[z+0])/(dz[z]+dz[z-1]) # Ez[z,y,x]
        //                 + (V[z+0,y,x]/dz[z-1])/(dz[z]+dz[z-1]) # Ez[z-1,y,x]
        //                 - (V[z-1,y,x]/dz[z-1])/(dz[z]+dz[z-1]) # Ez[z-1,y,x]
        // div(E)[z,y,z] = 0
        //
        // This gives us a row for our constraint matrix L and target value b
        // these are the possible columns that are set in a row inside L
        // di = -(Ny+1)*(Nx+1), -(Nx+1), -1, 0, +1, +(Nx+1), +(Ny+1)*(Nx+1)
        const column_value = [0,0,0,0,0,0,0];
        const column_index = [iv-(Ny+1)*(Nx+1), iv-(Nx+1), iv-1, iv, iv+1, iv+(Nx+1), iv+(Ny+1)*(Nx+1)];

        // div(Ex) = 0
        if (x > 0 && x < Nx) {
          const dx_0 = dx[x-1];
          const dx_1 = dx[x];
          const norm = dx_0+dx_1;
          column_value[2] -= (1/dx_0)/norm;
          column_value[3] += (1/dx_0 + 1/dx_1)/norm;
          column_value[4] -= (1/dx_1)/norm;
        }

        // div(Ey) = 0
        if (y > 0 && y < Ny) {
          const dy_0 = dy[y-1];
          const dy_1 = dy[y];
          const norm = dy_0+dy_1;
          column_value[1] -= (1/dy_0)/norm;
          column_value[3] += (1/dy_0 + 1/dy_1)/norm;
          column_value[5] -= (1/dy_1)/norm;
        }

        // div(Ez) = 0
        if (z > 0 && z < Nz) {
          const dz_0 = dz[z-1];
          const dz_1 = dz[z];
          const norm = dz_0+dz_1;
          column_value[0] -= (1/dz_0)/norm;
          column_value[3] += (1/dz_0 + 1/dz_1)/norm;
          column_value[6] -= (1/dz_1)/norm;
        }

        for (let i = 0; i < 7; i++) {
          const value = column_value[i];
          const index = column_index[i];
          if (value != 0) {
            push_csr_entry(value, index);
          }
        }
      }
    }
  }
  push_csr_row();
  new_profile.end();

  console.log("Created CSR matrix");

  new_profile.begin("upload_data_wasm");
  const pinned_A_data = Float32ModuleBuffer.create(module, A_data.length);
  const pinned_A_col_indices = Int32ModuleBuffer.create(module, A_col_indices.length);
  const pinned_A_row_index_ptr = Int32ModuleBuffer.create(module, A_row_index_ptr.length);
  const pinned_B = Float32ModuleNdarray.from_shape(module, [Nz+1,Ny+1,Nx+1]);
  pinned_A_data.array_view.set(A_data);
  pinned_A_col_indices.array_view.set(A_col_indices);
  pinned_A_row_index_ptr.array_view.set(A_row_index_ptr);
  pinned_B.array_view.set(B);
  new_profile.end();

  new_profile.begin("lu_factorisation");
  const total_voltages = (Nz+1)*(Ny+1)*(Nx+1);
  console.log(`Total voltages = ${total_voltages}`);
  const lu_solver = new LU_Solver(module, pinned_A_data, pinned_A_col_indices, pinned_A_row_index_ptr, total_voltages, total_voltages);
  new_profile.end();

  new_profile.begin("lu_solve");
  const solve_code = lu_solver.solve(pinned_B);
  console.log(`solve_code=${solve_code}`);
  new_profile.end();

  new_profile.begin("lu_free");
  lu_solver.delete();
  pinned_A_data.delete();
  pinned_A_col_indices.delete();
  pinned_A_row_index_ptr.delete();
  new_profile.end();

  new_profile.end_all();

  profiler.value = new_profile;
  toRaw(B_data.value)?.delete();
  B_data.value = pinned_B;
}

function download_b_data() {
  const data = toRaw(B_data.value);
  if (data === undefined) return;
  const writer = new Uint8ArrayNdarrayWriter();
  data.ndarray.export_as_numpy_bytecode(writer);
  if (writer.buffer !== undefined) {
    const blob = new Blob([writer.buffer], { type: "application/octet-stream" });
    const elem = document.createElement("a");
    elem.href = window.URL.createObjectURL(blob);
    elem.download = "via_3d_electrostatic.npy";
    elem.click();
  }
}

</script>

<template>
<div class="flex flex-row">
  <button class="btn" @click="run_lu_solver()">Run LU Solver</button>
  <button v-if="B_data" class="btn" @click="download_b_data">Download data</button>
</div>

<div class="w-full h-[20rem]" v-if="profiler">
  <ProfilerFlameChart :profiler="profiler"/>
</div>
</template>
