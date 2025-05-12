<script setup lang="ts">

// https://stackoverflow.com/a/68841834
// this.$ref.viewer_2d will return a { __v_skip: True } instead of the child component
// since the child component has a <script setup> tag
import { defineExpose, ref, useId } from "vue";
const viewer_2d = ref(null);
defineExpose({
  viewer_2d
});

const id_tab_result = useId();
const id_tab_viewer = useId();

</script>

<script lang="ts">
import { defineComponent } from "vue";
import { Ndarray } from "../../utility/ndarray.ts";
import {
  Setup,
  type TransmissionLineParameters,
  type ParameterSearchConfig, type ParameterSearchResults, perform_parameter_search,
} from "./app_2d.ts";
import LineChart from "../../components/LineChart.vue";
import { Viewer2D } from "../../components/viewer_2d";
import { type RunResult, type ImpedanceResult } from "../../engine/electrostatic_2d.ts";

type SearchOption = "er0" | "er1" | "er0+er1" | "h0" | "h1" | "h0+h1" | "w" | "s" | "t";
interface ParameterConfig {
  getter: (params: TransmissionLineParameters, value: number) => TransmissionLineParameters;
  v_lower: number;
  v_upper: number;
  is_positive_correlation: boolean;
};

function get_parameter_config(option: SearchOption): ParameterConfig {
  const create_config = (
    v_lower: number,
    v_upper: number,
    is_positive_correlation: boolean,
    getter: (params: TransmissionLineParameters, value: number) => TransmissionLineParameters,
  ): ParameterConfig => {
    return { getter, v_lower, v_upper, is_positive_correlation };
  }

  switch (option) {
  case "er0": return create_config(1, 2, false, (p,v) => { return {...p, dielectric_bottom_epsilon: v }; });
  case "er1": return create_config(1, 2, false, (p,v) => { return {...p, dielectric_top_epsilon: v }; });
  case "er0+er1": return create_config(1, 2, false, (p,v) => { return {...p, dielectric_bottom_epsilon: v, dielectric_top_epsilon: v }; });
  case "h0": return create_config(0, 1, true, (p,v) => { return {...p, dielectric_bottom_height: v }; });
  case "h1": return create_config(0, 1, true, (p,v) => { return {...p, dielectric_top_height: v }; });
  case "h0+h1": return create_config(0, 1, true, (p,v) => { return {...p, dielectric_bottom_height: v, dielectric_top_height: v }; });
  case "w": return create_config(0, 1, false, (p,v) => { return {...p, signal_width: v }; });
  case "s": return create_config(0, 1, true, (p,v) => { return {...p, signal_separation: v }; });
  case "t": return create_config(0, 1, false, (p,v) => { return {...p, signal_height: v }; });
  }
}

interface ComponentData {
  setup: Setup;
  params: TransmissionLineParameters;
  run_result?: RunResult;
  impedance_result?: ImpedanceResult;
  energy_threshold: number;
  search_option: SearchOption;
  search_options: SearchOption[];
  search_config: ParameterSearchConfig;
}

export default defineComponent({
  components: {
    Viewer2D,
    LineChart,
  },
  data(): ComponentData {
    return {
      setup: new Setup(),
      params: {
        dielectric_bottom_epsilon: 4.1,
        dielectric_bottom_height: 0.0994,
        signal_separation: 0.15,
        signal_width: 0.1334,
        signal_height: 0.0152,
        dielectric_top_epsilon: 4.36,
        dielectric_top_height: 0.45,
      },
      energy_threshold: -2.3,
      run_result: undefined,
      impedance_result: undefined,
      search_option: "w",
      search_options: ["er0", "er1", "er0+er1", "h0", "h1", "h0+h1", "w", "s", "t"],
      search_config: {
        Z0_target: 85,
        ...get_parameter_config("w"),
        error_tolerance: 1e-2,
        early_stop_threshold: 1e-2,
        plateau_count: 5,
      },
    };
  },
  methods: {
    update_params() {
      this.reset();
      this.setup.update_params(this.params);
      this.update_charts();
      this.run();
    },
    run() {
      const grid = this.setup.grid;
      if (grid === undefined) return;
      const threshold = 10**this.energy_threshold;
      this.run_result = grid.run(threshold);
      this.impedance_result = grid.calculate_impedance();
      void this.refresh_viewer();
    },
    async refresh_viewer() {
      if (this.$refs.viewer_2d === null) return;
      const viewer = this.$refs.viewer_2d as typeof Viewer2D;
      const grid = this.setup.grid;
      if (grid === undefined) return;
      viewer.upload_grid(grid);
      await viewer.refresh_canvas();
    },
    reset() {
      this.setup.reset();
    },
    update_charts() {
      function create_markers(arr: Ndarray): { x: number, y: number }[] {
        return Array.from(arr.data).map((e,i) => {
          return { x: i, y: e }
        });
      }
      const grid = this.setup.grid;
      if (grid === undefined) return;
      if (this.$refs.dx_chart) {
        const chart = this.$refs.dx_chart as typeof LineChart;
        chart.set_data(create_markers(grid.dx));
        chart.set_ylabel("dx");
        chart.update();
      }
      if (this.$refs.dy_chart) {
        const chart = this.$refs.dy_chart as typeof LineChart;
        chart.set_data(create_markers(grid.dy));
        chart.set_ylabel("dy");
        chart.update();
      }
    },
    async run_parameter_search() {
      const param_config = get_parameter_config(this.search_option);
      const energy_threshold = 10**this.energy_threshold;
      const search_results: ParameterSearchResults = await perform_parameter_search(
        (value: number) => param_config.getter(this.params, value),
        this.setup,
        this.search_config,
        energy_threshold,
      );
      const result = search_results.results[search_results.best_step];
      this.params = result.params;
      this.run_result = result.run_result;
      this.impedance_result = result.impedance_result;
      const xy_data = search_results.results.map((e) => {
        const Z0 = e.impedance_result.Z0;
        const value = e.value;
        return {
          x: value,
          y: Z0,
        };
      });
      xy_data.sort((a,b) => a.x-b.x);
      if (this.$refs.param_chart) {
        const chart = this.$refs.param_chart as typeof LineChart;
        chart.set_data(xy_data);
        chart.set_xlabel(this.search_option);
        chart.set_ylabel("Z0");
        chart.update();
      }
      this.update_params();
    },
  },
  mounted() {
    this.update_params();
  },
  beforeUnmount() {

  },
  watch: {
    search_option(new_value, _old_value) {
      const param_config = get_parameter_config(new_value);
      this.search_config.v_lower = param_config.v_lower;
      this.search_config.v_upper = param_config.v_upper;
      this.search_config.is_positive_correlation = param_config.is_positive_correlation;
    },
  },
});
</script>

<template>
<div class="grid grid-flow-row grid-cols-3 gap-2">
  <div class="card card-border shadow">
    <div class="card-body">
      <h2 class="card-title">Parameters</h2>
      <form class="grid grid-cols-[auto_auto] gap-y-1 gap-x-2">
        <label for="er0">εr bottom</label>
        <input id="er0" type="number" v-model.number="params.dielectric_bottom_epsilon"/>
        <label for="er1">εr top</label>
        <input id="er1" type="number" v-model.number="params.dielectric_top_epsilon"/>
        <label for="h0">Height bottom</label>
        <input id="h0" type="number" v-model.number="params.dielectric_bottom_height"/>
        <label for="h1">Height top</label>
        <input id="h1" type="number" v-model.number="params.dielectric_top_height"/>
        <label for="w">Trace width</label>
        <input id="w" type="number" v-model.number="params.signal_width"/>
        <label for="s">Trace separation</label>
        <input id="s" type="number" v-model.number="params.signal_separation"/>
        <label for="t">Trace thickness</label>
        <input id="t" type="number" v-model.number="params.signal_height"/>
      </form>
      <div class="card-actions justify-end">
        <button class="btn" @click="update_params()">Calculate Impedance</button>
      </div>
    </div>
  </div>
  <div class="card card-border shadow">
    <div class="card-body">
      <h2 class="card-title">Parameter Search</h2>
      <form class="grid grid-cols-[auto_auto] gap-y-1 gap-x-2">
        <label for="search_option">Parameter</label>
        <select class="select" id="search_option" v-model="search_option">
          <option :value="'er0'">εr bottom</option>
          <option :value="'er1'">εr top</option>
          <option :value="'er0+er1'">εr both</option>
          <option :value="'h0'">Height bottom</option>
          <option :value="'h1'">Height top</option>
          <option :value="'h0+h1'">Height both</option>
          <option :value="'w'">Trace width</option>
          <option :value="'s'">Trace separation</option>
          <option :value="'t'">Trace thickness</option>
        </select>
        <label for="z0">Z0 target</label>
        <input id="z0" type="number" v-model.number="search_config.Z0_target"/>
        <label for="v_lower">Lower bound</label>
        <input id="v_lower" type="number" v-model.number="search_config.v_lower"/>
        <label for="v_upper">Upper bound</label>
        <input id="v_upper" type="number" v-model.number="search_config.v_upper"/>
        <label for="error_tolerance">Error tolerance</label>
        <input id="error_tolerance" type="number" v-model.number="search_config.error_tolerance"/>
        <label for="early_stop_threshold">Early stop threshold</label>
        <input id="early_stop_threshold" type="number" v-model.number="search_config.early_stop_threshold"/>
        <label for="plateau_count">Plateau count</label>
        <input id="plateau_count" type="number" v-model.number="search_config.plateau_count"/>
      </form>
      <div class="card-actions justify-end">
        <button class="btn" @click="run_parameter_search()">Search</button>
      </div>
    </div>
  </div>
  <div class="card card-border shadow">
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
  <div class="card card-border shadow col-span-3">
    <div class="card-body">
      <div>
        <div class="tabs tabs-lift">
          <input type="radio" :name="id_tab_viewer" class="tab" aria-label="Field" checked/>
          <div class="tab-content bg-base-100 border-base-300">
            <Viewer2D ref="viewer_2d"></Viewer2D>
          </div>
          <input type="radio" :name="id_tab_viewer" class="tab" aria-label="Parameter Search" checked/>
          <div class="tab-content bg-base-100 border-base-300">
            <LineChart ref="param_chart" class="w-[100%] h-[100%]"></LineChart>
          </div>
          <input type="radio" :name="id_tab_viewer" class="tab" aria-label="X Grid" checked/>
          <div class="tab-content bg-base-100 border-base-300">
            <LineChart ref="dx_chart" class="w-[100%] h-[100%]"></LineChart>
          </div>
          <input type="radio" :name="id_tab_viewer" class="tab" aria-label="Y Grid" checked/>
          <div class="tab-content bg-base-100 border-base-300">
            <LineChart ref="dy_chart" class="w-[100%] h-[100%]"></LineChart>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<style scoped>
</style>
