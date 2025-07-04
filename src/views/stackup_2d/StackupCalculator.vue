<script setup lang="ts">
import {
  computed, ref, useId,
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
import { PencilIcon, EyeIcon, InfoIcon } from "lucide-vue-next";
// ts imports
import { validate_parameter, type Parameter } from "./stackup.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { get_default_stackup_grid_config, StackupGrid } from "./grid.ts";
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
  const parameters = new StackupParameters();

  function mark_parameter_changed(param: Parameter) {
    param.old_value = undefined;
    param.error = undefined;
  }

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
      this.editor.parameters.for_each(mark_parameter_changed);
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
      this.editor.parameters.for_each(mark_parameter_changed);
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
      this.parameters.for_each(mark_parameter_changed);
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
    return simulation_stackup.value;
  }
});
const stackup_grid_config = computed(() => {
  const config = get_default_stackup_grid_config();
  config.minimum_grid_resolution = editor.value.parameters.minimum_feature_size;
  return config;
});

const uid = {
  tab_global: useId(),
  tab_result: useId(),
  tab_simulation: useId(),
};
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
      validate_parameter(param);
      used_parameters.add(param);
      return param.value!;
    }

    new_profiler.begin("create_layout", "Create layout from transmission line stackup");
    const layout = create_layout_from_stackup(simulation_stackup.value, get_parameter, new_profiler);
    new_profiler.end();

    new_profiler.begin("create_grid", "Create simulation grid from layout");
    new_stackup = new StackupGrid(
      layout, get_parameter,
      new_profiler,
      stackup_grid_config.value,
    );
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
    validate_parameter(param);
    used_parameters.add(param);
    return param.value!;
  }

  let new_search_results: SearchResults | undefined = undefined;
  const new_profiler = new Profiler("perform_search");
  try {
    new_search_results = search_parameters(
      target_impedance.value,
      simulation_stackup.value,
      toRaw(search_params), // avoid triggering vue updates with toRaw(...)
      get_parameter,
      stackup_grid_config.value,
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
    for (const param of used_parameters) {
      param.old_value = param.value;
    }
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
<div class="tabs tabs-box">
  <!--Calculator tab-->
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Calculator" checked/>
  <div class="tab-content p-1">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-x-2 gap-y-2">
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
            <div class="w-full border border-1 rounded-sm border-base-300 bg-white p-1">
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
            :stackup="simulation_stackup"
            @search="perform_search"
            @submit="calculate_impedance"
          ></ParameterForm>
        </div>
      </div>
      <div class="w-full card card-border bg-base-100">
        <div class="card-body p-3">
          <h2 class="card-title">Impedance</h2>
          <div class="h-full">
            <div class="w-full flex flex-row">
              <label class="label mr-2">Z0 target </label>
              <input class="input input w-full" type="number" step="any" v-model.number="target_impedance" min="0"/>
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
  <!--Parameter search tab-->
  <label class="tab">
    <input type="radio" :name="uid.tab_global"/>
    <div class="flex flex-row gap-x-2 items-center">
      <span>Parameter Search</span>
      <div v-if="search_results" class="badge badge-sm badge-secondary">{{ search_results.results.length }}</div>
    </div>
  </label>
  <div class="tab-content p-1">
    <ParameterSearchResultsGraph v-if="search_results" :results="search_results"/>
    <div v-else class="text-center py-2">
      <h1 class="text-2xl">Perform parameter search to see search curve</h1>
    </div>
  </div>
  <!--Visualisation tab-->
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Visualiser"/>
  <div class="tab-content p-1">
    <div v-if="stackup_grid" class="w-full">
      <GridViewer :grid="stackup_grid.grid"/>
    </div>
    <div v-else class="text-center py-2">
      <h1 class="text-2xl">Calculate impedance to see visualisation</h1>
    </div>
  </div>
  <!--Mesh tab-->
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Mesh"/>
  <div class="tab-content p-1">
    <MeshViewer v-if="stackup_grid" :stackup_grid="stackup_grid"></MeshViewer>
    <div v-else class="text-center py-2">
      <h1 class="text-2xl">Calculate impedance to see mesh</h1>
    </div>
  </div>
  <!--Profiler tab-->
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Profiler"/>
  <div class="tab-content p-1">
    <div class="w-full">
      <template v-if="profiler">
        <ProfilerFlameChart :profiler="profiler"></ProfilerFlameChart>
      </template>
      <template v-else>
        <div class="text-center py-2">
          <h1 class="text-2xl">Calculate impedance to see execution profile</h1>
        </div>
      </template>
    </div>
  </div>
  <!--Data export tab-->
  <input type="radio" :name="uid.tab_global" class="tab" aria-label="Export"/>
  <div class="tab-content p-1">
    <div class="w-full">
      <!--NOTE: justify-center-safe is required since flex centering with overflow is broken (https://stackoverflow.com/a/78181725)-->
      <div v-if="stackup_grid" class="w-full flex justify-center-safe overflow-x-auto">
        <ExportView :grid="stackup_grid.grid" class="w-fit border border-base-300 bg-base-100"/>
      </div>
      <div v-else class="text-center py-2">
        <h1 class="text-2xl">Calculate impedance to export simulation data</h1>
      </div>
    </div>
  </div>
</div>

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
