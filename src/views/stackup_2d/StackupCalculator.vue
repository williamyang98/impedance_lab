<script setup lang="ts">
import {
  computed, ref,
  // NOTE: we need use toRaw(...) to unwrap the proxy on wasm module objects
  //       otherwise emscripten will panic on upcastCheck() use to upcast/downcast virtual pointers
  //       this is because it performs a comparison between the entity's "class" descriptor
  //       and since a comparison between a proxy and the original object is false this breaks this check
  //       this also applied to .delete() calls which register/unregister from a weakmap. proxy breaks the key check.
  toRaw,
  watch,
} from "vue";
import { useRoute, type LocationQuery } from "vue-router";
// subcomponents
import LayersEditorView from "./LayersEditorView.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterForm from "./ParameterForm.vue";
import GridViewer from "../../app/electrostatic_2d/GridViewer.vue";
import GridBuilderView from "../../app/electrostatic_2d/GridBuilderView.vue";
import ProfilerFlameChart from "../../utility/ProfilerFlameChart.vue";
import ExportView from "../../app/electrostatic_2d/ExportView.vue";
import TabsView from "../../utility/TabsView.vue";
import GridBuilderConfigForm from "../../app/electrostatic_2d/GridBuilderConfigForm.vue";
import VisualiserView from "../visualiser_2d/VisualiserView.vue";
import ParameterSearchResultsGraph from "../parameter_search/ParameterSearchResultsGraph.vue";
import ParameterSearchConfigForm from "../parameter_search/ParameterSearchConfigForm.vue";
import { PencilIcon, EyeIcon, SettingsIcon } from "@lucide/vue";
// ts imports
import {type Parameter, type StackupType, stackup_types } from "./stackup.ts";
import { StackupGrid } from "./stackup_to_grid.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { providers } from "../../providers/providers.ts";
import { StackupVisualiser } from "./stackup_to_visualiser.ts";
import { computed_ref } from "../../utility/computed_ref.ts";
import {
  create_broadside_stackup, create_colinear_stackup,
  type LayerTemplateType, layer_template_types,
} from "./stackup_templates.ts";
import { search_parameters, type SearchResults } from "./search.ts";

const toast = providers.toast_manager.value;
const user_data = providers.user_data.value;
const wasm_module = toRaw(providers.wasm_module.value);

// stackup
const is_editing = ref<boolean>(true);
const selected_stackup = ref<StackupType>("colinear");

function create_stackups(layer_template_type: LayerTemplateType) {
  return {
    colinear: create_colinear_stackup(layer_template_type),
    broadside: create_broadside_stackup(layer_template_type),
  };
}
const stackups = ref(create_stackups("microstrip"));
const stackup = computed(() => {
  return stackups.value[selected_stackup.value];
});

// read query parameters
function read_query_parameters(query: LocationQuery) {
  const get_query_param = (key: string) => {
    if (!(key in query)) return undefined;
    const value = query[key];
    if (typeof(value) !== "string") return undefined;
    return value;
  };
  const query_layer_type = get_query_param("layer");
  const query_stackup_type = get_query_param("stackup");
  const query_trace_type = get_query_param("trace");
  let was_queried = false;

  const layer_type = layer_template_types.find(elem => elem === query_layer_type);
  if (layer_type !== undefined) {
    stackups.value = create_stackups(layer_type);
    was_queried = true;
  } else if (query_layer_type !== undefined) {
    toast.error(`Bad query parameter layer='${query_layer_type}'`);
  }

  const stackup_type = stackup_types.find(elem => elem === query_stackup_type);
  if (stackup_type !== undefined) {
    selected_stackup.value = stackup_type;
    was_queried = true;
  } else if (query_stackup_type !== undefined) {
    toast.error(`Bad query parameter stackup='${query_stackup_type}'`);
  }

  const trace_type = Object.keys(stackup.value.layouts).find(elem => elem === query_trace_type);
  if (trace_type !== undefined) {
    (stackup.value.selected_layout as string) = trace_type;
    was_queried = true;
  } else if (query_trace_type !== undefined) {
    toast.error(`Bad query parameter trace='${query_trace_type}'`);
  }

  if (was_queried) {
    is_editing.value = false;
  }
}

const route = useRoute();
watch(() => route.query, (new_query) => {
  read_query_parameters(new_query);
}, { immediate: true });

// calculator controls and results
const is_running = ref<boolean>(false);
const stackup_grid = ref<StackupGrid | undefined>(undefined);
const measurement = ref<Measurement | undefined>(undefined);
const profiler = ref<Profiler | undefined>(undefined);

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

async function calculate_impedance() {
  if (is_running.value) return;

  is_running.value = true;
  await sleep(0); // required so ui changes are reflected when is_running = True

  // discard to minimise memory usage
  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = undefined;

  const new_profiler = new Profiler("calculate_impedance");
  let new_stackup = undefined;
  let new_measurement = undefined;
  try {
    new_profiler.begin("create_grid", "Create simulation grid from layout");
    new_stackup = new StackupGrid(
      wasm_module,
      stackup.value,
      toRaw(user_data.grid_builder_config_2d),
      new_profiler,
    );
    new_profiler.end();

    new_profiler.begin("run", "Perform impedance measurements", {
      "Total Columns": `${new_stackup.grid.width}`,
      "Total Rows": `${new_stackup.grid.height}`,
      "Total Cells": `${new_stackup.grid.width*new_stackup.grid.height}`,
    });
    new_measurement = perform_measurement(new_stackup, new_profiler);
    new_profiler.end();

    for (const param of new_stackup.parameter_cache.keys()) {
      param.mark_unchanged();
    }
    new_profiler.end();
  } catch (error) {
    toast.error(`calculate_impedance() failed with: ${String(error)}`);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }
  stackup_grid.value = new_stackup;
  measurement.value = new_measurement;
  profiler.value = new_profiler;
  is_running.value = false;
}

const target_impedance = ref<number>(50.0);
const search_results = ref<SearchResults | undefined>(undefined);

async function perform_search(search_params: Parameter[]) {
  if (is_running.value) return;

  is_running.value = true;
  await sleep(0);

  // discard to minimise memory usage
  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = undefined;

  let new_search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    new_search_results = await search_parameters(
      wasm_module,
      target_impedance.value,
      stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      user_data.grid_builder_config_2d,
      user_data.parameter_search_config,
      new_profiler, toast,
    );
    new_profiler.end();
  } catch (error) {
    toast.error(`perform_search() failed with: ${String(error)}`);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }

  search_results.value = new_search_results;
  const best_result = new_search_results?.best_result;
  const best_stackup_grid = new_search_results?.best_stackup_grid;
  stackup_grid.value = best_stackup_grid;
  measurement.value = best_result?.measurement;
  profiler.value = new_profiler;
  if (best_result !== undefined) {
    // set form field to best fit parameter values
    for (const param of search_params) {
      param.value = best_result.value;
    }
  }
  if (best_stackup_grid !== undefined) {
    for (const param of best_stackup_grid.parameter_cache.keys()) {
      param.mark_unchanged();
    }
  }
  is_running.value = false;
}

const visualiser = computed_ref(() => {
  return new StackupVisualiser(stackup.value, is_editing.value);
});

</script>

<template>
<TabsView>
  <!--Calculator tab-->
  <template #h-0>Calculator</template>
  <template #b-0>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-2">
      <div class="w-full card card-border bg-base-100">
        <div class="card-body p-3">
          <h2 class="card-title flex flex-row items-center justify-between gap-x-1 w-full">
            <span>Stackup</span>
            <button class="btn size-[2.0rem] p-1" @click="is_editing = !is_editing">
              <EyeIcon v-if="is_editing"/>
              <PencilIcon v-else/>
            </button>
          </h2>
          <div class="w-full flex flex-col gap-y-1">
            <div class="w-full flex flex-row gap-x-1">
              <select class="select w-full" v-model="selected_stackup" :disabled="!is_editing">
                <option v-for="option of Object.keys(stackups)" :value="option" :key="option">
                  {{ option }}
                </option>
              </select>
              <select class="select w-full" v-model="stackup.selected_layout" :disabled="!is_editing">
                <option v-for="option of Object.keys(stackup.layouts)" :value="option" :key="option">
                  {{ option }}
                </option>
              </select>
            </div>
            <div class="w-full border border-1 border-base-300 bg-base-100 p-1" v-if="is_editing">
              <LayersEditorView :stackup="stackup"/>
            </div>
            <div class="w-full max-w-[40rem] self-center border border-1 rounded-sm border-base-300 bg-white p-1">
              <!-- <StackupViewer :stackup="viewer_stackup"/> -->
               <VisualiserView :visualiser="visualiser"/>
            </div>
          </div>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body p-3">
          <h2 class="card-title flex flex-row items-center justify-between gap-x-1 w-full">
            <span>Parameters</span>
            <button class="btn size-[2.0rem] p-1" onclick="search_settings.showModal()">
              <SettingsIcon class="size-[1.2rem]"/>
            </button>
            <dialog id="search_settings" class="modal">
              <div class="modal-box">
                <form method="dialog">
                  <div class="text-lg font-bold p-0">Parameter Search Settings</div>
                  <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
                </form>
                <ParameterSearchConfigForm :config="user_data.parameter_search_config"/>
              </div>
              <form method="dialog" class="modal-backdrop">
                <button>Close</button>
              </form>
            </dialog>
          </h2>
          <ParameterForm
            :stackup="stackup"
            @search="perform_search"
            @submit="calculate_impedance"
          ></ParameterForm>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body p-3">
          <h2 class="card-title w-full flex flex-row justify-between">
            <span>Impedance</span>
            <button class="btn size-[2.0rem] p-1" onclick="mesh_settings.showModal()">
              <SettingsIcon class="size-[1.2rem]"/>
            </button>
            <dialog id="mesh_settings" class="modal">
              <div class="modal-box">
                <form method="dialog">
                  <div class="text-lg font-bold p-0">2D Mesh Settings</div>
                  <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
                </form>
                <GridBuilderConfigForm :config="user_data.grid_builder_config_2d"/>
              </div>
              <form method="dialog" class="modal-backdrop">
                <button>Close</button>
              </form>
            </dialog>
          </h2>
          <div class="w-full flex flex-row">
            <label class="label mr-2">Z0 target </label>
            <input class="input input w-full" type="number" step="any" v-model.number="target_impedance" min="0"/>
          </div>
          <MeasurementTable v-if="measurement" :measurement="measurement"/>
          <div v-else class="text-center text-xl py-2">
            No results to display
          </div>
          <div class="card-actions justify-end">
            <button class="btn" @click="calculate_impedance()" :disabled="is_running">Calculate</button>
          </div>
        </div>
      </div>
    </div>
  </template>
  <!--Parameter search tab-->
  <template #h-1>
    <div class="flex flex-row gap-x-2 items-center">
      <span class="text-nowrap">Parameter Search</span>
      <div v-if="search_results" class="badge badge-sm badge-secondary">{{ search_results.results.length }}</div>
    </div>
  </template>
  <template #b-1>
    <ParameterSearchResultsGraph
      v-if="search_results"
      :results="search_results.results.map(result => {
        return {
          x: result.value,
          y: result.impedance,
          error: result.error,
        };
      })"
      :selected_index="search_results.results.indexOf(search_results.best_result)"
      :x_label="search_results.parameter_label"
      :y_label="'Z0 (Ω)'"
      :title="`Search Curve (${search_results.parameter_label})`"
    />
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Perform parameter search to see search curve
    </div>
  </template>
  <!--Visualisation tab-->
  <template #h-2>Visualiser</template>
  <template #b-2>
    <GridViewer v-if="stackup_grid" :grid="stackup_grid.grid"/>
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Calculate impedance to see visualisation
    </div>
  </template>
  <!--Mesh tab-->
  <template #h-3>Mesh</template>
  <template #b-3>
    <GridBuilderView v-if="stackup_grid" :builder="stackup_grid.grid_builder"/>
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Calculate impedance to see mesh
    </div>
  </template>
  <!--Profiler tab-->
  <template #h-4>Profiler</template>
  <template #b-4>
    <ProfilerFlameChart v-if="profiler" :profiler="profiler"></ProfilerFlameChart>
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Calculate impedance to see execution profile
    </div>
  </template>
  <!--Data export tab-->
  <template #h-5>Export</template>
  <template #b-5>
    <!--NOTE: justify-center-safe is required since flex centering with overflow is broken (https://stackoverflow.com/a/78181725)-->
    <div v-if="stackup_grid" class="w-full flex justify-center-safe overflow-x-auto">
      <ExportView :grid="stackup_grid.grid" class="w-fit border border-base-300 bg-base-100"/>
    </div>
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Calculate impedance to export simulation data
    </div>
  </template>
</TabsView>
</template>

<style scoped>
button.edit-toggle {
  padding: 0.25rem;
  background: var(--color-base-200);
  color: var(--color-base-content);
}

button.edit-toggle:hover {
  background: var(--color-base-300);
}

button.edit-toggle svg {
  height: 1.25rem;
  width: 1.25rem;
}
</style>
