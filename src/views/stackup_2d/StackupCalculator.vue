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
import EditorControls from "./EditorControls.vue";
import StackupViewer from "./StackupViewer.vue";
import MeshViewer from "./MeshViewer.vue";
import MeasurementTable from "./MeasurementTable.vue";
import ParameterForm from "./ParameterForm.vue";
import ParameterSearchResultsGraph from "./ParameterSearchResultsGraph.vue";
import GridViewer from "./GridViewer.vue";
import ProfilerFlameChart from "../../utility/ProfilerFlameChart.vue";
import ExportView from "./ExportView.vue";
import TabsView from "../../utility/TabsView.vue";
import MeshConfigForm from "./MeshConfigForm.vue";
import { PencilIcon, EyeIcon, InfoIcon, SettingsIcon } from "lucide-vue-next";
// ts imports
import {type Parameter } from "./stackup.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { StackupGrid } from "./grid.ts";
import { StackupParameters } from "./parameters.ts";
import {
  StackupEditor,
  BroadsideStackupEditor,
  type BroadsideTraceTemplate,
  ColinearStackupEditor,
  type ColinearTraceTemplate,
} from "./editor.ts";
import {
  broadside_layer_templates, broadside_trace_templates,
  colinear_layer_templates, colinear_trace_templates,
} from "./editor_templates.ts";
import { type SearchResults, search_parameters } from "./search.ts";
import { type Measurement, perform_measurement } from "./measurement.ts";
import { Profiler } from "../../utility/profiler.ts";
import { providers } from "../../providers/providers.ts";

const toast = providers.toast_manager.value;
const user_data = providers.user_data.value;

interface SelectedMap<K extends string, V> {
  selected: K;
  options: Record<K, V>;
  value: V;
  keys: K[];
}

const route = useRoute();

interface DefaultTemplateKeys {
  stackup_type: "colinear" | "broadside";
  colinear_trace: keyof typeof colinear_trace_templates;
  broadside_trace: keyof typeof broadside_trace_templates;
  colinear_layer: keyof typeof colinear_layer_templates;
  broadside_layer: keyof typeof broadside_layer_templates;
}

const default_template_keys: DefaultTemplateKeys = {
  stackup_type: "colinear",
  colinear_trace: "single ended",
  broadside_trace: "pair",
  colinear_layer: "microstrip",
  broadside_layer: "microstrip",
};

const is_editing = ref<boolean>(true);

// read query parameters
function read_query_parameters(query: LocationQuery) {
  const get_query_param = (key: string) => {
    if (!(key in query)) return undefined;
    const value = query[key];
    if (typeof(value) !== "string") return undefined;
    return value;
  };
  const stackup_type = get_query_param("type");
  const trace_template = get_query_param("trace");
  const layer_template = get_query_param("layer");
  if (stackup_type === "colinear") {
    default_template_keys.stackup_type = "colinear";
    if (trace_template) {
      if (trace_template in colinear_trace_templates) {
        default_template_keys.colinear_trace = trace_template as keyof typeof colinear_trace_templates;
      } else {
        toast.error(`Unknown colinear trace template: ${trace_template}`);
      }
    }
    if (layer_template) {
      if (layer_template in colinear_layer_templates) {
        default_template_keys.colinear_layer = layer_template as keyof typeof colinear_layer_templates;
      } else {
        toast.error(`Unknown colinear layer template: ${layer_template}`);
      }
    }
    is_editing.value = false;
  } else if (stackup_type === "broadside") {
    default_template_keys.stackup_type = "broadside";
    if (trace_template) {
      if (trace_template in broadside_trace_templates) {
        default_template_keys.broadside_trace = trace_template as keyof typeof broadside_trace_templates;
      } else {
        toast.error(`Unknown broadside trace template: ${trace_template}`);
      }
    }
    if (layer_template) {
      if (layer_template in broadside_layer_templates) {
        default_template_keys.broadside_layer = layer_template as keyof typeof broadside_layer_templates;
      } else {
        toast.error(`Unknown broadside layer template: ${layer_template}`);
      }
    }
    is_editing.value = false;
  } else if (stackup_type !== undefined) {
    toast.error(`Unknown stackup type: ${stackup_type}`);
  }
}
read_query_parameters(route.query);

function create_editor() {
  const parameters = new StackupParameters(user_data);

  type K0 = keyof typeof broadside_trace_templates;
  class BroadsideEditor implements SelectedMap<K0, BroadsideTraceTemplate> {
    _selected: K0 = default_template_keys.broadside_trace;
    options = broadside_trace_templates;
    keys = Object.keys(broadside_trace_templates) as K0[];
    editor = new BroadsideStackupEditor(
      parameters,
      broadside_trace_templates[this._selected],
      broadside_layer_templates[default_template_keys.broadside_layer],
    );
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.editor.set_trace_template(this.value);
      this.editor.parameters.for_each(param => parameters.mark_parameter_changed(param));
    }
    get value() {
      return this.options[this.selected];
    }
  }
  const broadside_editor = new BroadsideEditor();

  type K1 = keyof typeof colinear_trace_templates;
  class ColinearEditor implements SelectedMap<K1, ColinearTraceTemplate> {
    _selected: K1 = default_template_keys.colinear_trace;
    options = colinear_trace_templates;
    keys = Object.keys(colinear_trace_templates) as K1[];
    editor = new ColinearStackupEditor(
      parameters,
      colinear_trace_templates[this._selected],
      colinear_layer_templates[default_template_keys.colinear_layer],
    );
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.editor.set_trace_template(this.value);
      this.editor.parameters.for_each(param => parameters.mark_parameter_changed(param));
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
    _selected: K2 = default_template_keys.stackup_type;
    options = editors;
    keys = Object.keys(editors) as K2[];
    parameters: StackupParameters = parameters;
    get selected() {
      return this._selected;
    }
    set selected(selected) {
      this._selected = selected;
      this.parameters.for_each(param => parameters.mark_parameter_changed(param));
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
const viewer_stackup = computed(() => {
  if (is_editing.value) {
    return editor.value.get_viewer_stackup();
  } else {
    return editor.value.get_simulation_stackup();
  }
});

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

  const new_profiler = new Profiler("calculate_impedance");
  let new_stackup = undefined;
  let new_measurement = undefined;
  try {
    const used_parameters = new Set<Parameter>();
    function get_parameter(param: Parameter): number {
      const value = editor.value.parameters.get_simulation_parameter(param);
      used_parameters.add(param);
      return value;
    }

    new_profiler.begin("create_layout", "Create layout from transmission line stackup");
    const layout = create_layout_from_stackup(simulation_stackup.value, get_parameter, new_profiler);
    new_profiler.end();

    new_profiler.begin("create_grid", "Create simulation grid from layout");
    new_stackup = new StackupGrid(
      layout, get_parameter,
      new_profiler,
      toRaw(user_data.stackup_2d_mesh_config),
    );
    new_profiler.end();

    new_profiler.begin("run", "Perform impedance measurements", {
      "Total Columns": `${new_stackup.grid.width}`,
      "Total Rows": `${new_stackup.grid.height}`,
      "Total Cells": `${new_stackup.grid.width*new_stackup.grid.height}`,
    });
    new_measurement = perform_measurement(new_stackup, new_profiler);
    new_profiler.end();

    used_parameters.forEach(param => editor.value.parameters.mark_parameter_unchanged(param));
    new_profiler.end();
  } catch (error) {
    toast.error(`calculate_impedance() failed with: ${String(error)}`);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }
  toRaw(stackup_grid.value)?.delete();
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

  const used_parameters = new Set<Parameter>();
  function get_parameter(param: Parameter): number {
    const value = editor.value.parameters.get_simulation_parameter(param);
    used_parameters.add(param);
    return value;
  }

  let new_search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    new_search_results = search_parameters(
      target_impedance.value,
      simulation_stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      get_parameter,
      toRaw(user_data.stackup_2d_mesh_config),
      new_profiler, toast,
    );
    new_profiler.end();
  } catch (error) {
    toast.error(`perform_search() failed with: ${String(error)}`);
  }
  if (!new_profiler.is_ended()) {
    new_profiler.end_all();
  }

  toRaw(search_results.value)?.delete();
  search_results.value = new_search_results;
  const best_result = new_search_results?.best_result;
  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = best_result?.stackup_grid;
  measurement.value = best_result?.measurement;
  profiler.value = new_profiler;
  if (best_result) {
    // set form field to best fit parameter values
    for (const param of search_params) {
      param.value = best_result.value;
    }
    // mark form values as unmodified
    used_parameters.forEach(param => editor.value.parameters.mark_parameter_unchanged(param));
  }
  is_running.value = false;
}

// update editor if query parameters change
watch(() => route.query, (new_query) => {
  read_query_parameters(new_query);
  selected_editor.value = create_editor();
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
          <h2 class="card-title">Stackup</h2>
          <div class="w-full flex flex-col gap-y-1">
            <div class="w-full flex flex-row gap-x-1">
              <select class="select w-full" v-model="selected_editor.selected" :disabled="!is_editing">
                <option v-for="option in selected_editor.keys" :value="option" :key="option">
                  {{ option }}
                </option>
              </select>
              <select class="select w-full" v-model="selected_trace_template.selected" :disabled="!is_editing">
                <option v-for="option in selected_trace_template.keys" :value="option" :key="option">
                  {{ option }}
                </option>
              </select>
              <template v-if="is_editing">
                <button class="btn edit-toggle" @click="is_editing = false"><EyeIcon/></button>
              </template>
              <template v-else>
                <button class="btn edit-toggle" @click="is_editing = true"><PencilIcon/></button>
              </template>
            </div>
            <div class="w-full border border-1 border-base-300 bg-base-100 p-1" v-if="is_editing">
              <EditorControls :editor="editor"/>
            </div>
            <div class="w-full max-w-[40rem] self-center border border-1 rounded-sm border-base-300 bg-white p-1">
              <StackupViewer :stackup="viewer_stackup"/>
            </div>
          </div>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body p-3">
          <div class="flex flex-row items-center gap-x-1">
            <h2 class="card-title">Parameters</h2>
            <div
              class="tooltip tooltip-bottom"
              data-tip="Physical dimensions must all be in the same unit"
            >
              <InfoIcon class="w-[1rem] h-[1rem]"/>
            </div>
          </div>
          <ParameterForm
            :editor="editor"
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
                <MeshConfigForm :config="user_data.stackup_2d_mesh_config"/>
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
          <MeasurementTable v-if="measurement" :measurement="measurement" :parameters="editor.parameters"></MeasurementTable>
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
    <ParameterSearchResultsGraph v-if="search_results" :results="search_results"/>
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
    <MeshViewer v-if="stackup_grid" :stackup_grid="stackup_grid"></MeshViewer>
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
