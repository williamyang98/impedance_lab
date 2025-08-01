<script lang="ts" setup>
import { ref, toRaw, computed } from "vue";
import GridViewer from '../../app/electrostatic_2d/GridViewer.vue';
import TabsView from '../../utility/TabsView.vue';
import GridBuilderView from '../../app/electrostatic_2d/GridBuilderView.vue';
import ProfilerFlameChart from '../../utility/ProfilerFlameChart.vue';
import ExportView from '../stackup_2d/ExportView.vue';
import GridBuilderConfigForm from "../../app/electrostatic_2d/GridBuilderConfigForm.vue";
import VisualiserView from "../visualiser_2d/VisualiserView.vue";
import LayersEditorView from "./LayersEditorView.vue";
import ImpedanceResultView from "./ImpedanceResultView.vue";
import { PencilIcon, EyeIcon, SettingsIcon } from "lucide-vue-next";
import ParameterSearchResultsGraph from "../parameter_search/ParameterSearchResultsGraph.vue";
import ParameterSearchConfigForm from "../parameter_search/ParameterSearchConfigForm.vue";

import { providers } from "../../providers/providers.ts";
import { Profiler } from '../../utility/profiler.ts';
import { calculate_via_impedance, type ImpedanceResult } from './impedance.ts';
import { StackupGrid } from './stackup_to_grid.ts';
import { StackupVisualiser } from "./stackup_to_visualiser.ts";
import { Stackup, type Parameter } from "./stackup.ts";
import ParameterForm from "./ParameterForm.vue";
import { computed_ref } from "../../utility/computed_ref.ts";
import { type SearchResults, search_parameters } from "./search.ts";

const user_data = providers.user_data;

const stackup_grid = ref<StackupGrid | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);
const profiler = ref<Profiler | undefined>(undefined);
const grid = computed(() => stackup_grid.value?.grid);
const is_running = ref<boolean>(false);
const is_editing = ref<boolean>(true);

const wasm_module = toRaw(providers.wasm_module.value);
const toast = providers.toast_manager.value;

function create_stackup(): Stackup {
  const stackup = new Stackup();
  const L0 = stackup.create_surface_layer();
  const L1 = stackup.create_inner_layer();
  const L2 = stackup.create_inner_layer();
  const L3 = stackup.create_surface_layer();
  stackup.layers.push(L0, L1, L2, L3);
  stackup.regenerate_id_to_index();

  L0.plane.has_pad = true;
  L3.plane.has_pad = true;
  L1.planes.bottom.has_pad = true;
  L1.planes.bottom.has_plane = true;
  return stackup;
}

const stackup = ref(create_stackup());
const stackup_visualiser = computed_ref(() => new StackupVisualiser(stackup.value, is_editing.value));

function mark_parameter_valid(param: Parameter) {
  switch (param.type) {
    case "size": {
      param.old_unit = param.unit;
    }
    // @fallthrough
    case "epsilon":
    case "etch_factor": {
      param.old_value = param.value;
      break;
    }
  }
}

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

async function calculate_impedance() {
  if (is_running.value) return;
  is_running.value = true;
  await sleep(0);

  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = undefined;

  try {
    const new_profiler = new Profiler();
    new_profiler.begin("build_grid");
    const new_stackup_grid = new StackupGrid(
      wasm_module,
      stackup.value, user_data.value.grid_builder_config,
      new_profiler,
    );
    new_profiler.end();

    const grid = new_stackup_grid.grid;
    new_profiler.begin("calculate_impedance", undefined, {
      "Width": grid.width.toString(),
      "Height": grid.height.toString(),
      "Total": `${grid.width*grid.height}`,
    });
    const new_result = calculate_via_impedance(new_stackup_grid, new_profiler);
    new_profiler.end();

    new_profiler.end_all();

    for (const param of new_stackup_grid.parameter_cache.keys()) {
      mark_parameter_valid(param);
    }
    stackup_grid.value = new_stackup_grid;
    impedance_result.value = new_result;
    profiler.value = new_profiler;
  } catch (error) {
    toast.error(`Run failed with: ${String(error)}`);
  }
  is_running.value = false;
}

const target_impedance = ref<number>(50.0);
const search_results = ref<SearchResults | undefined>(undefined);

async function perform_search(search_params: Parameter[]) {
  if (is_running.value) return;
  is_running.value = true;
  await sleep(0);

  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = undefined;

  let new_search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    new_search_results = search_parameters(
      wasm_module,
      target_impedance.value,
      stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      user_data.value.grid_builder_config,
      user_data.value.parameter_search_config,
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
  impedance_result.value = best_result?.impedance;
  profiler.value = new_profiler;
  if (best_result !== undefined) {
    // set form field to best fit parameter values
    for (const param of search_params) {
      param.value = best_result.value;
    }
  }
  if (best_stackup_grid !== undefined) {
    for (const param of best_stackup_grid.parameter_cache.keys()) {
      mark_parameter_valid(param);
    }
  }
  is_running.value = false;
}

</script>

<template>
<TabsView :initial_tab="'0'">
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
          <div class="h-fit w-full flex flex-col gap-y-1">
            <LayersEditorView :stackup="stackup" v-if="is_editing"/>
            <VisualiserView :visualiser="stackup_visualiser" class="bg-white p-1 rounded-xs"/>
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
            @submit="calculate_impedance()"
            @search="perform_search"
          />
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
                <GridBuilderConfigForm :config="user_data.grid_builder_config"/>
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
          <ImpedanceResultView :result="impedance_result" v-if="impedance_result"/>
          <div v-else class="w-full my-2 text-center text-xl">
            Run simulation for results
          </div>
          <button class="btn w-full" @click="calculate_impedance()" :disabled="is_running">Run</button>
        </div>
      </div>
    </div>
  </template>
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
          y: result.impedance.Z0,
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
  <template #h-2>Viewer</template>
  <template #b-2>
    <div class="w-full h-full" v-if="grid">
      <GridViewer :grid="grid"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-3>Mesh</template>
  <template #b-3>
    <div class="w-full h-full" v-if="stackup_grid?.grid_builder">
      <GridBuilderView :builder="stackup_grid.grid_builder"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-4>Profiler</template>
  <template #b-4>
    <div class="w-full h-full" v-if="profiler">
      <ProfilerFlameChart :profiler="profiler"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-5>Export</template>
  <template #b-5>
    <!--NOTE: justify-center-safe is required since flex centering with overflow is broken (https://stackoverflow.com/a/78181725)-->
    <div v-if="grid" class="w-full flex justify-center-safe overflow-x-auto">
      <ExportView :grid="grid" class="w-fit border border-base-300 bg-base-100"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
</TabsView>
</template>
