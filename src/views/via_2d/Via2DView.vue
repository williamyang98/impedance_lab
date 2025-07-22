<script lang="ts" setup>
import { providers } from "../../providers/providers.ts";
import { ref, toRaw, computed, onMounted, watch, type ComputedGetter } from "vue";
import { Profiler } from '../../utility/profiler.ts';
import { calculate_via_impedance, type ImpedanceResult } from './impedance.ts';
import { with_standard_suffix } from '../../utility/standard_suffix.ts';
import GridViewer from '../../app/electrostatic_2d/GridViewer.vue';
import TabsView from '../../utility/TabsView.vue';
import GridBuilderView from '../../app/electrostatic_2d/GridBuilderView.vue';
import ProfilerFlameChart from '../../utility/ProfilerFlameChart.vue';
import ExportView from '../stackup_2d/ExportView.vue';
import { StackupGrid } from './stackup_to_grid.ts';
import { StackupVisualiser } from "./stackup_to_visualiser.ts";
import VisualiserView from "../visualiser_2d/VisualiserView.vue";
import { Editor, type StackupTemplate } from "./editor.ts";
import LayersEditorView from "./LayersEditorView.vue";
import { type Layer, type Stackup } from "./stackup.ts";
import ParameterForm from "./ParameterForm.vue";

const stackup_grid = ref<StackupGrid | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);
const profiler = ref<Profiler | undefined>(undefined);
const grid = computed(() => stackup_grid.value?.grid);
const is_running = ref<boolean>(false);
const is_editing = ref<boolean>(true);

const wasm_module = toRaw(providers.wasm_module.value);
const toast = providers.toast_manager.value;
const user_data = providers.user_data.value;

const stackup_template: StackupTemplate = (editor: Editor): Stackup => {
  const layers: Layer[] = [];
  {
    layers.push(editor.create_surface_layer());
    layers.push(editor.create_inner_layer());
    layers.push(editor.create_surface_layer());
  }

  return {
    layers,
    barrel: {
      diameter: editor.parameters.barrel_diameter,
      copper_thickness: editor.parameters.barrel_thickness,
      epsilon: editor.parameters.barrel_epsilon,
    },
  }
};

const editor = ref(new Editor(user_data, stackup_template));

function computed_ref<T>(callback: ComputedGetter<T>) {
  const _value = computed(callback);
  const value = ref(_value.value);
  watch(_value, (new_value) => value.value = new_value);
  return value;
}

const stackup = computed(() => editor.value.stackup);
const stackup_visualiser = computed_ref(() => new StackupVisualiser(editor.value, is_editing.value));

function execute() {
  const new_profiler = new Profiler();
  new_profiler.begin("build_grid");
  const new_stackup_grid = new StackupGrid(wasm_module, stackup.value, new_profiler);
  new_profiler.end();

  const grid = new_stackup_grid.grid;
  {
    new_profiler.begin("field_solver", undefined, {
      "Width": grid.width.toString(),
      "Height": grid.height.toString(),
      "Total": `${grid.width*grid.height}`,
    });
    grid.bake(new_profiler);
    grid.run(new_profiler);
    new_profiler.end();
  }

  new_profiler.begin("calculate_impedance");
  const new_result = calculate_via_impedance(new_stackup_grid, new_profiler);
  new_profiler.end();

  new_profiler.end_all();

  toRaw(stackup_grid.value)?.delete();
  stackup_grid.value = new_stackup_grid;
  impedance_result.value = new_result;
  profiler.value = new_profiler;

}

function run() {
  if (is_running.value) return;
  is_running.value = true;
  try {
    execute();
  } catch (error) {
    toast.error(`Run failed with: ${String(error)}`);
  }
  is_running.value = false;
}

onMounted(() => {
  run();
});

</script>

<template>
<TabsView :initial_tab="'0'">
  <template #h-0>Result</template>
  <template #b-0>
    <div class="grid grid-cols-2 gap-2">
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <table class="table table-compact w-fit" v-if="impedance_result">
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-medium">Z0</td>
                <td>{{ with_standard_suffix(impedance_result.Z0, "Ω", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Capacitance</td>
                <td>{{ with_standard_suffix(impedance_result.Cih, "F", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Inductance</td>
                <td>{{ with_standard_suffix(impedance_result.Lh, "H", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Energy homogenous</td>
                <td>{{ with_standard_suffix(impedance_result.energy_homogenous, "J", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Energy inhomogenous</td>
                <td>{{ with_standard_suffix(impedance_result.energy_inhomogenous, "J", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Propagation Delay</td>
                <td>{{ with_standard_suffix(impedance_result.propagation_delay, "s", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Resonant Frequency</td>
                <td>{{ with_standard_suffix(impedance_result.resonant_frequency, "Hz", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">DC Resistance</td>
                <td>{{ with_standard_suffix(impedance_result.dc_resistance, "Ω", 4) }}</td>
              </tr>
              <tr>
                <td class="font-medium">Effective Er</td>
                <td>{{ impedance_result.effective_er.toFixed(3) }}</td>
              </tr>
            </tbody>
          </table>
          <button class="btn w-full" @click="run()" :disabled="is_running">Run</button>
        </div>
      </div>
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <div class="flex flex-row gap-2">
            <input class="checkbox checkbox-sm" type="checkbox" v-model="is_editing"/>
            <span class="label">Editing</span>
          </div>
          <LayersEditorView :editor="editor" v-if="is_editing"/>
          <VisualiserView :visualiser="stackup_visualiser"/>
        </div>
      </div>
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <ParameterForm :editor="editor"/>
        </div>
      </div>
    </div>
  </template>
  <template #h-1>Viewer</template>
  <template #b-1>
    <div class="w-full h-full" v-if="grid">
      <GridViewer :grid="grid"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-2>Mesh</template>
  <template #b-2>
    <div class="w-full h-full" v-if="stackup_grid?.grid_builder">
      <GridBuilderView :builder="stackup_grid.grid_builder"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-3>Profiler</template>
  <template #b-3>
    <div class="w-full h-full" v-if="profiler">
      <ProfilerFlameChart :profiler="profiler"/>
    </div>
    <div v-else class="w-full text-center">
      <span class="text-lg my-2">Run simulation</span>
    </div>
  </template>
  <template #h-4>Export</template>
  <template #b-4>
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
