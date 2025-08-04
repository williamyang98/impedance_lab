<script lang="ts" setup>
import { toRaw, ref, useTemplateRef, watch } from 'vue';
import { providers } from '../../providers/providers';
import { type Size3D } from '../../wgpu_kernels/electrostatic_3d';
import { CpuGrid, GpuGrid, GpuEngine } from "./grid.ts";
import ExportView from './ExportView.vue';
import RendererView from './RendererView.vue';
import TabsView from '../../utility/TabsView.vue';

const gpu_device = toRaw(providers.gpu_device.value);
const toast = providers.toast_manager.value;

const grid_size: Size3D = { x: 128, y: 128, z: 64 };
const cpu_grid = new CpuGrid(grid_size);
{
  cpu_grid.dx.data.fill(1);
  cpu_grid.dy.data.fill(1);
  cpu_grid.dz.data.fill(1);
  cpu_grid.mask.data.fill(0);
  const Nx = cpu_grid.size.x;
  const Ny = cpu_grid.size.y;
  const _Nz = cpu_grid.size.z;
  {
    // ground plane
    const height = 16;
    const v_force = 0;
    cpu_grid.b.hi([height,Ny,Nx]).fill(v_force)
    const mask = cpu_grid.mask.cast(Uint32Array);
    const Nxy = Nx*Ny;
    for (let z = 0; z < height; z++) {
      for (let y = 0; y < Ny; y++) {
        for (let x = 0; x < Nx; x++) {
          const i = x+y*Nx+z*Nxy;
          const imask = Math.floor(i/32);
          const imask_offset = i-imask*32;
          mask[imask] |= (1 << imask_offset);
        }
      }
    }
  }
  {
    // voltage plate
    const Nz0 = 32;
    const Nz1 = 35;
    const Ny0 = 32;
    const Ny1 = 64;
    const Nx0 = 32;
    const Nx1 = 64;
    const v_force = 1;
    cpu_grid.b.hi([Nz1,Ny1,Nx1]).lo([Nz0,Ny0,Nx0]).fill(v_force)
    const mask = cpu_grid.mask.cast(Uint32Array);
    const Nxy = Nx*Ny;
    for (let z = Nz0; z < Nz1; z++) {
      for (let y = Ny0; y < Ny1; y++) {
        for (let x = Nx0; x < Nx1; x++) {
          const i = x+y*Nx+z*Nxy;
          const imask = Math.floor(i/32);
          const imask_offset = i-imask*32;
          mask[imask] |= (1 << imask_offset);
        }
      }
    }
  }
  {
    // voltage plate
    const Nz0 = 52;
    const Nz1 = 55;
    const Ny0 = 62;
    const Ny1 = 94;
    const Nx0 = 62;
    const Nx1 = 94;
    const v_force = -1;
    cpu_grid.b.hi([Nz1,Ny1,Nx1]).lo([Nz0,Ny0,Nx0]).fill(v_force)
    const mask = cpu_grid.mask.cast(Uint32Array);
    const Nxy = Nx*Ny;
    for (let z = Nz0; z < Nz1; z++) {
      for (let y = Ny0; y < Ny1; y++) {
        for (let x = Nx0; x < Nx1; x++) {
          const i = x+y*Nx+z*Nxy;
          const imask = Math.floor(i/32);
          const imask_offset = i-imask*32;
          mask[imask] |= (1 << imask_offset);
        }
      }
    }
  }
}
const gpu_grid = new GpuGrid(grid_size, gpu_device);
gpu_grid.from_cpu(cpu_grid);
const gpu_engine = new GpuEngine(gpu_device);

const total_steps = ref<number>(128);

type RunStatus =
  { type: "running", curr_step: number, total_steps: number } |
  { type: "error", error: string };
const run_status = ref<RunStatus | undefined>(undefined);
const is_running = ref<boolean>(false);
const renderer_view = useTemplateRef<typeof RendererView>("renderer_view");
watch(renderer_view, (view) => {
  if (view === null) return;
  view.copy_z = 32;
});

async function run() {
  if (is_running.value) {
    return;
  }
  is_running.value = true;
  try {
    const stride_size = 64;
    const total_strides = Math.ceil(total_steps.value/stride_size);
    run_status.value = {
      type: "running",
      curr_step: 0,
      total_steps: stride_size*total_strides,
    };

    for (let i = 0; i < total_strides; i++) {
      const command_encoder = gpu_device.createCommandEncoder();
      gpu_engine.jacobi_smooth(command_encoder, gpu_grid, stride_size);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();
      run_status.value.curr_step = (i+1)*stride_size;
    }
    toast.info(`GPU engine ran ${run_status.value.total_steps} steps`);

    {
      console.log("Calculating residual");
      const command_encoder = gpu_device.createCommandEncoder();
      gpu_engine.calculate_residual(command_encoder, gpu_grid);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();
    }

    renderer_view.value?.refresh();

    await gpu_grid.to_cpu(cpu_grid);
    await gpu_device.queue.onSubmittedWorkDone();
  } catch (error) {
    toast.error(`run failed with: ${String(error)}`);
    run_status.value = { type: "error", error: String(error) };
  }
  is_running.value = false;
}

</script>

<template>
<TabsView :initial_tab="'0'">
  <template #h-0>Calculator</template>
  <template #b-0>
    <div class="flex flex-col w-full h-full">
      <div class="flex flex-row items-center">
        <input class="input" type="number" v-model.number="total_steps" min="0" step="1"/>
        <button class="btn" @click="run" :disabled="is_running">Run</button>
        <div class="rounded-sm w-full h-[2.0rem] bg-slate-300 border-1 border-slate-300 border-sm">
          <template v-if="run_status?.type === 'running'">
            <div
              class="rounded-sm h-full bg-green-400 text-center"
              :style="{ width: `${(run_status.curr_step/run_status.total_steps*100).toFixed(2)}%` }"
            >
              <span class="align-middle px-2 font-medium">{{ run_status.curr_step }}/{{ run_status.total_steps }}</span>
            </div>
          </template>
          <template v-if="run_status?.type === 'error'">
            <div class="rounded-sm h-full bg-error text-center w-full">
              <span class="align-middle px-2 font-medium">{{ run_status.error }}</span>
            </div>
          </template>
        </div>
      </div>
      <div class="w-full h-full min-h-0">
        <RendererView :grid="gpu_grid" ref="renderer_view"/>
      </div>
    </div>
  </template>
  <template #h-1>Export</template>
  <template #b-1>
    <div class="w-full flex justify-center-safe overflow-x-auto">
      <ExportView :grid="cpu_grid" class="w-fit border border-base-300 bg-base-100"/>
    </div>
  </template>
</TabsView>
</template>
