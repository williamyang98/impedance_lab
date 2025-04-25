<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

import { Renderer } from "./renderer.ts";
import { type Axis } from "./kernels.ts";
import { Grid } from "../../engine/electrostatic_2d.ts";

import {
  ref, computed, watch, inject, useTemplateRef, defineExpose,
  type ComputedRef,
} from "vue";

const gpu_device_inject = inject<ComputedRef<GPUDevice>>("gpu_device");
const gpu_adapter_inject = inject<ComputedRef<GPUAdapter>>("gpu_adapter");
if (gpu_device_inject === undefined) throw Error(`Expected gpu_device to be injected from provider`);
if (gpu_adapter_inject === undefined) throw Error(`Expected gpu_adapter to be injected from provider`);
const gpu_device = gpu_device_inject.value;
const gpu_adapter = gpu_adapter_inject.value;

const grid_renderer = new Renderer(gpu_adapter, gpu_device);
const display_axis = ref<Axis>("electric_vec");
const display_scale = ref<number>(1.0);

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

function upload_grid(grid: Grid) {
  grid_renderer.upload_grid(grid);
}

async function refresh_canvas() {
  grid_renderer.update_canvas(canvas_context.value, display_scale.value, display_axis.value);
  await grid_renderer.wait_finished();
}

watch(display_axis, async (_new_value, _old_value) => {
  await refresh_canvas();
});

watch(display_scale, async (_new_value, _old_value) => {
  await refresh_canvas();
});

defineExpose({
  upload_grid,
  refresh_canvas,
});
</script>

<template>
  <form class="grid grid-cols-4 gap-x-3">
    <Label for="display_scale">Display scale</Label>
    <Input id="display_scale" type="number" v-model.number="display_scale" min="0" max="10" step="0.1"/>
    <Label for="display_axis">Axis</Label>
    <Select id="display_axis" v-model="display_axis">
      <SelectTrigger class="w-auto">
        <SelectValue/>
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="'voltage'">V</SelectItem>
        <SelectItem :value="'electric_x'">Ex</SelectItem>
        <SelectItem :value="'electric_y'">Ey</SelectItem>
        <SelectItem :value="'electric_mag'">|E|</SelectItem>
        <SelectItem :value="'electric_vec'">Ê</SelectItem>
        <SelectItem :value="'energy'">Energy</SelectItem>
      </SelectContent>
    </Select>
  </form>
  <canvas ref="field-canvas" class="grid-view w-[100%] h-[100%] pt-2"></canvas>
</template>

<style scoped>
canvas.grid-view {
  image-rendering: pixelated;
}
</style>
