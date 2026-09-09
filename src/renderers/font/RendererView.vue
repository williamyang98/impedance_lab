<script setup lang="ts">
import { providers } from '../../providers/providers';
import { Renderer } from './renderer';
import { useTemplateRef, computed, ref, watch } from 'vue';
import { debounce_animation_frame_async } from '../../utility/debounce';

const font = providers.msdf_font.value;
const gpu_device = providers.gpu_device.value;

const renderer = new Renderer(gpu_device, font);
const printer = renderer.printer;

{
  let font_size = 20;
  printer.print("Lorem ipsum\n", font_size);
  printer.print("The quick brown fox jumps over the lazy dog.\n", font_size);
  printer.print("0123456789\n", font_size);

  font_size = 10;
  printer.print("ABCDEFGHIJKLMNOPQRSTUVWXYZ\n", font_size);
  printer.print("abcdefghijklmnopqrstuvwxyz\n", font_size);
  printer.print("~!@#$%^&*()_+`-=\\", font_size);
}

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
const zoom_db = ref<number>(-2.4);
const zoom = computed(() => Math.pow(10, zoom_db.value));

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
<div class="w-full h-full grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
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
</template>

<style scoped>
canvas.grid-view {
  image-rendering: auto;
  display: block;
  scale: 100% -100%;
}
</style>
