<script setup lang="ts">
import Viewer3D from "./Viewer3D.vue";

import { create_single_ended_setup, create_differential_setup } from "./app_3d.ts";
import { GpuEngine } from "./grid.ts";
import { ref, computed, useTemplateRef, onMounted, onBeforeUnmount, reactive } from "vue";
import { providers } from "../../providers/providers.ts";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;
const setups = reactive({
  single_ended: create_single_ended_setup(gpu_adapter, gpu_device),
  differential: create_differential_setup(gpu_adapter, gpu_device),
});

type SetupType = keyof typeof setups;
const selected_setup = ref<SetupType>("single_ended");
const setup = computed(() => {
  return setups[selected_setup.value];
});
const total_cells = computed(() => {
  const size = setup.value.size;
  return size.x*size.y*size.z;
});

const gpu_engine = new GpuEngine(gpu_adapter, gpu_device);

const max_timesteps = ref<number>(8192);
const tick_promise = ref<Promise<void> | undefined>(undefined);
const display_rate: number = 128;

const step_rate = computed(() => {
  if (setup.value.timer.elapsed_seconds === undefined) return undefined;
  const dt = Math.max(setup.value.timer.elapsed_seconds, 1e-6);
  return setup.value.current_step / dt;
});
const cell_rate = computed(() => {
  if (setup.value.timer.elapsed_seconds === undefined) return undefined;
  const dt = Math.max(setup.value.timer.elapsed_seconds, 1e-6);
  return setup.value.current_step*total_cells.value/dt;
});
const is_running = computed(() => tick_promise.value !== undefined);
const progress_percentage = computed(() => setup.value.current_step/max_timesteps.value*100);

const viewer_3d_elem = useTemplateRef<typeof Viewer3D>("viewer_3d");
async function refresh_display() {
  const viewer_3d = viewer_3d_elem.value;
  if (viewer_3d === null) return;
  viewer_3d.set_grid(setup.value.gpu);
  const command_encoder = gpu_device.createCommandEncoder();
  viewer_3d.upload_slice(command_encoder);
  viewer_3d.update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
}

function sleep(millis: number) {
  return new Promise(resolve => setTimeout(resolve, millis));
}

async function simulation_loop() {
  const update_stride = 32;
  for (let i = 0; i < update_stride; i++) {
    const curr_step = setup.value.current_step;
    if (curr_step >= max_timesteps.value) {
      await sleep(0);
      tick_promise.value = undefined;
      return;
    }
    gpu_engine.step_fdtd(setup.value);
    if (curr_step % display_rate == 0) {
      await refresh_display();
    }
  }
  await sleep(0);
  if (tick_promise.value === undefined) return;
  tick_promise.value = simulation_loop();
}

async function stop_loop() {
  if (tick_promise.value === undefined) return;
  const promise = tick_promise.value;
  tick_promise.value = undefined;
  await promise;
}

async function start_loop() {
  await stop_loop();
  setup.value.reset();
  tick_promise.value = simulation_loop();
}

async function resume_loop() {
  await stop_loop();
  tick_promise.value = simulation_loop();
}

async function tick_loop() {
  if (setup.value.current_step >= max_timesteps.value) return;
  await stop_loop();
  gpu_engine.step_fdtd(setup.value);
  await refresh_display();
}

onMounted(async () => {
  const viewer_3d = viewer_3d_elem.value;
  if (viewer_3d === null) {
    throw Error(`Failed to acquire viewer 3d child component`);
  }
  viewer_3d.set_grid(setup.value.gpu);
  await sleep(0);
  viewer_3d.set_copy_z(Math.round(setup.value.size.z/2));
  await start_loop();
});

onBeforeUnmount(() => {
  void stop_loop();
});
</script>

<template>
  <div class="flex flex-col gap-y-1 max-w-[750px]">
    <Viewer3D ref="viewer_3d"></Viewer3D>
    <div class="rounded-sm w-full h-[2.0rem] bg-slate-300 border-1 border-slate-300 border-sm">
      <div
        class="rounded-sm h-full bg-green-400 text-center"
        :style="{ width: `${progress_percentage.toFixed(2)}%` }"
      >
        <span class="align-middle px-2 font-medium">{{ setup.current_step }}/{{ max_timesteps }}</span>
      </div>
    </div>
    <div class="flex flex-row gap-x-1">
      <button class="btn" @click="start_loop()" :disabled="is_running">Restart</button>
      <button class="btn" @click="resume_loop()" v-if="!is_running">Resume</button>
      <button class="btn" @click="stop_loop()" v-if="is_running">Pause</button>
      <button class="btn" @click="tick_loop()" :disabled="is_running">Tick</button>
      <select class="select" v-model="selected_setup">
        <option :value="'single_ended'">Single Ended</option>
        <option :value="'differential'">Differential</option>
      </select>
    </div>
    <div>
      <table class="table">
        <tbody>
          <tr>
            <td class="font-medium">Total steps</td>
            <td>{{ setup.current_step }}/{{ max_timesteps }}</td>
          </tr>
          <tr>
            <td class="font-medium">Time taken</td>
            <td>{{ setup.timer.elapsed_seconds !== undefined ? `${setup.timer.elapsed_seconds.toFixed(2)} s` : '?' }}</td>
          </tr>
          <tr>
            <td class="font-medium">Step rate</td>
            <td>{{ step_rate !== undefined ? `${step_rate.toFixed(2)} steps/s` : '?' }}</td>
          </tr>
          <tr>
            <td class="font-medium">Cell rate</td>
            <td>{{ cell_rate !== undefined ? `${(cell_rate*1e-6).toFixed(2)} Mcells/s` : '?' }}</td>
          </tr>
          <tr>
            <td class="font-medium">Grid Size</td>
            <td>x: {{ setup.size.x }}, y: {{ setup.size.y }}, z: {{ setup.size.z }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
</style>
