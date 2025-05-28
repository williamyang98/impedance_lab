<script setup lang="ts">
import { type SizeParameter } from "./stackup.ts";
import EditorControls from "./EditorControls.vue";
import { create_layout_from_stackup } from "./layout.ts";
import { type StackupGrid, get_stackup_grid_from_stackup_layout } from "./grid.ts";
import { computed, ref, useId, useTemplateRef } from "vue";
import ParameterForm from "./ParameterForm.vue";
import { Viewer2D } from "../../components/viewer_2d";
import { type RunResult, type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import ImpedanceResultTable from "./ImpedanceResultTable.vue";
import RunResultTable from "./RunResultTable.vue";
import GridRegionTable from "./GridRegionTable.vue";
import MeshViewer from "./MeshViewer.vue";
import {
  // CoplanarDifferentialPairEditor,
  // DifferentialPairEditor,
  CoplanarSingleEndedEditor,
  // SingleEndedEditor, // this is shagged because of layout starting with spacings not traces
} from "./stackup_templates.ts";

const editor = ref(new CoplanarSingleEndedEditor());
const grid_stackup = computed(() => editor.value.get_simulation_stackup());

const viewer_2d = useTemplateRef<typeof Viewer2D>("viewer_2d");
const uid = {
  tab_global: useId(),
  tab_result: useId(),
  tab_region_grid: useId(),
  tab_simulation: useId(),
};
const energy_threshold = ref<number>(-3);
const is_running = ref<boolean>(false);
const stackup_grid = ref<StackupGrid | undefined>(undefined);
const run_result = ref<RunResult | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);

async function update_region_grid() {
  const get_size = (param: SizeParameter): number => {
    const size = param.value;
    if (size === undefined) {
      param.error = "Field is required";
      throw Error(`Missing field value for ${param.name}`);
    }
    if (typeof(size) !== 'number') {
      param.error = "Field is requried";
      throw Error(`Non number field value for ${param.name}`);
    }
    if (Number.isNaN(size)) {
      param.error = "Field is requried";
      throw Error(`NaN field value for ${param.name}`);
    }
    if (param.min !== undefined && size < param.min) {
      param.error = `Value must be greater than ${param.min}`;
      throw Error(`Violated minimum value for ${param.name}`);
    }
    if (param.max !== undefined && size > param.max) {
      param.error = `Value must be less than ${param.max}`;
      throw Error(`Violated maximum value for ${param.name}`);
    }
    param.error = undefined;
    return size;
  };
  try {
    const layout = create_layout_from_stackup(grid_stackup.value, get_size);
    const grid = get_stackup_grid_from_stackup_layout(layout);
    stackup_grid.value = grid;
    await reset();
  } catch (error) {
    console.error(error);
  }
}

async function refresh_viewer() {
  if (viewer_2d.value === null) return;
  if (stackup_grid.value === undefined) return;
  const viewer = viewer_2d.value;
  const grid = stackup_grid.value.region_grid.grid;
  if (grid === undefined) return;
  viewer.upload_grid(grid);
  await viewer.refresh_canvas();
}

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

async function reset() {
  await run(true);
}

async function run(reset?: boolean) {
  reset = (reset === undefined) ? false : reset;
  const grid = stackup_grid.value?.region_grid?.grid;
  if (grid === undefined) return;

  if (reset) {
    grid.reset();
  }

  is_running.value = true;
  await sleep(0);

  const threshold = Math.pow(10, energy_threshold.value);
  run_result.value = grid.run(threshold);
  impedance_result.value = grid.calculate_impedance();
  is_running.value = false;
  await refresh_viewer();
}

</script>

<template>
<div class="tabs tabs-lift">
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Impedance" checked/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div class="grid grid-cols-7 gap-x-2">
      <div class="w-full card card-border bg-base-100 col-span-3">
        <div class="card-body">
          <h2 class="card-title">Stackup</h2>
          <EditorControls :editor="editor"></EditorControls>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Parameters</h2>
          <ParameterForm :stackup="grid_stackup"></ParameterForm>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Impedance</h2>
          <div class="h-full">
            <template v-if="impedance_result">
              <ImpedanceResultTable :result="impedance_result"></ImpedanceResultTable>
            </template>
            <template v-else>
              <div class="w-full h-full flex justify-center items-center">
                <h1 class="text-xl">Simulation has not run yet</h1>
              </div>
            </template>
          </div>
          <div class="card-actions justify-end">
            <button class="btn" @click="update_region_grid()">Calculate</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Grid"/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div v-if="stackup_grid" class="grid grid-cols-2 gap-x-2">
      <div class="w-full card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">Mesh</h2>
          <MeshViewer :region_grid="stackup_grid.region_grid"></MeshViewer>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">Grid</h2>
          <div>
            <div class="tabs tabs-lift">
              <input type="radio" :name="uid.tab_region_grid" class="tab" aria-label="X" checked/>
              <div class="tab-content bg-base-100 border-base-300 max-h-[25rem] overflow-scroll">
                <GridRegionTable :grid_regions="stackup_grid.region_grid.x_grid_regions"></GridRegionTable>
              </div>
              <input type="radio" :name="uid.tab_region_grid" class="tab" aria-label="Y"/>
              <div class="tab-content bg-base-100 border-base-300 max-h-[25rem] overflow-scroll">
                <GridRegionTable :grid_regions="stackup_grid.region_grid.y_grid_regions"></GridRegionTable>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-center">
      <h1 class="text-2xl">Simulation grid not created yet</h1>
    </div>
  </div>
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Simulation"/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div class="grid grid-cols-7 gap-x-2">
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Simulation</h2>
          <template v-if="run_result">
            <RunResultTable :result="run_result"></RunResultTable>
          </template>
          <template v-else>
            <div class="text-center">
              <h1 class="text-2xl">Simulation has not run yet</h1>
            </div>
          </template>
          <div class="card-actions justify-end">
            <div class="mt-1">
              <form class="grid grid-cols-[8rem_auto] gap-y-1 gap-x-1">
                <label for="threshold">Settling threshold</label>
                <input id="threshold" type="number" v-model.number="energy_threshold" min="-5" max="-1" step="0.1"/>
              </form>
              <div class="flex justify-end gap-x-2 mt-3">
                <button class="btn" @click="reset()" variant="outline">Reset</button>
                <button class="btn" @click="run()">Run</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-5">
        <div class="card-body">
          <h2 class="card-title">Viewer</h2>
          <div class="max-h-full">
            <Viewer2D ref="viewer_2d"></Viewer2D>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

</template>

<style scoped>
</style>
