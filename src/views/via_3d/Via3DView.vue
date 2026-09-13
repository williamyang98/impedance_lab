<script lang="ts" setup>
import { toRaw, ref, useTemplateRef, watch, computed } from 'vue';
import { providers } from '../../providers/providers';
import ImpedanceResultView from './ImpedanceResultView.vue';
import ExportView from '../../app/electrostatic_3d/ExportView.vue';
import RendererView from '../../app/electrostatic_3d/RendererView.vue';
import TabsView from '../../components/TabsView.vue';
import { Profiler } from '../../utility/profiler.ts';
import { StackupGrid } from "./stackup_to_grid.ts";
import { Stackup } from "./stackup.ts";
import { type Parameter } from "../via_2d/stackup.ts";
import ProfilerFlameChart from '../../components/ProfilerFlameChart.vue';
import { Executor, type ExecutorControls, calculate_ideal_total_steps } from './executor.ts';
import { computed_ref } from '../../utility/computed_ref.ts';
import { StackupVisualiser } from '../via_2d/stackup_to_visualiser.ts';
import { search_parameters, type SearchResults } from './search.ts';
import { SettingsIcon, PencilIcon, EyeIcon } from '@lucide/vue';
import ParameterSearchConfigForm from '../../app/parameter_search/ParameterSearchConfigForm.vue';
import ParameterSearchResultsGraph from '../../app/parameter_search/ParameterSearchResultsGraph.vue';
import VisualiserView from "../../components/visualiser_2d/VisualiserView.vue";
import LayersEditorView from "../via_2d/LayersEditorView.vue";
import ParameterForm from "../via_2d/ParameterForm.vue";
import { type ImpedanceResult } from './impedance.ts';
import MeshViewer3D from '../../components/mesh_viewer/MeshViewer3D.vue';
import GridBuilderConfigForm from '../../app/electrostatic_3d/GridBuilderConfigForm.vue';

const gpu_device = toRaw(providers.gpu_device.value);
const toast = providers.toast_manager.value;
const user_data = providers.user_data;

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

const is_editing = ref<boolean>(true);
const stackup = ref(create_stackup());
const stackup_visualiser = computed_ref(() => new StackupVisualiser(stackup.value, is_editing.value));

const profiler = ref<Profiler | undefined>(undefined);

const is_running = ref<boolean>(false);
const stackup_grid = ref<StackupGrid | undefined>(undefined);
const mesh = computed(() => stackup_grid.value?.grid_builder.mesh_lines);
const executor_controls = ref<ExecutorControls>({
  total_steps: 2048,
  stride_size: 256,
});
const executor = new Executor(gpu_device, executor_controls.value);
const renderer_view = useTemplateRef<typeof RendererView>("renderer_view");

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

watch(renderer_view, (view) => {
  if (view === null) return;
  if (stackup_grid.value === undefined) return;
  view.copy_z = Math.round(stackup_grid.value.size.z/2);
});
watch(stackup_grid, (new_stackup_grid) => {
  if (new_stackup_grid === undefined) return;
  if (renderer_view.value === null) return;
  renderer_view.value.copy_z = Math.round(new_stackup_grid.size.z/2);
});

async function sleep(millis: number) {
  await new Promise(resolve => setTimeout(resolve, millis));
}

const impedance_result = ref<ImpedanceResult | undefined>(undefined);

async function iterate_solution() {
  if (stackup_grid.value === undefined) return;

  if (is_running.value) {
    return;
  }
  is_running.value = true;
  await sleep(0);

  try {
    const new_profiler = new Profiler();

    const grid_size = stackup_grid.value.size;
    new_profiler.begin("run", undefined, {
      "Grid Size": `[${grid_size.x},${grid_size.y},${grid_size.z}]`,
      "Total Cells": `${grid_size.x*grid_size.y*grid_size.z}`,
    });
    const new_impedance_result = await executor.run(stackup_grid.value, toast, new_profiler);
    new_profiler.end();

    new_profiler.end_all();

    renderer_view.value?.refresh();
    for (const param of stackup_grid.value.parameter_cache.keys()) {
      mark_parameter_valid(param);
    }
    profiler.value = new_profiler;
    impedance_result.value = new_impedance_result;
  } catch (error) {
    toast.error(`run failed with: ${String(error)}`);
  }
  is_running.value = false;
}

async function calculate_impedance() {
  if (is_running.value) {
    return;
  }
  is_running.value = true;
  await sleep(0);

  try {
    const new_profiler = new Profiler();

    new_profiler.begin("build_grid");
    const new_stackup_grid = new StackupGrid(
      gpu_device, stackup.value,
      user_data.value.grid_builder_config_3d,
      new_profiler,
    );
    new_profiler.end();

    const grid_size = new_stackup_grid.size;
    executor.controls.total_steps = calculate_ideal_total_steps(grid_size);

    new_profiler.begin("run", undefined, {
      "Grid Size": `[${grid_size.x},${grid_size.y},${grid_size.z}]`,
      "Total Cells": `${grid_size.x*grid_size.y*grid_size.z}`,
    });
    const new_impedance_result = await executor.run(new_stackup_grid, toast, new_profiler);
    new_profiler.end();

    new_profiler.end_all();

    renderer_view.value?.refresh();
    for (const param of new_stackup_grid.parameter_cache.keys()) {
      mark_parameter_valid(param);
    }

    stackup_grid.value = new_stackup_grid;
    profiler.value = new_profiler;
    impedance_result.value = new_impedance_result;
  } catch (error) {
    toast.error(`run failed with: ${String(error)}`);
  }
  is_running.value = false;
}

const target_impedance = ref<number>(50.0);
const search_results = ref<SearchResults | undefined>(undefined);

async function perform_search(search_params: Parameter[]) {
  if (is_running.value) return;
  is_running.value = true;
  await sleep(0);

  stackup_grid.value = undefined;

  let new_search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    new_search_results = await search_parameters(
      executor,
      target_impedance.value,
      stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      user_data.value.grid_builder_config_3d,
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
  renderer_view.value?.refresh();
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
    <div class="flex flex-col w-full h-full">
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
                    <div class="text-lg font-bold p-0">3D Mesh Settings</div>
                    <button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">✕</button>
                  </form>
                  <GridBuilderConfigForm :config="user_data.grid_builder_config_3d"/>
                </div>
                <form method="dialog" class="modal-backdrop">
                  <button>Close</button>
                </form>
              </dialog>
            </h2>
            <div class="w-full flex flex-col">
              <fieldset class="fieldset text-sm">
                <legend class="fieldset-legend">Z0 target</legend>
                <input class="input w-full" type="number" step="any" v-model.number="target_impedance" min="0"/>
              </fieldset>
              <fieldset class="fieldset text-sm">
                <legend class="fieldset-legend">Total steps</legend>
                <input class="input w-full" type="number" step="1" v-model.number="executor_controls.total_steps" min="1"/>
              </fieldset>
            </div>
            <div class="rounded-sm w-full h-[2.0rem] bg-slate-300 border-1 border-slate-300 border-sm">
              <template v-if="executor_controls.run_status !== undefined">
                <div
                  class="rounded-sm h-full bg-green-400 text-center"
                  :style="{ width: `${(executor_controls.run_status.curr_step/executor_controls.run_status.total_steps*100).toFixed(2)}%` }"
                >
                  <span class="align-middle px-2 font-medium">{{ executor_controls.run_status.curr_step }}/{{ executor_controls.run_status.total_steps }}</span>
                </div>
              </template>
            </div>
            <ImpedanceResultView :result="impedance_result" v-if="impedance_result"/>
            <div v-else class="w-full my-2 text-center text-xl">
              Run simulation for results
            </div>
            <div class="flex flex-row gap-x-2 justify-end">
              <button class="btn" @click="iterate_solution()" :disabled="is_running || stackup_grid === undefined">Refine</button>
              <button class="btn" @click="calculate_impedance()" :disabled="is_running">Calculate</button>
            </div>
          </div>
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
    <div class="w-full h-full" v-if="search_results">
      <ParameterSearchResultsGraph
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
    </div>
    <div v-else class="flex items-center justify-center w-full h-full text-xl text-center">
      Perform parameter search to see search curve
    </div>
  </template>
  <template #h-2>Viewer</template>
  <template #b-2>
    <div class="w-full h-full min-h-0">
      <RendererView v-if="stackup_grid" :grid="stackup_grid.gpu_grid" ref="renderer_view"/>
    </div>
  </template>
  <template #h-3>Mesh</template>
  <template #b-3>
    <div class="w-full h-full min-h-0">
      <MeshViewer3D v-if="mesh" :mesh="mesh"/>
    </div>
  </template>
  <template #h-4>Profiler</template>
  <template #b-4>
    <div class="w-full h-full">
      <ProfilerFlameChart v-if="profiler" :profiler="profiler"/>
    </div>
  </template>
  <template #h-5>Export</template>
  <template #b-5>
    <div class="w-full flex justify-center-safe overflow-x-auto">
      <ExportView v-if="stackup_grid" :grid="stackup_grid.cpu_grid" class="w-fit border border-base-300 bg-base-100"/>
    </div>
  </template>
</TabsView>
</template>
