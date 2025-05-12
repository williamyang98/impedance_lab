<script setup lang="ts">
import { type GridDisplayMode, type FieldDisplayMode, Renderer } from "./renderer.ts";
import { GpuGrid } from "../../engine/fdtd_3d.ts";

import {
  ref, watch, computed, inject, useTemplateRef, defineExpose,
  type ComputedRef
} from "vue";

const gpu_device_inject = inject<ComputedRef<GPUDevice>>("gpu_device");
const gpu_adapter_inject = inject<ComputedRef<GPUAdapter>>("gpu_adapter");
if (gpu_device_inject === undefined) throw Error(`Expected gpu_device to be injected from provider`);
if (gpu_adapter_inject === undefined) throw Error(`Expected gpu_adapter to be injected from provider`);
const gpu_device = gpu_device_inject.value;
const gpu_adapter = gpu_adapter_inject.value;

const gpu_renderer = new Renderer(gpu_adapter, gpu_device);

const gpu_grid = ref<GpuGrid | undefined>(undefined);
const copy_z = ref<number>(0);
const max_z = ref<number>(0);
const scale_db = ref<number>(0.0);
const axis_mode = ref<GridDisplayMode>("x");
const field_mode = ref<FieldDisplayMode>("e_field");

const canvas_element = useTemplateRef<HTMLCanvasElement>("field-canvas");
const canvas_context = computed<GPUCanvasContext>(() => {
  const canvas = canvas_element.value;
  if (canvas === null) {
    throw Error(`Failed to get canvas element`);
  }
  const canvas_context: GPUCanvasContext | null = canvas.getContext("webgpu");
  if (canvas_context === null) {
    throw Error("Failed to get webgpu context from canvas");
  }
  return canvas_context;
});

function set_grid(new_gpu_grid: GpuGrid) {
  gpu_grid.value = new_gpu_grid;
  const new_max_z = new_gpu_grid.size[0]-1;
  max_z.value = new_max_z;
  copy_z.value = Math.min(Math.max(copy_z.value, 0), new_max_z);
}

function set_copy_z(new_copy_z: number) {
  copy_z.value = new_copy_z;
}

function upload_slice(command_encoder: GPUCommandEncoder) {
  if (gpu_grid.value === undefined) return;
  copy_z.value = Math.min(Math.max(copy_z.value, 0), gpu_grid.value.size[0]-1);
  gpu_renderer.upload_slice(command_encoder, gpu_grid.value, copy_z.value, field_mode.value);
}

function update_display(command_encoder: GPUCommandEncoder) {
  const get_scale_offset = (mode: FieldDisplayMode): number => {
    switch (mode) {
    case "e_field": return 0;
    case "h_field": return 2;
    }
  };
  const scale_offset = get_scale_offset(field_mode.value);
  const scale = 10**(scale_db.value+scale_offset);
  gpu_renderer.update_display(command_encoder, canvas_context.value, scale, axis_mode.value);
}

watch(copy_z, async (_new_value, _old_value) => {
  const command_encoder = gpu_device.createCommandEncoder();
  upload_slice(command_encoder);
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(field_mode, async (_new_value, _old_value) => {
  const command_encoder = gpu_device.createCommandEncoder();
  upload_slice(command_encoder);
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(axis_mode, async (_new_value, _old_value) => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(scale_db, async (_new_value, _old_value) => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

defineExpose({
  set_grid,
  set_copy_z,
  upload_slice,
  update_display,
});
</script>

<template>
  <form class="grid grid-cols-4 gap-x-2 px-4 my-2">
    <fieldset class="fieldset">
      <legend for="slice" class="fieldset-legend">Z-index</legend>
      <input id="slice" type="range" class="range" v-model.number="copy_z" min="0" :max="max_z" step="1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="scale" class="fieldset-legend">Scale</legend>
      <input id="scale" type="range" class="range" v-model.number="scale_db" min="-4" max="4" step="0.1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="axis" class="fieldset-legend">Axis</legend>
      <select id="axis" class="select" v-model="axis_mode">
        <option :value="'x'">Ex</option>
        <option :value="'y'">Ey</option>
        <option :value="'z'">Ez</option>
        <option :value="'mag'">Magnitude</option>
      </select>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="field" class="fieldset-legend">Field</legend>
      <select id="field" class="select" v-model="field_mode">
        <option :value="'e_field'">Electric</option>
        <option :value="'h_field'">Magnetic</option>
      </select>
    </fieldset>
  </form>
  <canvas ref="field-canvas" class="w-[100%] pt-2"></canvas>
</template>

<style scoped>
</style>
