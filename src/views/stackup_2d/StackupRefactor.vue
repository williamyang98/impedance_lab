<script setup lang="ts">
import {
  computed, ref, useId, useTemplateRef,
  // NOTE: we need use toRaw(...) to unwrap the proxy on wasm module objects
  //       otherwise emscripten will panic on upcastCheck() use to upcast/downcast virtual pointers
  //       this is because it performs a comparison between the entity's "class" descriptor
  //       and since a comparison between a proxy and the original object is false this breaks this check
  toRaw,
} from "vue";
// subcomponents
import EditorControls from "./EditorControls.vue";
import StackupViewer from "./StackupViewer.vue";
import GridRegionTable from "./GridRegionTable.vue";
import MeshViewer from "./MeshViewer.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterForm from "./ParameterForm.vue";
import { Viewer2D } from "../../components/viewer_2d/index.ts";
import ProfilerFlameChart from "../../components/ProfilerFlameChart.vue";
// ts imports
import { validate_parameter } from "./stackup.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { StackupGrid } from "./grid.ts";
import {
  type VerticalStackupEditor,
  CoplanarDifferentialPairEditor,
  DifferentialPairEditor,
  CoplanarSingleEndedEditor,
  SingleEndedEditor,
  BroadsideCoplanarPairEditor,
  BroadsidePairEditor,
  BroadsideMirroredPairEditor,
  BroadsideMirroredCoplanarPairEditor,
} from "./stackup_templates.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { Ndarray } from "../../utility/ndarray.ts";

class Editors {
  coplanar_diff = new CoplanarDifferentialPairEditor();
  diff = new DifferentialPairEditor();
  coplanar_single = new CoplanarSingleEndedEditor();
  single = new SingleEndedEditor();
  broadside_diff = new BroadsidePairEditor();
  broadside_coplanar_diff = new BroadsideCoplanarPairEditor();
  broadside_mirrored_diff = new BroadsideMirroredPairEditor();
  broadside_mirrored_coplanar_diff = new BroadsideMirroredCoplanarPairEditor();
}
type EditorKey = keyof Editors;
const editor_keys: EditorKey[] = [
  "coplanar_diff",
  "diff",
  "coplanar_single",
  "single",
  "broadside_diff",
  "broadside_coplanar_diff",
  "broadside_mirrored_diff",
  "broadside_mirrored_coplanar_diff",
];

function editor_key_to_name(key: EditorKey): string {
  switch (key) {
    case "coplanar_diff": return "Coplanar Diffpair";
    case "diff": return "Diffpair";
    case "coplanar_single": return "Coplanar Single Ended";
    case "single": return "Single Ended";
    case "broadside_diff": return "Broadside Pair";
    case "broadside_coplanar_diff": return "Broadside Coplanar Pair";
    case "broadside_mirrored_diff": return "Broadside Mirrored Pair";
    case "broadside_mirrored_coplanar_diff": return "Broadside Mirrored Coplanar Pair";
  }
}

const editors = ref(new Editors());

const selected_editor = ref<EditorKey>("coplanar_diff");
const editor = computed<VerticalStackupEditor>(() => {
  return editors.value[selected_editor.value];
});

const simulation_stackup = computed(() => editor.value.get_simulation_stackup());
const is_viewer_hover = ref<boolean>(false);
const viewer_stackup = computed(() => {
  if (is_viewer_hover.value) {
    return editor.value.get_viewer_stackup();
  } else {
    return editor.value.get_simulation_stackup();
  }
});

const viewer_2d = useTemplateRef<typeof Viewer2D>("viewer_2d");
const uid = {
  tab_global: useId(),
  tab_result: useId(),
  tab_region_grid: useId(),
  tab_simulation: useId(),
};
const is_running = ref<boolean>(false);
const stackup_grid = ref<StackupGrid | undefined>(undefined);

const measurement = ref<Measurement | undefined>(undefined);
const profiler = ref<Profiler | undefined>(undefined);

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

function rebuild_stackup(profiler: Profiler): StackupGrid {
  profiler.begin("rebuild_stackup");

  profiler.begin("create_layout", "Create layout from transmission line stackup");
  const layout = create_layout_from_stackup(simulation_stackup.value, validate_parameter, profiler);
  profiler.end();

  profiler.begin("create_grid", "Create simulation grid from layout");
  const stackup = new StackupGrid(layout, profiler);
  profiler.end();

  profiler.end();
  return stackup;
}

function run_simulation(stackup: StackupGrid, profiler: Profiler): Measurement {
  profiler.begin("run");
  const measurement = perform_measurement(stackup, profiler);
  profiler.end();
  return measurement;
}

async function refresh_viewer() {
  if (viewer_2d.value === null) return;
  if (stackup_grid.value === undefined) return;
  const viewer = viewer_2d.value;
  const grid = toRaw(stackup_grid.value.grid);
  if (grid === undefined) return;
  viewer.upload_grid(grid);
  await viewer.refresh_canvas();
}

async function calculate_impedance() {
  is_running.value = true;
  await sleep(0); // required so ui changes are reflected when is_running = True

  const new_profiler = new Profiler("calculate_impedance");
  let new_stackup = undefined;
  let new_measurement = undefined;
  try {
    new_stackup = rebuild_stackup(new_profiler);
    new_measurement = run_simulation(new_stackup, new_profiler);
    new_profiler.end();
  } catch (error) {
    console.error("calculate_impedance() failed with: ", error);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }
  stackup_grid.value = new_stackup;
  measurement.value = new_measurement;
  profiler.value = new_profiler;
  is_running.value = false;

  await refresh_viewer();
}

interface DownloadLink {
  name: string;
  data: Ndarray;
}

const download_links = computed<DownloadLink[] | undefined>(() => {
  const grid = toRaw(stackup_grid.value?.grid);
  if (grid === undefined) return undefined;
  return [
    { name: "ex_field.npy", data: grid.ex_field.ndarray },
    { name: "ey_field.npy", data: grid.ey_field.ndarray },
    { name: "v_field.npy", data: grid.v_field.ndarray },
    { name: "dx.npy", data: grid.dx.ndarray },
    { name: "dy.npy", data: grid.dy.ndarray },
    { name: "ek_table.npy", data: grid.ek_table.ndarray },
    { name: "ek_index_beta.npy", data: grid.ek_index_beta.ndarray },
    { name: "v_table.npy", data: grid.v_table.ndarray },
    { name: "v_index_beta.npy", data: grid.v_index_beta.ndarray },
  ]
});

function download_ndarray(link: DownloadLink) {
  const bytecode = link.data.export_as_numpy_bytecode();
  const blob = new Blob([bytecode], { type: "application/octet-stream" });
  const elem = document.createElement("a");
  elem.href = window.URL.createObjectURL(blob);
  elem.download = link.name;
  elem.click();
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
          <div class="bg-base-100 border-base-300 border-sm border-1">
            <div class="flex flex-row gap-x-2">
              <div class="min-w-[18rem]">
                <div class="mb-2 w-full flex flex-row">
                  <div><b>Layout: </b></div>
                  <select v-model="selected_editor">
                    <option v-for="option in editor_keys" :value="option" :key="option">
                      {{ editor_key_to_name(option) }}
                    </option>
                  </select>
                </div>
                <EditorControls :editor="editor"></EditorControls>
              </div>
              <div
                class="w-full h-full"
                @mouseenter="is_viewer_hover = true" @mouseleave="is_viewer_hover = false">
                <StackupViewer :stackup="viewer_stackup"/>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Parameters</h2>
          <ParameterForm :stackup="simulation_stackup"></ParameterForm>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Impedance</h2>
          <div class="h-full">
            <template v-if="measurement">
              <MeasurementTable :measurement="measurement"></MeasurementTable>
            </template>
            <template v-else>
              <div class="w-full h-full flex justify-center items-center">
                <h1 class="text-xl">No results to display</h1>
              </div>
            </template>
          </div>
          <div class="card-actions justify-end">
            <button class="btn" @click="calculate_impedance()" :disabled="is_running">Calculate</button>
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
          <MeshViewer :stackup_grid="stackup_grid"></MeshViewer>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">Grid</h2>
          <div>
            <div class="tabs tabs-lift">
              <input type="radio" :name="uid.tab_region_grid" class="tab" aria-label="X" checked/>
              <div class="tab-content bg-base-100 border-base-300 max-h-[25rem] overflow-scroll">
                <GridRegionTable :region_to_grid_map="stackup_grid.x_region_to_grid_map"></GridRegionTable>
              </div>
              <input type="radio" :name="uid.tab_region_grid" class="tab" aria-label="Y"/>
              <div class="tab-content bg-base-100 border-base-300 max-h-[25rem] overflow-scroll">
                <GridRegionTable :region_to_grid_map="stackup_grid.y_region_to_grid_map"></GridRegionTable>
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
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Viewer"/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div class="w-full card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">Viewer</h2>
        <div class="max-h-full">
          <Viewer2D ref="viewer_2d"></Viewer2D>
        </div>
      </div>
    </div>
  </div>
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Profiler"/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div class="w-full card card-border bg-base-100">
      <div class="card-body">
        <h2 class="card-title">Profiler</h2>
        <template v-if="profiler">
          <div class="w-full">
            <ProfilerFlameChart :profiler="profiler"></ProfilerFlameChart>
          </div>
        </template>
        <template v-else>
          <div class="text-center">
            <h1 class="text-2xl">Simulation has not run yet</h1>
          </div>
        </template>
        <div class="card-actions justify-end">
          <div class="mt-1">
            <div class="flex justify-end gap-x-2 mt-3">
              <button class="btn" @click="calculate_impedance()" :disabled="is_running">Calculate</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Export"/>
  <div class="tab-content bg-base-100 border-base-300 p-1">
    <div class="grid grid-cols-1 gap-x-2">
      <div class="w-full card card-border bg-base-100">
        <div class="card-body">
          <h2 class="card-title">Export</h2>
          <template v-if="download_links">
            <table class="table table-sm w-fit">
              <tbody>
                <tr v-for="(link, index) in download_links" :key="index">
                  <td>{{ link.name }}</td>
                  <td><button class="btn btn-sm" @click="download_ndarray(link)">Download</button></td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </div>
    </div>
  </div>
</div>

</template>

<style scoped>
</style>
