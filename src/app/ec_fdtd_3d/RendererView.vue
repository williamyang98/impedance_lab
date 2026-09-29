<script setup lang="ts">
import { Renderer, get_data_shape_from_render_mode, type RenderMode } from "./renderer.ts";
import { GpuGrid } from "./grid.ts";
import { providers } from "../../providers/providers.ts";
import { ref, watch, computed, useTemplateRef } from "vue";
import { debounce_animation_frame_async } from "../../utility/debounce.ts";
import { type Axis3D } from "../../utility/dim_types.ts";

const gpu_device = providers.gpu_device.value;
const gpu_adapter = providers.gpu_adapter.value;
const gpu_renderer = new Renderer(gpu_adapter, gpu_device);

const axis_mode = ref<Axis3D>("z");
const render_mode_type = ref<RenderMode["type"]>("V");
const render_mode = computed<RenderMode>((): RenderMode => {
  switch (render_mode_type.value) {
    case "V": // @fallthrough
    case "I": // @fallthrough
    case "R": // @fallthrough
    case "C": // @fallthrough
    case "L": // @fallthrough
    case "alpha": // @fallthrough
    case "beta": // @fallthrough
    case "phi": // @fallthrough
    case "I_edge": {
      return { type: render_mode_type.value, axis: axis_mode.value };
    }
    case "epsilon_r": // @fallthrough
    case "mu_r": // @fallthrough
    case "sigma_k": {
      return { type: render_mode_type.value };
    }
  }
});
const is_axis_required = computed(() => {
  switch (render_mode_type.value) {
    case "V": // @fallthrough
    case "I": // @fallthrough
    case "R": // @fallthrough
    case "C": // @fallthrough
    case "L": // @fallthrough
    case "alpha": // @fallthrough
    case "beta": // @fallthrough
    case "phi": // @fallthrough
    case "phi": // @fallthrough
    case "I_edge": {
      return true;
    }
    case "epsilon_r": // @fallthrough
    case "mu_r": // @fallthrough
    case "sigma_k": {
      return false;
    }
  }
});
const gpu_grid = ref<GpuGrid | undefined>(undefined);
const z_slice = ref<number>(0);
const scale_db = ref<number>(0.0);
const zoom_db = ref<number>(0.0);
const scale = computed(() => Math.pow(10.0, scale_db.value/20.0));
const zoom = computed(() => Math.pow(10.0, zoom_db.value/20.0));
const max_z = computed(() => {
  if (gpu_grid.value === undefined) return 0;
  const shape = get_data_shape_from_render_mode(render_mode.value, gpu_grid.value);
  return shape[0]-1;
});

watch(max_z, (max_z) => {
  z_slice.value = Math.min(Math.max(Math.floor(z_slice.value), 0), max_z);
}, { immediate: true });

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
}

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
    z_slice.value,
    scale.value, zoom.value);
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
  set_grid,
  update_display,
  z_slice,
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
      <select id="field" class="select" v-model="render_mode_type">
        <option :value="'V'">Voltage</option>
        <option :value="'I'">Magnetic Current</option>
        <option :value="'I_edge'">Edge Current</option>
        <option :value="'R'">Resistance</option>
        <option :value="'C'">Capacitance</option>
        <option :value="'L'">Inductance</option>
        <option :value="'alpha'">Alpha</option>
        <option :value="'beta'">Beta</option>
        <option :value="'phi'">Phi</option>
        <option :value="'epsilon_r'">Permittivity</option>
        <option :value="'mu_r'">Permeability</option>
        <option :value="'sigma_k'">Conductivity</option>
      </select>
    </fieldset>
    <fieldset class="fieldset" v-if="is_axis_required">
      <legend for="axis" class="fieldset-legend">Axis</legend>
      <select id="axis" class="select" v-model="axis_mode">
        <option :value="'x'">x</option>
        <option :value="'y'">y</option>
        <option :value="'z'">z</option>
      </select>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="slice" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Z</span>
        <span>({{ z_slice }} / {{ max_z }})</span>
      </legend>
      <input id="slice" type="range" class="range" v-model.number="z_slice" min="0" :max="max_z" step="1"/>
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
