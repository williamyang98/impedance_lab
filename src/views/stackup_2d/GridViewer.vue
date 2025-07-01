<script setup lang="ts">
import {
  toRaw,
  ref, computed, watch, useTemplateRef, defineExpose, onMounted, onBeforeUnmount, defineProps,
} from "vue";
import { Grid } from "./electrostatic_2d.ts";
import { MasterRenderer, RendererCore, type Tooltip } from "./grid_viewer_renderer.ts";
import { providers } from "../../providers/providers.ts";
import { debounce_animation_frame, debounce_animation_frame_async } from "../../utility/debounce.ts";

const props = defineProps<{
  grid: Grid;
}>();

const gpu_device = providers.gpu_device.value;

const canvas_element = useTemplateRef<HTMLCanvasElement>("grid-canvas");
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

const renderer_core = new RendererCore(toRaw(props.grid), gpu_device);
const master_renderer = ref(new MasterRenderer(renderer_core));
const selected_renderer = computed(() => master_renderer.value.selected);
// each renderer is mapped to a different buffer, and we only reupload data for that specific renderer on demand
const is_uploaded = new Set<typeof master_renderer.value.mode>();


const refresh = debounce_animation_frame_async(async () => {
  // can't render to 0 sized canvas
  const canvas = canvas_element.value;
  if (canvas === null || canvas.width === 0 || canvas.height == 0) return;

  const context = toRaw(canvas_context.value);
  context.configure({
    device: gpu_device,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: "premultiplied",
  });
  const canvas_texture = context.getCurrentTexture().createView();
  const canvas_size = {
    width: canvas_context.value.canvas.width,
    height: canvas_context.value.canvas.height,
  };
  const command_encoder = gpu_device.createCommandEncoder();
  const renderer = toRaw(master_renderer.value);
  if (!is_uploaded.has(renderer.mode)) {
    renderer.upload_data();
    is_uploaded.add(renderer.mode);
  }
  renderer.create_pass(command_encoder, canvas_texture, canvas_size);
  gpu_device.queue.submit([command_encoder.finish()]);
  await gpu_device.queue.onSubmittedWorkDone()
});

// tooltip
const is_mouse_over = ref<boolean>(false);

interface HoverInfo {
  x: number;
  y: number;
  tooltip: Tooltip;
}
const hover_info = ref<HoverInfo | undefined>(undefined);

const on_mouse_move = debounce_animation_frame((ev: MouseEvent) => {
  if (!is_mouse_over.value) return;
  if (ev.target === null) return;
  const target = ev.target as HTMLCanvasElement;
  const rect = target.getBoundingClientRect();
  const dx = ev.clientX-rect.left;
  const dy = ev.clientY-rect.top;
  const norm_x = dx/rect.width;
  const norm_y = dy/rect.height;
  const tooltip = toRaw(master_renderer.value).get_tooltip(norm_x, norm_y);
  hover_info.value = {
    x: dx,
    y: dy,
    tooltip,
  };
});

function on_mouse_enter(ev: MouseEvent) {
  ev.stopPropagation();
  is_mouse_over.value = true;
}

function on_mouse_leave(ev: MouseEvent) {
  ev.stopPropagation();
  is_mouse_over.value = false;
}

function update_grid(grid: Grid) {
  grid = toRaw(grid);
  renderer_core.grid = grid;
  is_uploaded.clear();
  let aspect_ratio = grid.size[1]/grid.size[0];
  aspect_ratio = Math.min(aspect_ratio, 2);
  const elem = canvas_element.value;
  if (elem !== null) {
    elem.style.setProperty("aspect-ratio", aspect_ratio.toFixed(3), "important");
  }
  refresh();
}

watch(props, () => {
  update_grid(props.grid);
});

// rerender grid if canvas was resized
let resize_observer: ResizeObserver | undefined = undefined;
watch(canvas_element, (elem) => {
  if (elem === null) return;
  if (resize_observer !== undefined) {
    resize_observer.disconnect();
  }
  resize_observer = new ResizeObserver(() => {
    const canvas = canvas_element.value;
    if (canvas === null) return false;
    if (canvas.width == canvas.clientWidth && canvas.height == canvas.clientHeight) {
      return;
    }
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    void refresh();
  });
  resize_observer.observe(elem);
});

onMounted(() => {
  update_grid(props.grid);
})

onBeforeUnmount(() => {
  if (resize_observer !== undefined) {
    resize_observer.disconnect();
  }
});

defineExpose({
  refresh,
});

</script>

<template>
<div class="w-full grid grid-cols-1 sm:grid-cols-[auto_15rem] gap-x-2 gap-y-2">
  <div class="relative w-full h-fit">
    <canvas
      ref="grid-canvas"
      class="grid-view w-full max-h-[75vh] border-1 border-slate-300"
      @mousemove="on_mouse_move"
      @mouseenter="on_mouse_enter"
      @mouseleave="on_mouse_leave"
    >
    </canvas>
    <!--Hover info-->
    <template v-if="is_mouse_over && hover_info !== undefined">
      <div
        class="absolute pointer-events-none z-1 card card-border bg-base-100 m-2 min-w-[12rem]"
        :style="`left: ${hover_info.x.toFixed(0)}px; top: ${hover_info.y.toFixed(0)}px`"
      >
        <div class="card-body p-1">
          <table class="w-full table table-sm">
            <tbody>
              <tr v-for="(row, index) in hover_info.tooltip" :key="index">
                <td class="font-medium">{{ row.label }}</td>
                <td>{{ row.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
  <!--Viewer controls-->
  <div class="flex flex-col gap-y-2 w-full">
    <fieldset class="fieldset">
      <legend for="selected" class="fieldset-legend">Data</legend>
      <select id="selected" class="select w-full" v-model="master_renderer.mode" @change="refresh()">
        <option :value="'v_field'">V-field</option>
        <option :value="'e_field'">E-field</option>
        <option :value="'v_force'">V-force</option>
        <option :value="'epsilon'">Epsilon</option>
      </select>
    </fieldset>
    <!--Epsilon/V-force-->
    <template v-if="selected_renderer.type === 'v_force' || selected_renderer.type === 'epsilon'">
      <fieldset class="fieldset">
        <legend for="mode" class="fieldset-legend">Mode</legend>
        <select id="mode" class="select w-full" v-model="selected_renderer.mode" @change="refresh()">
          <option :value="'index'">Index</option>
          <option :value="'beta'">Beta</option>
          <option :value="'signed_value'">Value</option>
          <option :value="'absolute_value'">|Value|</option>
        </select>
      </fieldset>
      <fieldset class="fieldset">
        <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
          <span>Scale</span>
          <span>{{ selected_renderer.scale.toFixed(1) }}</span>
        </legend>
        <input id="scale" class="range w-full" type="range" v-model.number="selected_renderer.scale" @input="refresh()" min="0" max="5" step="0.1"/>
      </fieldset>
    </template>
    <!--V-field-->
    <template v-if="selected_renderer.type === 'v_field'">
      <fieldset class="fieldset">
        <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
          <span>Scale</span>
          <span>{{ selected_renderer.scale.toFixed(1) }}</span>
        </legend>
        <input id="scale" class="range w-full" type="range" v-model.number="selected_renderer.scale" @input="refresh()" min="0" max="5" step="0.1"/>
      </fieldset>
    </template>
    <!--E-field-->
    <template v-if="selected_renderer.type === 'e_field'">
      <fieldset class="fieldset">
        <legend for="mode" class="fieldset-legend">Mode</legend>
        <select id="mode" class="select w-full" v-model="selected_renderer.mode" @change="refresh()">
          <option :value="'x'">Ex</option>
          <option :value="'y'">Ey</option>
          <option :value="'mag'">|E|</option>
          <option :value="'vec'">HSV</option>
          <option :value="'quiver'">Quiver</option>
        </select>
      </fieldset>
      <fieldset class="fieldset">
        <legend for="scale" class="fieldset-legend w-full flex flex-row justify-between">
          <span>Scale</span>
          <span>{{ selected_renderer.scale.toFixed(1) }}</span>
        </legend>
        <input id="scale" class="range w-full" type="range" v-model.number="selected_renderer.scale" @input="refresh()" min="0" max="10" step="0.1"/>
      </fieldset>
      <fieldset class="fieldset" v-if="selected_renderer.mode == 'quiver'">
        <legend for="quiver_size" class="fieldset-legend w-full flex flex-row justify-between">
          <span>Quiver Size</span>
          <span>{{ selected_renderer.quiver_size.toFixed(0) }}</span>
        </legend>
        <input id="quiver_size" class="range w-full" type="range" v-model.number="selected_renderer.quiver_size" @input="refresh()" min="10" max="100" step="1"/>
      </fieldset>
    </template>
  </div>
</div>
</template>

<style scoped>
canvas.grid-view {
  image-rendering: auto;
  display: block;
  scale: 100% -100%;
}
</style>
