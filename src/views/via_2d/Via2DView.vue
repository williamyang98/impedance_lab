<script lang="ts" setup>
import { providers } from "../../providers/providers.ts";
import { ref, toRaw, computed } from "vue";
import { Profiler } from '../../utility/profiler.ts';
import { calculate_via_impedance, type ImpedanceResult } from './impedance.ts';
import GridViewer from '../../app/electrostatic_2d/GridViewer.vue';
import TabsView from '../../utility/TabsView.vue';
import GridBuilderView from '../../app/electrostatic_2d/GridBuilderView.vue';
import ProfilerFlameChart from '../../utility/ProfilerFlameChart.vue';
import ExportView from '../stackup_2d/ExportView.vue';
import { StackupGrid } from './stackup_to_grid.ts';
import { StackupVisualiser } from "./stackup_to_visualiser.ts";
import VisualiserView from "../visualiser_2d/VisualiserView.vue";
import LayersEditorView from "./LayersEditorView.vue";
import { Stackup, type Parameter } from "./stackup.ts";
import ParameterForm from "./ParameterForm.vue";
import ImpedanceResultView from "./ImpedanceResultView.vue";
import { computed_ref } from "../../utility/computed_ref.ts";

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

  L0.plane.add_via_pad?.();
  L3.plane.add_via_pad?.();
  L1.planes.bottom.add_via_pad?.();
  L1.planes.bottom.add_reference_plane?.();
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

function calculate_impedance() {
  if (is_running.value) return;
  is_running.value = true;
  try {
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

    new_stackup_grid.parsed_parameters.forEach((param) => { mark_parameter_valid(param); });
    toRaw(stackup_grid.value)?.delete();
    stackup_grid.value = new_stackup_grid;
    impedance_result.value = new_result;
    profiler.value = new_profiler;
  } catch (error) {
    toast.error(`Run failed with: ${String(error)}`);
  }
  is_running.value = false;
}
</script>

<template>
<TabsView :initial_tab="'0'">
  <template #h-0>Result</template>
  <template #b-0>
    <div class="grid grid-cols-3 gap-2">
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <div class="h-fit w-full flex flex-col gap-y-2">
            <div class="flex flex-row gap-2">
              <input class="checkbox checkbox-sm" type="checkbox" v-model="is_editing"/>
              <span class="label">Editing</span>
            </div>
            <LayersEditorView :stackup="stackup" v-if="is_editing"/>
            <VisualiserView :visualiser="stackup_visualiser"/>
          </div>
        </div>
      </div>
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <ParameterForm :stackup="stackup" @submit="calculate_impedance()"/>
        </div>
      </div>
      <div class="card card-border bg-base-100">
        <div class="card-body">
          <ImpedanceResultView :result="impedance_result" v-if="impedance_result"/>
          <div v-else class="w-full my-2 text-center text-xl">
            Run simulation for results
          </div>
          <button class="btn w-full" @click="calculate_impedance()" :disabled="is_running">Run</button>
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
