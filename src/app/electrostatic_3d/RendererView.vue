<script lang="ts" setup>
import { Renderer, type RenderMode } from "./renderer.ts";
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

const render_mode = ref<RenderMode>("voltage");
const max_z_slice = computed(() => {
  switch (render_mode.value) {
  case "voltage": return props.grid.v_in.shape[0];
  case "residual": return props.grid.r.shape[0];
  case "dielectric": return props.grid.er.shape[0];
  case "input": return props.grid.b.shape[0];
  }
});
const z_slice = ref<number>(0);
const scale_db = ref<number>(0.0);
const scale = computed(() => Math.pow(10, scale_db.value/20));
const zoom_db = ref<number>(-20);
const zoom = computed(() => Math.pow(10, zoom_db.value/20));
function update_display(command_encoder: GPUCommandEncoder) {
  // can't render to 0 sized canvas
  const canvas = canvas_element.value;
  if (canvas === null || canvas.width === 0 || canvas.height == 0) return;
  const canvas_size = {
    x: canvas_context.value.canvas.width,
    y: canvas_context.value.canvas.height,
  };
  renderer.update_display(
    command_encoder,
    canvas_context.value, canvas_size,
    props.grid,
    render_mode.value,
    z_slice.value,
    scale.value, zoom.value,
  );
}

const refresh = debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(scale, () => { refresh(); });
watch(z_slice, () => { refresh(); });
watch(zoom, () => { refresh(); });
watch(render_mode, () => { refresh(); });
watch(() => props.grid, () => { refresh(); })

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
  z_slice,
  zoom_db,
  scale_db,
});

</script>

<template>
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
  <canvas ref="field-canvas" class="w-full h-full min-h-0 grid-view"></canvas>
  <form class="flex flex-col gap-y-2 w-full">
    <fieldset class="fieldset">
      <legend for="render_mode" class="fieldset-legend">Field</legend>
      <select id="render_mode" class="select" v-model="render_mode">
        <option :value="'voltage'">Voltage</option>
        <option :value="'input'">Input Voltage</option>
        <option :value="'residual'">Residual</option>
        <option :value="'dielectric'">Dielectric</option>
      </select>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="z_slice" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Z</span>
        <span>({{ z_slice }} / {{ max_z_slice-1 }})</span>
      </legend>
      <input id="z_slice" type="range" class="range w-full" v-model.number="z_slice" min="0" :max="max_z_slice-1" step="1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="zoom" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Zoom</span>
        <span>{{ zoom_db.toFixed(2) }}dB</span>
      </legend>
      <input id="zoom" type="range" class="range w-full" v-model.number="zoom_db" min="-50" max="50" step="0.1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Scale</span>
        <span>{{ scale_db.toFixed(2) }}dB</span>
      </legend>
      <input id="scale" type="range" class="range w-full" v-model.number="scale_db" min="-200" max="200" step="0.1"/>
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
