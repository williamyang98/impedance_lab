<script setup lang="ts">
import { CpuGrid, GpuGrid } from "./grid.ts";
import { providers } from "../../providers/providers.ts";
import { ref, watch, computed, useTemplateRef, toRaw } from "vue";
import { Renderer, type RenderMode } from "./renderer.ts";
import { type ColourMode as IndexBetaColourMode } from "./shader_render_index_beta.ts";
import { debounce_animation_frame_async } from "../../utility/debounce.ts";

const props = defineProps<{
  grid: CpuGrid,
}>();

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;
const gpu_renderer = new Renderer(gpu_adapter, gpu_device);

type Field = "voltage" | "electric_x" | "electric_y" | "electric_vec" | "electric_mag" | "voltage_input" | "dielectric";
const field = ref<Field>("voltage");
const index_beta_mode = ref<IndexBetaColourMode>("index");

const render_mode = computed<RenderMode>((): RenderMode => {
  switch (field.value) {
  case "voltage": return { type: "component", data: "voltage" };
  case "electric_x": return { type: "component", data: "Ex" };
  case "electric_y": return { type: "component", data: "Ey" };
  case "electric_mag": return { type: "magnitude" };
  case "electric_vec": return { type: "quiver" };
  case "voltage_input": return { type: "index_beta", data: "voltage_input", colour: index_beta_mode.value };
  case "dielectric": return { type: "index_beta", data: "dielectric", colour: index_beta_mode.value };
  }
});

const gpu_grid = ref<GpuGrid | undefined>(undefined);
const scale_db = ref<number>(0.0);
const zoom_db = ref<number>(0.0);
const scale = computed(() => Math.pow(10.0, scale_db.value/20.0));
const zoom = computed(() => Math.pow(10.0, zoom_db.value/20.0));

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

watch(() => props.grid, (cpu_grid) => {
  cpu_grid = toRaw(cpu_grid);
  if (gpu_grid.value !== undefined) {
    gpu_grid.value = undefined;
  }
  const new_gpu_grid = new GpuGrid(gpu_device, cpu_grid.size)
  new_gpu_grid.from_cpu(cpu_grid);
  gpu_grid.value = new_gpu_grid;
  const width = cpu_grid.dx.ndarray.cast(Float32Array).reduce((a,b) => a+b, 0);
  const scale = 1.0/width;
  zoom_db.value = 20*Math.log10(scale);
}, { immediate: true });

function update_display(command_encoder: GPUCommandEncoder) {
  if (gpu_grid.value === undefined) return;
  // can't render to 0 sized canvas
  const canvas = canvas_element.value;
  if (canvas === null || canvas.width === 0 || canvas.height == 0) return;
  const canvas_size = {
    x: canvas_context.value.canvas.width,
    y: canvas_context.value.canvas.height,
  };
  gpu_renderer.update_display(
    command_encoder,
    canvas_context.value, canvas_size,
    gpu_grid.value,
    render_mode.value,
    scale.value, zoom.value);
}

const refresh = debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

watch(render_mode, () => { refresh(); });
watch(scale, () => { refresh(); });
watch(zoom, () => { refresh(); });
watch(gpu_grid, () => { refresh(); });

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
  update_display,
  scale_db,
  zoom_db,
});
</script>

<template>
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
  <canvas ref="field-canvas" class="w-full h-full min-h-0 grid-view"></canvas>
  <form class="flex flex-col gap-y-2 w-full">
    <fieldset class="fieldset">
      <legend for="field" class="fieldset-legend">Field</legend>
      <select id="field" class="select" v-model="field">
        <option :value="'voltage'">Voltage</option>
        <option :value="'electric_x'">Ex</option>
        <option :value="'electric_y'">Ey</option>
        <option :value="'electric_vec'">E (vec)</option>
        <option :value="'electric_mag'">|E|</option>
        <option :value="'voltage_input'">Voltage Input</option>
        <option :value="'dielectric'">Dielectric</option>
      </select>
    </fieldset>
    <fieldset class="fieldset" v-if="render_mode.type === 'index_beta'">
      <legend for="axis" class="fieldset-legend">Mode</legend>
      <select id="axis" class="select" v-model="index_beta_mode">
        <option :value="'index'">Index</option>
        <option :value="'beta'">Beta</option>
        <option :value="'value'">Value</option>
      </select>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="zoom" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Zoom</span>
        <span>{{ zoom_db.toFixed(2) }}dB</span>
      </legend>
      <input id="zoom" type="range" class="range" v-model.number="zoom_db" min="-100" max="100" step="0.1"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Scale</span>
        <span>{{ scale_db.toFixed(2) }}dB</span>
      </legend>
      <input id="scale" type="range" class="range" v-model.number="scale_db" min="-100" max="100" step="0.1"/>
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
