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
import { validate_parameter, type Parameter } from "./stackup.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { StackupGrid } from "./grid.ts";
import {
  StackupEditor,
  StackupParameters,
  BroadsideStackupEditor,
  type BroadsideTraceTemplate,
  ColinearStackupEditor,
  type ColinearTraceTemplate,
} from "./editor.ts";
import {
  // BroadsideLayerMicrostrip,
  BroadsideLayerStripline,
  BroadsideTracePair,
  BroadsideTraceCoplanarPair,
  BroadsideTraceMirroredPair,
  BroadsideTraceCoplanarMirroredPair,
  // ColinearLayerMicrostrip,
  ColinearLayerStripline,
  ColinearTraceSingleEnded,
  ColinearTraceCoplanarSingleEnded,
  ColinearTraceDifferentialPair,
  ColinearTraceCoplanarDifferentialPair,
} from "./editor_templates.ts";
import { type SearchResults, search_parameters } from "./search.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { Ndarray } from "../../utility/ndarray.ts";

interface SelectedMap<K extends string, V> {
  selected: K;
  options: Record<K, V>;
  value: V;
  keys: K[];
}

function create_editor() {
  const parameters = new StackupParameters();

  function mark_parameter_changed(param: Parameter) {
    param.old_value = undefined;
    param.error = undefined;
  }

  const broadside_trace_templates = {
    "pair": new BroadsideTracePair(),
    "coplanar_pair": new BroadsideTraceCoplanarPair(),
    "mirrored_pair": new BroadsideTraceMirroredPair(),
    "coplanar_mirrored_pair": new BroadsideTraceCoplanarMirroredPair(),
  };

  type K0 = keyof typeof broadside_trace_templates;
  class BroadsideEditor implements SelectedMap<K0, BroadsideTraceTemplate> {
    _selected: K0 = "pair";
    options = broadside_trace_templates;
    keys = Object.keys(broadside_trace_templates) as K0[];
    editor = new BroadsideStackupEditor(
      parameters,
      broadside_trace_templates[this._selected],
      new BroadsideLayerStripline(),
    );
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.editor.set_trace_template(this.value);
      this.editor.parameters.map(mark_parameter_changed);
    }
    get value() {
      return this.options[this.selected];
    }
  }
  const broadside_editor = new BroadsideEditor();

  const colinear_trace_templates = {
    "single": new ColinearTraceSingleEnded(),
    "coplanar_single": new ColinearTraceCoplanarSingleEnded(),
    "pair": new ColinearTraceDifferentialPair(),
    "coplanar_pair": new ColinearTraceCoplanarDifferentialPair(),
  };

  type K1 = keyof typeof colinear_trace_templates;
  class ColinearEditor implements SelectedMap<K1, ColinearTraceTemplate> {
    _selected: K1 = "single";
    options = colinear_trace_templates;
    keys = Object.keys(colinear_trace_templates) as K1[];
    editor = new ColinearStackupEditor(
      parameters,
      colinear_trace_templates[this._selected],
      new ColinearLayerStripline(),
    );
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.editor.set_trace_template(this.value);
      this.editor.parameters.map(mark_parameter_changed);
    }
    get value() {
      return this.options[this.selected];
    }
  }
  const colinear_editor = new ColinearEditor();

  const editors = {
    broadside: broadside_editor,
    colinear: colinear_editor,
  };

  type K2 = keyof typeof editors;
  type V2 = typeof editors[K2];
  class Editor implements SelectedMap<K2, V2> {
    _selected: K2 = "colinear";
    options = editors;
    keys = Object.keys(editors) as K2[];
    parameters: StackupParameters = parameters;
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.parameters.map(mark_parameter_changed);
    }
    get value() {
      return this.options[this.selected];
    }
  }
  const editor = new Editor();
  return editor;
}

const selected_editor = ref(create_editor());

const editor = computed<StackupEditor>(() => selected_editor.value.value.editor);
const selected_trace_template = computed(() => selected_editor.value.value);

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
    const used_parameters = new Set<Parameter>();
    function get_parameter(param: Parameter): number {
      validate_parameter(param);
      used_parameters.add(param);
      return param.value!;
    }

    new_profiler.begin("create_layout", "Create layout from transmission line stackup");
    const layout = create_layout_from_stackup(simulation_stackup.value, get_parameter, new_profiler);
    new_profiler.end();

    new_profiler.begin("create_grid", "Create simulation grid from layout");
    new_stackup = new StackupGrid(layout, get_parameter, new_profiler);
    new_profiler.end();

    new_profiler.begin("run", "Perform impedance measurements", {
      "Total Columns": `${new_stackup.grid.width}`,
      "Total Rows": `${new_stackup.grid.height}`,
      "Total Cells": `${new_stackup.grid.width*new_stackup.grid.height}`,
    });
    new_measurement = perform_measurement(new_stackup, new_profiler);
    new_profiler.end();

    for (const param of used_parameters) {
      param.old_value = param.value;
    }
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

const target_impedance = ref<number>(50.0);
async function perform_search(search_params: Parameter[]) {
  is_running.value = true;
  await sleep(0);

  const used_parameters = new Set<Parameter>();
  function get_parameter(param: Parameter): number {
    validate_parameter(param);
    used_parameters.add(param);
    return param.value!;
  }

  let search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    search_results = search_parameters(
      target_impedance.value,
      simulation_stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      get_parameter,
      new_profiler,
    );
    new_profiler.end();
  } catch (error) {
    console.log("perform_search() failed with: ", error);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }

  const best_result = search_results?.best_result;
  stackup_grid.value = best_result?.stackup_grid;
  measurement.value = best_result?.measurement;
  profiler.value = new_profiler;
  if (best_result) {
    for (const param of search_params) {
      param.value = best_result.value;
    }
    for (const param of used_parameters) {
      param.old_value = param.value;
    }
  }
  console.log(search_results);
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
                  <select v-model="selected_editor.selected">
                    <option v-for="option in selected_editor.keys" :value="option" :key="option">
                      {{ option }}
                    </option>
                  </select>
                  <select v-model="selected_trace_template.selected">
                    <option v-for="option in selected_trace_template.keys" :value="option" :key="option">
                      {{ option }}
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
          <ParameterForm :stackup="simulation_stackup" @search="perform_search"></ParameterForm>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100 col-span-2">
        <div class="card-body">
          <h2 class="card-title">Impedance</h2>
          <div class="h-full">
            <div class="w-full flex flex-row">
              <label class="label mr-1">Z0 target </label>
              <input class="input input-sm w-full" type="number" step="any" v-model.number="target_impedance" min="0"/>
            </div>
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
      <h1 class="text-2xl">Calculation has not been run yet</h1>
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
            <h1 class="text-2xl">Calculation has not been run yet</h1>
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
