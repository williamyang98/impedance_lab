<script setup lang="ts">
import { Viewer3D } from "../components/viewer_3d";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';

import { create_simulation_setup } from "../app/app_3d.ts";
import { GpuGrid, GpuEngine } from "../engine/fdtd_3d.ts";
import {
  ref, computed, inject, useTemplateRef, onMounted, onBeforeUnmount,
  type ComputedRef,
} from "vue";

const gpu_device_inject = inject<ComputedRef<GPUDevice>>("gpu_device");
const gpu_adapter_inject = inject<ComputedRef<GPUAdapter>>("gpu_adapter");
if (gpu_device_inject === undefined) throw Error(`Expected gpu_device to be injected from provider`);
if (gpu_adapter_inject === undefined) throw Error(`Expected gpu_adapter to be injected from provider`);
const gpu_device = gpu_device_inject.value;
const gpu_adapter = gpu_adapter_inject.value;

const setup = create_simulation_setup();
const gpu_grid = new GpuGrid(gpu_adapter, gpu_device, setup);
const gpu_engine = new GpuEngine(gpu_adapter, gpu_device);

const curr_step = ref<number>(0);
const max_timesteps = ref<number>(8192);
const time_taken = ref<number>(0);
const total_cells = ref<number>(setup.grid.total_cells);
const loop_timer_id = ref<number | undefined>(undefined);
const ms_start = ref<number | undefined>(undefined);
const display_rate: number = 128;

const step_rate = computed<number>(() => {
  return curr_step.value / Math.max(time_taken.value, 1e-6);
});
const cell_rate = computed<number>(() => {
  return (curr_step.value*total_cells.value) / Math.max(time_taken.value, 1e-6);
});
const is_running = computed<boolean>(() => {
  return loop_timer_id.value !== undefined;
});
const progress_percentage = computed<number>(() => {
  return curr_step.value/max_timesteps.value*100;
});

function update_progress() {
  ms_start.value = ms_start.value ?? performance.now();
  const ms_end = performance.now();
  const ms_elapsed = ms_end-ms_start.value;
  time_taken.value = ms_elapsed*1e-3;
}

const viewer_3d_elem = useTemplateRef<typeof Viewer3D>("viewer_3d");
async function refresh_display() {
  const viewer_3d = viewer_3d_elem.value;
  if (viewer_3d === null) return;
  viewer_3d.set_grid(gpu_grid);
  const command_encoder = gpu_device.createCommandEncoder();
  viewer_3d.upload_slice(command_encoder);
  viewer_3d.update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
}

async function simulation_loop() {
  const update_stride = 16; // avoid overhead of setTimeout
  for (let i = 0; i < update_stride; i++) {
    if (curr_step.value >= max_timesteps.value) {
      loop_timer_id.value = undefined;
      return;
    }
    gpu_engine.step_fdtd(gpu_grid, curr_step.value);
    if (curr_step.value % display_rate == 0) {
      await refresh_display();
      update_progress();
    }
    curr_step.value++;
    if (curr_step.value >= max_timesteps.value) {
      update_progress();
    }
  }
  if (loop_timer_id.value === undefined) return;
  loop_timer_id.value = setTimeout(async () => await simulation_loop(), 0);
}

function stop_loop() {
  if (loop_timer_id.value !== undefined) {
    clearTimeout(loop_timer_id.value);
    loop_timer_id.value = undefined;
  }
}

function start_loop() {
  stop_loop();
  ms_start.value = performance.now();
  curr_step.value = 0;
  gpu_grid.reset();
  loop_timer_id.value = setTimeout(async () => await simulation_loop(), 0);
}

function resume_loop() {
  stop_loop();
  loop_timer_id.value = setTimeout(async () => await simulation_loop(), 0);
}

async function tick_loop() {
  if (curr_step.value >= max_timesteps.value) return;
  stop_loop();
  gpu_engine.step_fdtd(gpu_grid, curr_step.value);
  curr_step.value++;
  await refresh_display();
  update_progress();
}

onMounted(() => {
  const viewer_3d = viewer_3d_elem.value;
  if (viewer_3d === null) {
    throw Error(`Failed to acquire viewer 3d child component`);
  }
  viewer_3d.set_grid(gpu_grid);
  viewer_3d.set_copy_z(Math.round(gpu_grid.size[0]/2));
  start_loop();
});

onBeforeUnmount(() => {
  stop_loop();
});
</script>

<template>
  <div class="flex flex-col gap-y-1 max-w-[750px]">
    <Viewer3D ref="viewer_3d"></Viewer3D>
    <div class="rounded-sm w-[100%] h-[2.0rem] bg-slate-300">
      <div
        class="rounded-sm h-[100%] bg-green-400 text-center"
        :style="{ width: `${progress_percentage.toFixed(2)}%` }"
      >
        <span class="align-middle px-2 font-medium">{{ curr_step }}/{{ max_timesteps }}</span>
      </div>
    </div>
    <div class="flex flex-row gap-x-1">
      <Button @click="start_loop()" :disabled="is_running">Restart</Button>
      <Button @click="resume_loop()" v-if="!is_running">Resume</Button>
      <Button @click="stop_loop()" v-if="is_running">Pause</Button>
      <Button @click="tick_loop()" :disabled="is_running">Tick</Button>
    </div>
    <div>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell class="font-medium">Total steps</TableCell>
            <TableCell>{{ curr_step }}/{{ max_timesteps }}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell class="font-medium">Time taken</TableCell>
            <TableCell>{{ `${time_taken.toFixed(2)} s` }}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell class="font-medium">Step rate</TableCell>
            <TableCell>{{ `${step_rate.toFixed(2)} steps/s` }}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell class="font-medium">Cell rate</TableCell>
            <TableCell>{{ `${(cell_rate*1e-6).toFixed(2)} Mcells/s` }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>

<style scoped>
</style>
