<script lang="ts">
import { defineComponent } from "vue";
import { Ndarray } from "../app/ndarray.ts";
import {
  Setup, init_wasm_module,
  type TransmissionLineParameters, type RunResult, type ImpedanceResult, create_grid_layout,
  type ParameterSearchConfig, type ParameterSearchResults, perform_parameter_search,
} from "../app/app_2d.ts";
import Chart from 'chart.js/auto';

interface LineChart {
  set_data: (data: { x: number, y: number }[]) => void;
  set_ylabel: (label: string) => void;
  set_xlabel: (label: string) => void;
  update: () => void;
  destroy: () => void;
}

function create_line_chart(canvas: HTMLCanvasElement): LineChart {
  type Marker = { x: number, y: number };
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          borderColor: "rgba(0,0,255,0.5)",
          data: [] as Marker[],
          fill: false,
        }
      ]
    },
    options: {
      animation: false,
      scales: {
        x: {
          type: "linear",
          title: {
            text: "x",
            display: true,
          },
        },
        y: {
          type: "linear",
          title: {
            text: "y",
            display: true,
          },
        },
      },
    }
  });

  return {
    set_data: (data: { x: number, y: number }[]) => {
      chart.data.datasets[0].data = data;
    },
    set_ylabel: (label: string) => {
      chart.data.datasets[0].label = label;
      let title = chart.options.scales?.y?.title?.text;
      if (title !== null) title = label;
    },
    set_xlabel: (label: string) => {
      let title = chart.options.scales?.x?.title?.text;
      if (title !== null) title = label;
    },
    update: () => {
      chart.update();
    },
    destroy: () => {
      chart.destroy();
    },
  }
}

type SearchOption = "er0" | "er1" | "er0+er1" | "h0" | "h1" | "h0+h1" | "w" | "s" | "t";
interface SearchConfig {
  getter: (params: TransmissionLineParameters, value: number) => TransmissionLineParameters;
  v_lower: number;
  v_upper: number;
  is_positive_correlation: boolean;
};

function get_search_config(option: SearchOption): SearchConfig {
  const create_config = (
    v_lower: number,
    v_upper: number,
    is_positive_correlation: boolean,
    getter: (params: TransmissionLineParameters, value: number) => TransmissionLineParameters,
  ): SearchConfig => {
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
  dx_chart?: LineChart;
  dy_chart?: LineChart;
  search_chart?: LineChart;
  Z0_target: number;
  search_option: SearchOption;
  search_options: SearchOption[];
}

export default defineComponent({
  data(): ComponentData {
    const grid_layout = create_grid_layout();
    return {
      setup: new Setup(grid_layout),
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
      dx_chart: undefined,
      dy_chart: undefined,
      search_chart: undefined,
      Z0_target: 50,
      search_option: "w",
      search_options: ["er0", "er1", "er0+er1", "h0", "h1", "h0+h1", "w", "s", "t"],
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
      const threshold = 10**this.energy_threshold;
      this.run_result = this.setup.run(threshold);
      this.impedance_result = this.setup.calculate_impedance();
      const canvas = this.$refs.field_canvas as HTMLCanvasElement;
      this.setup.render(canvas);
    },
    reset() {
      this.setup.reset();
    },
    create_charts() {
      this.dx_chart?.destroy();
      this.dy_chart?.destroy();
      this.search_chart?.destroy();
      this.dx_chart = create_line_chart(this.$refs.dx_canvas as HTMLCanvasElement);
      this.dy_chart = create_line_chart(this.$refs.dy_canvas as HTMLCanvasElement);
      this.search_chart = create_line_chart(this.$refs.search_canvas as HTMLCanvasElement);
    },
    update_charts() {
      function create_markers(arr: Ndarray): { x: number, y: number }[] {
        return Array.from(arr.data).map((e,i) => {
          return { x: i, y: e as number }
        });
      }
      this.dx_chart?.set_data(create_markers(this.setup.grid.dx));
      this.dy_chart?.set_data(create_markers(this.setup.grid.dy));
      this.dx_chart?.set_ylabel("dx");
      this.dy_chart?.set_ylabel("dy");
      this.dx_chart?.update();
      this.dy_chart?.update();
    },
    async run_parameter_search() {
      const search_config = get_search_config(this.search_option);
      const config: ParameterSearchConfig = {
        v_lower: search_config.v_lower,
        v_upper: search_config.v_upper,
        is_positive_correlation: search_config.is_positive_correlation,
        energy_threshold: 10**this.energy_threshold,
        error_tolerance: 1e-2,
        early_stop_threshold: 1e-2,
        plateau_count: 5,
      };
      const getter = (value: number): TransmissionLineParameters => {
        return search_config.getter(this.params, value);
      };
      const search_results: ParameterSearchResults = await perform_parameter_search(getter, this.setup, this.Z0_target, config);
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
      this.search_chart?.set_data(xy_data);
      this.search_chart?.set_xlabel(this.search_option);
      this.search_chart?.set_ylabel("Z0");
      this.search_chart?.update();
      this.update_params();
    },
  },
  async mounted() {
    this.create_charts();
    await init_wasm_module();
    this.update_params();
  },
  beforeUnmount() {

  },
});
</script>

<template>
  <div>
    <h2>Transmission line parameters</h2>
    <form>
      <label for="er0">er0: </label><input id="er0" type="number" v-model.number="params.dielectric_bottom_epsilon"/><br>
      <label for="er1">er1: </label><input id="er1" type="number" v-model.number="params.dielectric_top_epsilon"/><br>
      <label for="h0">h0: </label><input id="h0" type="number" v-model.number="params.dielectric_bottom_height"/><br>
      <label for="h1">h1: </label><input id="h1" type="number" v-model.number="params.dielectric_top_height"/><br>
      <label for="w">w: </label><input id="w" type="number" v-model.number="params.signal_width"/><br>
      <label for="s">s: </label><input id="s" type="number" v-model.number="params.signal_separation"/><br>
      <label for="t">t: </label><input id="t" type="number" v-model.number="params.signal_height"/><br>
    </form>
    <button @click="update_params()">Update Parameters</button>
  </div>
  <div>
    <h2>Parameter search</h2>
    <label for="z0">Z0: </label><input id="z0" type="number" v-model.number="Z0_target"/><br>
    <label for="search_option">Parameter: </label>
    <select id="search_option" v-model="search_option">
      <option v-for="option in search_options" :key="option" :value="option">
        {{ option }}
      </option>
    </select><br>
    <button @click="run_parameter_search()">Run parameter search</button>
  </div>
  <div>
    <h2>Simulation Controls</h2>
    <form>
      <label for="threshold">Threshold: {{ (10**energy_threshold).toPrecision(3) }}</label><br>
      <input id="threshold" type="range" v-model.number="energy_threshold" min="-5" max="-1" step="0.1"/><br>
    </form>
    <button @click="run()">Run</button>
    <button @click="reset()">Reset</button>
  </div>

  <div v-if="run_result">
    <h2>Run Results</h2>
    <table>
      <tbody>
        <tr><td>Total steps</td><td>{{ run_result.total_steps }}</td></tr>
        <tr><td>Time taken</td><td>{{ `${(run_result.time_taken*1e3).toFixed(2)} ms` }}</td></tr>
        <tr><td>Step rate</td><td>{{ `${run_result.step_rate.toFixed(2)} steps/s` }}</td></tr>
        <tr><td>Cell rate</td><td>{{ `${(run_result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td></tr>
        <tr><td>Total cells</td><td>{{ run_result.total_cells }}</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="impedance_result">
    <h2>Impedance Results</h2>
    <table>
      <tbody>
        <tr><td>Z0</td><td>{{ `${impedance_result.Z0.toFixed(2)} Ω` }}</td></tr>
        <tr><td>Cih</td><td>{{ `${(impedance_result.Cih*1e12/100).toFixed(2)} pF/cm` }}</td></tr>
        <tr><td>Lh</td><td>{{ `${(impedance_result.Lh*1e9/100).toFixed(2)} nH/cm` }}</td></tr>
        <tr><td>propagation speed</td><td>{{ `${(impedance_result.propagation_speed/3e8*100).toFixed(2)}%` }}</td></tr>
        <tr><td>propagation delay</td><td>{{ `${(impedance_result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</td></tr>
      </tbody>
    </table>
  </div>

  <div>
    <h2>Field Viewer</h2>
    <canvas ref="field_canvas" style="width: 400px; height: 200px"></canvas>
  </div>

  <div>
    <h2>Debug Charts</h2>
    <canvas ref="dx_canvas" style="max-width: 500px; max-height: 200px"></canvas>
    <canvas ref="dy_canvas" style="max-width: 500px; max-height: 200px"></canvas>
    <canvas ref="search_canvas" style="max-width: 500px; max-height: 200px"></canvas>
  </div>
</template>

<style scoped>
table, th, td {
  border: 1px solid;
}
table {
  border-collapse: collapse;
}
th, td {
  padding: 0.25rem;
}
</style>
