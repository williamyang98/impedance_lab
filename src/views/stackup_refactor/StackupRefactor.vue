<script setup lang="ts">
import { type Stackup, type SizeParameter } from "./stackup.ts";
import StackupViewer from "./StackupViewer.vue";
import { sizes } from "./viewer.ts";
import { create_layout_from_stackup } from "./layout.ts";
import { type StackupGrid, get_stackup_grid_from_stackup_layout } from "./grid.ts";
import RegionGridViewer from "../editor_2d/RegionGridViewer.vue";
import { ref, useId, useTemplateRef } from "vue";
import ParameterForm from "./ParameterForm.vue";
import { Viewer2D } from "../../components/viewer_2d";
import { type RunResult, type ImpedanceResult } from "../../engine/electrostatic_2d.ts";

const common = {
  T: { name: "T", min: 0, value: 0.035, placeholder_value: sizes.trace_height },
  dW: { name: "dW1", min: 0, value: 0.05, placeholder_value: sizes.trace_taper, taper_suffix: '1' },
  copper_height: { value: 0.01, placeholder_value: sizes.copper_layer_height },
}

const params = {
  // layer 1
  // T1: { name: "T1", min: 0, value: 0.035, placeholder_value: sizes.trace_height },
  T1: common.T,
  // dW1: { name: "dW1", min: 0, value: 0.05, placeholder_value: sizes.trace_taper, taper_suffix: '1' },
  dW1: common.dW,
  H1: { name: "H1", min: 0, value: 0.05, placeholder_value: sizes.soldermask_height },
  ER1: { name: "ER1", min: 1, value: 4.1 },
  // layer 2
  H2: { name: "H2", min: 0, value: 0.25, placeholder_value: sizes.core_height },
  ER2: { name: "ER2", min: 1, value: 4.1 },
  // layer 3
  // T3: { name: "T3", min: 0, value: 0.035, placeholder_value: sizes.trace_height },
  T3: common.T,
  H3: { name: "H3", min: 0, value: 0.25, placeholder_value: sizes.core_height },
  // dW3: { name: "dW3", min: 0, value: 0.05, placeholder_value: sizes.trace_taper, taper_suffix: '3' },
  dW3: common.dW,
  ER3: { name: "ER3", min: 1, value: 4.1 },
  // layer 4
  H4: { name: "H4", min: 0, value: 0.25, placeholder_value: sizes.core_height },
  ER4: { name: "ER4", min: 1, value: 4.1 },
  // layer 5
  // T5: { name: "T5", min: 0, value: 0.035, placeholder_value: sizes.trace_height },
  T5: common.T,
  H5: { name: "H5", min: 0, value: 0.25, placeholder_value: sizes.core_height },
  // dW5: { name: "dW5", min: 0, value: 0.05, placeholder_value: sizes.trace_taper, taper_suffix: '5' },
  dW5: common.dW,
  // spacing
  W: { name: "W", min: 0, value: 0.15, placeholder_value: sizes.signal_trace_width },
  CW: { name: "CW", min: 0, value: 0.25, placeholder_value: sizes.ground_trace_width },
  S: { name: "S", min: 0, value: 0.20, placeholder_value: sizes.signal_width_separation },
  B: { name: "S", min: 0, value: 0.25, placeholder_value: sizes.broadside_width_separation },
  CS: { name: "CS", min: 0, value: 0.30, placeholder_value: sizes.ground_width_separation },
}

const voltage = {
  ground: 0,
  positive: 1,
  negative: -1,
};

const stackup: Stackup = {
  layers: [
    // {
    //   type: "soldermask",
    //   id: 0,
    //   trace_height: params.T1,
    //   trace_taper: params.dW1,
    //   height: params.H1,
    //   epsilon: params.ER1,
    //   orientation: "down",
    // },
    {
      type: "unmasked",
      id: 0,
      trace_height: params.T1,
      trace_taper: params.dW1,
      orientation: "down",
    },
    {
      type: "core",
      id: 1,
      height: params.H2,
      epsilon: params.ER2,
    },
    {
      type: "prepreg",
      id: 4,
      trace_height: params.T3,
      trace_taper: params.dW3,
      height: params.H3,
      epsilon: params.ER3,
    },
    {
      type: "core",
      id: 3,
      height: params.H4,
      epsilon: params.ER4,
    },
    {
      type: "unmasked",
      id: 2,
      trace_height: params.T5,
      trace_taper: params.dW5,
      orientation: "up",
    },
  ],
  conductors: [
    {
      type: "trace",
      id: 0,
      layer_id: 4,
      orientation: "up",
      width: params.W,
      voltage: voltage.positive,
      viewer: {
        on_click: () => console.log("Clicked on trace 0"),
      },
    },
    {
      type: "trace",
      id: 1,
      layer_id: 4,
      orientation: "down",
      width: params.W,
      voltage: voltage.negative,
      viewer: {
        display: "selectable",
        is_labeled: false,
        on_click: () => console.log("Clicked on trace 1"),
      },
    },
    {
      type: "trace",
      id: 3,
      layer_id: 4,
      orientation: "up",
      width: params.CW,
      voltage: voltage.ground,
      viewer: {
        // display: "none",
      },
    },
    {
      type: "trace",
      id: 4,
      layer_id: 4,
      orientation: "down",
      width: params.CW,
      voltage: voltage.ground,
    },
    // {
    //   type: "trace",
    //   id: 5,
    //   layer_id: 0,
    //   orientation: "down",
    //   width: params.W,
    //   voltage: voltage.ground,
    // },
    // {
    //   type: "plane",
    //   layer_id: 4,
    //   orientation: "up",
    //   height: { value: 0.01, placeholder_value: sizes.copper_layer_height },
    //   voltage: voltage.ground,
    //   layout: {
    //     shrink_trace_layer: true,
    //   },
    //   viewer: {
    //     display: "selectable",
    //     is_labeled: false,
    //     on_click: () => console.log("Clicked on plane 4"),
    //     z_offset: -1,
    //   },
    // },
    {
      type: "plane",
      layer_id: 0,
      orientation: "down",
      height: common.copper_height,
      voltage: voltage.ground,
    },
    {
      type: "plane",
      layer_id: 2,
      orientation: "up",
      height: common.copper_height,
      voltage: voltage.ground,
    },
  ],
  spacings: [
    {
      left_trace: {
        id: 0,
        attach: "center",
      },
      right_trace: {
        id: 1,
        attach: "center",
      },
      width: params.B,
    },
    {
      left_trace: {
        id: 3,
        attach: "right",
      },
      right_trace: {
        id: 0,
        attach: "left",
      },
      width: params.CS,
    },
    {
      left_trace: {
        id: 1,
        attach: "right",
      },
      right_trace: {
        id: 4,
        attach: "left",
      },
      width: params.CS,
    },
    // {
    //   left_trace: {
    //     id: 3,
    //     attach: "center",
    //   },
    //   right_trace: {
    //     id: 5,
    //     attach: "left",
    //   },
    //   width: params.S,
    //   viewer: {
    //     is_display: false,
    //   },
    // },
  ],
};

const viewer_2d = useTemplateRef<typeof Viewer2D>("viewer_2d");
const id_tab_result = useId();
const stackup_grid = ref<StackupGrid | undefined>(undefined);
const is_running = ref<boolean>(false);
const run_result = ref<RunResult | undefined>(undefined);
const impedance_result = ref<ImpedanceResult | undefined>(undefined);

async function update_region_grid() {
  const get_size = (param: SizeParameter): number => {
    const size = param.value;
    if (size === undefined) {
      param.error = "Field is required";
      throw Error("Missing size field");
    }
    return size;
  };
  try {
    const layout = create_layout_from_stackup(stackup, get_size);
    const grid = get_stackup_grid_from_stackup_layout(layout);
    stackup_grid.value = grid;
    await reset();
  } catch (error) {
    console.error(error);
  }
}

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
<div class="w-[30rem]">
  <StackupViewer :stackup="stackup"/>
</div>

<div>
  <ParameterForm :stackup="stackup"></ParameterForm>
  <button class="btn" @click="update_region_grid()">Update grid</button>
</div>

<div v-if="stackup_grid">
  <RegionGridViewer :region_grid="stackup_grid.region_grid"></RegionGridViewer>
</div>

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
svg {
  width: 100%;
  display: block;
}

.signal-selectable:hover {
  opacity: 1.0;
}
</style>
