<script setup lang="ts">
import { providers } from '../../providers/providers';
import { Renderer } from './renderer';
import { useTemplateRef, computed, ref, watch } from 'vue';
import { debounce_animation_frame_async } from '../../utility/debounce';

const font = providers.msdf_font.value;
const gpu_device = providers.gpu_device.value;

const renderer = new Renderer(gpu_device, font);
const printer = renderer.printer;

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

const scale_db = ref<number>(0.0);
const scale = computed(() => Math.pow(10, scale_db.value));
const zoom_db = ref<number>(-2.0);
const zoom = computed(() => Math.pow(10, zoom_db.value));
const font_size = ref<number>(15);
const text_input = ref<string>("Lorem ipsum");

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
    zoom.value, scale.value,
  );
}

const refresh = debounce_animation_frame_async(async () => {
  const command_encoder = gpu_device.createCommandEncoder();
  update_display(command_encoder);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone();
});

function print_test(is_refresh: boolean) {
  let size = font_size.value;
  printer.print("Lorem ipsum\n", size);
  printer.print("The quick brown fox jumps over the lazy dog.\n", size);
  printer.print("0123456789\n", size);

  size *= 0.5;
  printer.print("ABCDEFGHIJKLMNOPQRSTUVWXYZ\n", size);
  printer.print("abcdefghijklmnopqrstuvwxyz\n", size);
  printer.print("~!@#$%^&*()_+`-=\\\n", size);

  if (is_refresh) {
    refresh();
  }
}
print_test(false);

function append_text() {
  printer.print(text_input.value + "\n", font_size.value);
  text_input.value = "";
  refresh();
}

function clear_text() {
  printer.reset();
  refresh();
}

watch(scale, () => { refresh(); });
watch(zoom, () => { refresh(); });

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
  scale_db,
});

</script>

<template>
<div class="w-full h-[35rem] grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
  <canvas ref="field-canvas" class="w-full h-full min-h-0 grid-view"></canvas>
  <form class="flex flex-col gap-y-2 w-full">
    <fieldset class="fieldset">
      <legend for="zoom" class="fieldset-legend w-full flex flex-row justify-between">
        <span>Zoom</span>
        <span>{{ zoom_db.toFixed(2) }}dB</span>
      </legend>
      <input id="zoom" type="range" class="range w-full" v-model.number="zoom_db" min="-10" max="10" step="0.1"/>
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
<div class="w-full">
  <form class="flex flex-col gap-y-2 w-full" @submit.prevent="append_text">
    <fieldset class="fieldset">
      <legend for="text_input" class="fieldset-legend">Text</legend>
      <input id="text_input" type="text" class="input" v-model="text_input"/>
    </fieldset>
    <fieldset class="fieldset">
      <legend for="font_size" class="fieldset-legend">Font Size</legend>
      <input id="font_size" type="number" class="input" v-model.number="font_size" min="0" max="200" step="0.1"/>
    </fieldset>
    <div class="flex flex-row">
      <button class="btn" type="submit">Print</button>
      <button class="btn" @click="clear_text" type="button">Clear</button>
      <button class="btn" @click="print_test(true)" type="button">Print Test</button>
    </div>
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
