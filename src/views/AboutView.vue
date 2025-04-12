<script lang="ts">
import { defineComponent } from "vue";
import {
  Setup, type TransmissionLineParameters, type RunResult, type ImpedanceResult,
  create_grid_layout, init_wasm_module,
} from "../app/app_2d.ts";

interface ComponentData {
  setup: Setup;
  params: TransmissionLineParameters;
  run_result?: RunResult;
  impedance_result?: ImpedanceResult;
  energy_threshold: number;
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
      run_result: undefined,
      impedance_result: undefined,
      energy_threshold: -2.3,
    };
  },
  methods: {
    update_params() {
      this.reset();
      this.setup.update_params(this.params);
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
  },
  async mounted() {
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
