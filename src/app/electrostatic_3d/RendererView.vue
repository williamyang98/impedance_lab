<script setup lang="ts">
import { type DisplayMode, Renderer } from "./renderer.ts";
import { GpuGrid } from "./grid.ts";
import { providers } from "../../providers/providers.ts";
import { ref, watch, computed, useTemplateRef } from "vue";
import { debounce_animation_frame_async } from "../../utility/debounce.ts";

const props = defineProps<{
  grid: GpuGrid,
}>();

const gpu_device = providers.gpu_device.value;

const renderer = new Renderer(gpu_device);

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

const copy_z = ref<number>(0);
const max_z = ref<number>(0);
const scale_db = ref<number>(0.0);
const display_mode = ref<DisplayMode>("r");

function upload_slice(command_encoder: GPUCommandEncoder) {
  renderer.upload_slice(command_encoder, props.grid, copy_z.value);
}

function update_display(command_encoder: GPUCommandEncoder) {
  // can't render to 0 sized canvas
  const canvas = canvas_element.value;
  if (canvas === null || canvas.width === 0 || canvas.height == 0) return;

  const scale = Math.pow(10, scale_db.value);
  const canvas_size = {
    width: canvas_context.value.canvas.width,
    height: canvas_context.value.canvas.height,
  };
  renderer.update_display(command_encoder, canvas_context.value, canvas_size, display_mode.value, scale);
}

const refresh = debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  upload_slice(command_encoder);
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(() => props.grid, (grid) => {
  max_z.value = grid.size.z;
  copy_z.value = Math.min(Math.max(copy_z.value, 0), max_z.value);
}, { immediate: true });

watch(copy_z, debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  upload_slice(command_encoder);
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
}));

watch(scale_db, debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
}));

watch(display_mode, debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
}));

// rerender grid if canvas was resized
let resize_observer: ResizeObserver | undefined = undefined;
watch(canvas_element, (elem) => {
  if (elem === null) return;
  resize_observer?.disconnect();
  resize_observer = new ResizeObserver(() => {
    const canvas = canvas_element.value;
    if (canvas === null) return;
    if (canvas.width == canvas.clientWidth && canvas.height == canvas.clientHeight) {
      return;
    }
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    refresh();
  });
  resize_observer.observe(elem);
});


defineExpose({
  refresh,
  copy_z,
  scale_db,
});

</script>

<template>
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
  <canvas ref="field-canvas" class="w-full h-full min-h-0 grid-view"></canvas>
  <form class="flex flex-col gap-y-2 w-full">
    <fieldset class="fieldset">
      <legend for="mode" class="fieldset-legend w-full">Mode</legend>
      <select class="select w-full" v-model="display_mode">
        <option :value="'x'">Voltage</option>
        <option :value="'r'">Residual</option>
        <option :value="'b'">Input voltage</option>
      </select>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="slice" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Z-index</span>
        <span>{{ copy_z }}</span>
      </legend>
      <input id="slice" type="range" class="range w-full" v-model.number="copy_z" min="0" :max="max_z" step="1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Scale</span>
        <span>{{ scale_db.toFixed(2) }}dB</span>
      </legend>
      <input id="scale" type="range" class="range w-full" v-model.number="scale_db" min="-10" max="10" step="0.1"/>
    </fieldset>
  </form>
</div>
</template>

<style scoped>
canvas.grid-view {
  image-rendering: auto;
  display: block;
  scale: 100% -100%;
}
</style>
