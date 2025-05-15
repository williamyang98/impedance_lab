<script setup lang="ts">
import { computed, ref, useId, useTemplateRef } from "vue";
import { Editor } from "./editor.ts";
import {
  type LayerTemplate,
  layer_templates, layer_descriptor_to_template, layer_template_to_descriptor,
} from "./layer_templates.ts";
import { type TraceLayoutType, trace_layout_types } from "./stackup.ts";
import { StackupViewer } from "./index.ts";
import {
  get_viewer_layout_from_editor,
} from "./stackup_to_viewer_layout.ts";
import {
  get_stackup_parameters_from_stackup,
  get_annotation_config_from_stackup_parameters,
} from "./stackup_parameters.ts";
import {
  create_stackup_grid_from_stackup_parameters, type StackupGrid,
} from "./stackup_grid.ts";
import StackupParameterForm from "./StackupParameterForm.vue";
import { type RunResult, type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import RegionGridViewer from "./RegionGridViewer.vue";
import { Viewer2D } from "../../components/viewer_2d";

const viewer_2d = useTemplateRef<typeof Viewer2D>("viewer_2d");
const id_tab_result = useId();

function layer_template_to_string(template: LayerTemplate): string {
  switch (template) {
    case "core": return "Core";
    case "prepreg": return "Prepeg";
    case "copper": return "Copper";
    case "soldermask": return "Soldermask";
    case "unmasked": return "Unmasked";
  }
}

function trace_layout_type_to_string(type: TraceLayoutType): string {
  switch (type) {
    case "single_ended": return "Single ended";
    case "coplanar_pair": return "Coplanar pair";
    case "broadside_pair": return "Broadside pair";
  }
}

const editor = ref(new Editor());
const stackup_parameters = computed(() => {
  return get_stackup_parameters_from_stackup(editor.value);
});
const viewer_layout = computed(() => {
  const annotation_config = get_annotation_config_from_stackup_parameters(editor.value, stackup_parameters.value);
  return get_viewer_layout_from_editor(editor.value, annotation_config);
});
const stackup_grid = ref<StackupGrid | undefined>();
const is_running = ref<boolean>(false);
const run_result = ref<RunResult | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);

const trace_layout_type = computed<TraceLayoutType>({
  get() {
    return editor.value.trace_layout.type;
  },
  set(type) {
    editor.value.change_trace_layout_type(type);
  }
});

const layers = computed(() => editor.value.layers.map((layer, layer_index) => {
  return {
    template: computed<LayerTemplate>({
      get() {
        const layer = editor.value.layers[layer_index];
        return layer_descriptor_to_template(layer);
      },
      set(template) {
        const descriptor = layer_template_to_descriptor(layer_index, template);
        editor.value.change_layer_type(layer_index, descriptor);
      }
    }),
    descriptor: layer,
    can_set_template(template: LayerTemplate): boolean {
      const descriptor = layer_template_to_descriptor(layer_index, template);
      return editor.value.can_change_layer_type(layer_index, descriptor);
    },
  }
}));

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

async function update_region_grid() {
  if (editor.value === undefined) return;
  if (stackup_parameters.value === undefined) return;
  try {
    const new_stackup_grid = create_stackup_grid_from_stackup_parameters(stackup_parameters.value, editor.value);
    stackup_grid.value = new_stackup_grid;
    await reset();
  } catch (error) {
    console.error(error);
  }
}

const energy_threshold = ref<number>(-3);

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
<h1 class="text-2xl">Stackup Editor</h1>
<div class="flex flex-row gap-x-2">
  <div>
    <fieldset class="fieldset">
      <legend class="fieldset-legend">Signal type / Coplanar ground</legend>
      <div class="flex flex-row gap-x-1 items-center">
        <select id="signal_type" v-model="trace_layout_type" class="select select-sm">
          <template v-for="type in trace_layout_types" :key="type">
            <option :value="type" v-if="editor.can_change_trace_layout(type)">{{ trace_layout_type_to_string(type) }}</option>
          </template>
        </select>
        <div>
          <input
            class="checkbox"
            type="checkbox"
            :true-value="true" :false-value="false"
            v-model.number="editor.trace_layout.has_coplanar_ground"
          />
        </div>
      </div>
    </fieldset>
    <div class="bg-base-100 border-base-300 border-sm border-1">
      <template v-if="editor.can_add_above()">
        <div class="add-button" @click="editor.add_layer(0)"></div>
      </template>
      <template v-for="(layer, index) in layers" :key="layer.descriptor.id">
        <div class="flex flex-row px-1 py-1 items-center">
          <b>L{{ index+1 }}:</b>
          <select v-model="layer.template.value" class="w-full min-w-[7rem]">
            <template v-for="template in layer_templates" :key="template">
              <option v-if="layer.can_set_template(template)" :value="template">
                {{ layer_template_to_string(template) }}
              </option>
            </template>
          </select>
          <button class="btn btn-xs btn-outline btn-error ml-1" @click="editor.remove_layer(index)" :disabled="!editor.can_remove_layer(index)">x</button>
        </div>
        <template v-if="editor.can_add_layer_below(index)">
          <div class="add-button" @click="editor.add_layer(index+1)"></div>
        </template>
      </template>
    </div>
  </div>
  <div class="min-w-[25rem] min-h-[5rem] max-w-[100%] max-h-[75vh] overflow-auto">
    <StackupViewer :viewer_layout="viewer_layout"></StackupViewer>
  </div>
</div>

<br>

<h1 class="text-2xl">Parameters</h1>
<StackupParameterForm :params="stackup_parameters"></StackupParameterForm>
<button class="btn" @click="update_region_grid()">Update grid</button>

<template v-if="stackup_grid">
  <h1 class="text-2xl">Region grid</h1>
  <RegionGridViewer :region_grid="stackup_grid.region_grid"></RegionGridViewer>
</template>

<div class="card card-border bg-base-100">
  <div class="card-body">
    <h2 class="card-title">Results Search</h2>
    <div>
      <div class="tabs tabs-lift">
        <template v-if="impedance_result">
          <input type="radio" :name="id_tab_result" class="tab" aria-label="Impedance" checked/>
          <div class="tab-content bg-base-100 border-base-300">
            <table class="table">
              <tbody>
                <tr>
                  <td class="font-medium">Z0</td>
                  <td>{{ `${impedance_result.Z0.toFixed(2)} Ω` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Cih</td>
                  <td>{{ `${(impedance_result.Cih*1e12/100).toFixed(2)} pF/cm` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Lh</td>
                  <td>{{ `${(impedance_result.Lh*1e9/100).toFixed(2)} nH/cm` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Propagation speed</td>
                  <td>{{ `${(impedance_result.propagation_speed/3e8*100).toFixed(2)}%` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Propagation delay</td>
                  <td>{{ `${(impedance_result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <template v-if="run_result">
          <input type="radio" :name="id_tab_result" class="tab" aria-label="Simulation"/>
          <div class="tab-content bg-base-100 border-base-300">
            <table class="table">
              <tbody>
                <tr>
                  <td class="font-medium">Total steps</td>
                  <td>{{ run_result.total_steps }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Time taken</td>
                  <td>{{ `${(run_result.time_taken*1e3).toFixed(2)} ms` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Step rate</td>
                  <td>{{ `${run_result.step_rate.toFixed(2)} steps/s` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Cell rate</td>
                  <td>{{ `${(run_result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td>
                </tr>
                <tr>
                  <td class="font-medium">Total cells</td>
                  <td>{{ run_result.total_cells }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <input type="radio" :name="id_tab_result" class="tab" aria-label="Viewer"/>
        <div class="tab-content bg-base-100 border-base-300">
          <Viewer2D ref="viewer_2d"></Viewer2D>
        </div>
      </div>
    </div>
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

</template>

<style scoped>
.add-button {
  height: 0.35rem;
  width: 100%;
  background-color: #99999977;
  cursor: cell;
  padding: none;
  user-select: none;
  margin-top: 0px;
  margin-bottom: 0px;
}

.add-button:hover {
  background-color: #0000bb77;
}
</style>
