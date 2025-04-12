<script lang="ts">
import { defineComponent } from "vue";
import {
  Setup, type TransmissionLineParameters, type RunResult, type ImpedanceResult,
  create_grid_layout, init_wasm_module,
} from "../app/app_2d.ts";
import Chart from 'chart.js/auto';

interface LineChart {
  set_data: (data: number[]) => void;
  set_label: (label: string) => void;
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
    set_data: (data: number[]) => {
      const markers = data.map((e,i) => {
        return { x: i, y: e };
      });
      chart.data.datasets[0].data = markers;
    },
    set_label: (label: string) => {
      chart.data.datasets[0].label = label;
      let title = chart.options.scales?.y?.title?.text;
      if (title) title = label;
    },
    update: () => {
      chart.update();
    },
    destroy: () => {
      chart.destroy();
    },
  }
}

interface ComponentData {
  setup: Setup;
  params: TransmissionLineParameters;
  run_result?: RunResult;
  impedance_result?: ImpedanceResult;
  energy_threshold: number;
  dx_chart?: LineChart,
  dy_chart?: LineChart,
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
      this.dx_chart = create_line_chart(this.$refs.dx_canvas as HTMLCanvasElement);
      this.dy_chart = create_line_chart(this.$refs.dy_canvas as HTMLCanvasElement);
    },
    update_charts() {
      this.dx_chart?.set_data(Array.from(this.setup.grid.dx.data));
      this.dy_chart?.set_data(Array.from(this.setup.grid.dy.data));
      this.dx_chart?.set_label("dx");
      this.dy_chart?.set_label("dy");
      this.dx_chart?.update();
      this.dy_chart?.update();
    }
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
