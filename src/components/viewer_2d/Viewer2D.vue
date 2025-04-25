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
import { Grid } from "../../engine/electrostatic_2d.ts";

import {
  ref, watch, inject, useTemplateRef, defineExpose,
  type ComputedRef,
} from "vue";

type FieldAxis = "x" | "y" | "mag" | "vec" | "energy";
function field_axis_to_id(axis: FieldAxis): number {
  switch (axis) {
  case "x": return 0;
  case "y": return 1;
  case "mag": return 2;
  case "vec": return 3;
  case "energy": return 4;
  }
}

const gpu_device_inject = inject<ComputedRef<GPUDevice>>("gpu_device");
const gpu_adapter_inject = inject<ComputedRef<GPUAdapter>>("gpu_adapter");
if (gpu_device_inject === undefined) throw Error(`Expected gpu_device to be injected from provider`);
if (gpu_adapter_inject === undefined) throw Error(`Expected gpu_adapter to be injected from provider`);
const gpu_device = gpu_device_inject.value;
const gpu_adapter = gpu_adapter_inject.value;

const grid_renderer = new Renderer(gpu_adapter, gpu_device);
const display_axis = ref<FieldAxis>("vec");
const display_scale = ref<number>(1.0);

const field_canvas = useTemplateRef<HTMLCanvasElement>("field-canvas");

function upload_grid(grid: Grid) {
  grid_renderer.upload_grid(grid);
}

async function refresh_canvas() {
  const canvas = field_canvas.value;
  if (canvas === null) return;
  const axis = field_axis_to_id(display_axis.value);
  grid_renderer.update_canvas(canvas, display_scale.value, axis);
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
        <SelectItem :value="'x'">Ex</SelectItem>
        <SelectItem :value="'y'">Ey</SelectItem>
        <SelectItem :value="'mag'">Magnitude</SelectItem>
        <SelectItem :value="'vec'">Vector</SelectItem>
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
