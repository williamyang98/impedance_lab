<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  // SelectGroup,
  // SelectLabel,
  SelectItem,
} from "@/components/ui/select"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  // TableCaption,
  TableCell,
  // TableHead,
  // TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
</script>

<script lang="ts">
import { defineComponent } from "vue";
import { Ndarray } from "../app/ndarray.ts";
import {
  Setup, init_wasm_module,
  type TransmissionLineParameters, type RunResult, type ImpedanceResult,
  type ParameterSearchConfig, type ParameterSearchResults, perform_parameter_search,
  WebgpuGrid2dRenderer,
} from "../app/app_2d.ts";
import LineChart from "./LineChart.vue";

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

type FieldAxis = "x" | "y" | "mag" | "vec";
function field_axis_to_id(axis: FieldAxis): number {
  switch (axis) {
  case "x": return 0;
  case "y": return 1;
  case "mag": return 2;
  case "vec": return 3;
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
  grid2d_renderer?: WebgpuGrid2dRenderer;
  display_axis: FieldAxis;
  display_scale: number;
}

export default defineComponent({
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
      grid2d_renderer: undefined,
      display_axis: "vec",
      display_scale: 1.0,
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
      this.upload_field_data();
      void this.render_field_data();
    },
    upload_field_data() {
      if (this.setup.grid === undefined) return;
      const field = this.setup.grid.e_field;
      this.grid2d_renderer?.update_texture(field);
    },
    async render_field_data() {
      const canvas = this.$refs.field_canvas as (HTMLCanvasElement | null);
      if (canvas === null) return;
      if (this.grid2d_renderer === undefined) return;
      const axis = field_axis_to_id(this.display_axis);
      this.grid2d_renderer?.update_canvas(canvas, this.display_scale, axis);
      await this.grid2d_renderer.wait_finished();
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
    const mount = async () => {
      // this.create_charts();
      await init_wasm_module();
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw Error("Couldn't request WebGPU adapter.");
      }
      const device = await adapter.requestDevice();
      if (!navigator.gpu) {
        throw Error("WebGPU not supported.");
      }
      this.grid2d_renderer = new WebgpuGrid2dRenderer(adapter, device);
      this.update_params();
    };
    void mount();
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
    display_axis(_new_value, _old_value) {
      void this.render_field_data();
    },
    display_scale(_new_value, _old_value) {
      void this.render_field_data();
    },
  },
});
</script>

<template>
  <div class="grid grid-flow-row grid-cols-3 gap-2">
    <Card class="gap-3 row-span-2">
      <CardHeader>
        <CardTitle>Transmission line parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid grid-cols-[auto_auto] gap-y-1 gap-x-2">
          <Label for="er0">εr bottom</Label>
          <Input id="er0" type="number" v-model.number="params.dielectric_bottom_epsilon"/>
          <Label for="er1">εr top</Label>
          <Input id="er1" type="number" v-model.number="params.dielectric_top_epsilon"/>
          <Label for="h0">Height bottom</Label>
          <Input id="h0" type="number" v-model.number="params.dielectric_bottom_height"/>
          <Label for="h1">Height top</Label>
          <Input id="h1" type="number" v-model.number="params.dielectric_top_height"/>
          <Label for="w">Trace width</Label>
          <Input id="w" type="number" v-model.number="params.signal_width"/>
          <Label for="s">Trace separation</Label>
          <Input id="s" type="number" v-model.number="params.signal_separation"/>
          <Label for="t">Trace thickness</Label>
          <Input id="t" type="number" v-model.number="params.signal_height"/>
        </form>
      </CardContent>
      <CardFooter class="flex justify-end mt-auto">
        <Button @click="update_params()">Calculate Impedance</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3 row-span-2">
      <CardHeader>
        <CardTitle>Parameter search</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid grid-cols-[auto_auto] gap-y-1 gap-x-2">
          <Label for="search_option">Parameter</Label>
          <Select id="search_option" v-model="search_option">
            <SelectTrigger class="w-auto">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="'er0'">εr bottom</SelectItem>
              <SelectItem :value="'er1'">εr top</SelectItem>
              <SelectItem :value="'er0+er1'">εr both</SelectItem>
              <SelectItem :value="'h0'">Height bottom</SelectItem>
              <SelectItem :value="'h1'">Height top</SelectItem>
              <SelectItem :value="'h0+h1'">Height both</SelectItem>
              <SelectItem :value="'w'">Trace width</SelectItem>
              <SelectItem :value="'s'">Trace separation</SelectItem>
              <SelectItem :value="'t'">Trace thickness</SelectItem>
            </SelectContent>
          </Select>
          <Label for="z0">Z0 target</Label>
          <Input id="z0" type="number" v-model.number="search_config.Z0_target"/>
          <Label for="v_lower">Lower bound</Label>
          <Input id="v_lower" type="number" v-model.number="search_config.v_lower"/>
          <Label for="v_upper">Upper bound</Label>
          <Input id="v_upper" type="number" v-model.number="search_config.v_upper"/>
          <Label for="error_tolerance">Error tolerance</Label>
          <Input id="error_tolerance" type="number" v-model.number="search_config.error_tolerance"/>
          <Label for="early_stop_threshold">Early stop threshold</Label>
          <Input id="early_stop_threshold" type="number" v-model.number="search_config.early_stop_threshold"/>
          <Label for="plateau_count">Plateau count</Label>
          <Input id="plateau_count" type="number" v-model.number="search_config.plateau_count"/>
        </form>
      </CardContent>
      <CardFooter class="flex justify-end mt-auto">
        <Button @click="run_parameter_search()">Search</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3 row-span-2">
      <CardHeader>
        <CardTitle>Results</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs default-value="impedance" class="w-[100%]" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="impedance">Impedance</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          </TabsList>
          <TabsContent value="impedance" v-if="impedance_result">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell class="font-medium">Z0</TableCell>
                  <TableCell>{{ `${impedance_result.Z0.toFixed(2)} Ω` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Cih</TableCell>
                  <TableCell>{{ `${(impedance_result.Cih*1e12/100).toFixed(2)} pF/cm` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Lh</TableCell>
                  <TableCell>{{ `${(impedance_result.Lh*1e9/100).toFixed(2)} nH/cm` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Propagation speed</TableCell>
                  <TableCell>{{ `${(impedance_result.propagation_speed/3e8*100).toFixed(2)}%` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Propagation delay</TableCell>
                  <TableCell>{{ `${(impedance_result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TabsContent>
          <TabsContent value="simulation" v-if="run_result">
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell class="font-medium">Total steps</TableCell>
                  <TableCell>{{ run_result.total_steps }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Time taken</TableCell>
                  <TableCell>{{ `${(run_result.time_taken*1e3).toFixed(2)} ms` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Step rate</TableCell>
                  <TableCell>{{ `${run_result.step_rate.toFixed(2)} steps/s` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Cell rate</TableCell>
                  <TableCell>{{ `${(run_result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell class="font-medium">Total cells</TableCell>
                  <TableCell>{{ run_result.total_cells }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <div class="mt-1">
              <form class="grid grid-cols-[8rem_auto] gap-y-1 gap-x-1">
                <Label for="threshold">Settling threshold</Label>
                <Input id="threshold" type="number" v-model.number="energy_threshold" min="-5" max="-1" step="0.1"/>
              </form>
              <div class="flex justify-end gap-x-2 mt-3">
                <Button @click="reset()" variant="outline">Reset</Button>
                <Button @click="run()">Run</Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
    <Card class="gap-3 col-span-3 row-span-1">
      <CardHeader>
        <CardTitle>Debug charts</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs default-value="field" class="w-[100%]" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-4">
            <TabsTrigger value="field">Field</TabsTrigger>
            <TabsTrigger value="param_search">Parameter Search</TabsTrigger>
            <TabsTrigger value="dx">dx</TabsTrigger>
            <TabsTrigger value="dy">dy</TabsTrigger>
          </TabsList>
          <TabsContent value="field">
            <form class="grid grid-cols-[8rem_auto_8rem_auto] gap-y-1 gap-x-1">
              <Label for="display_scale">Display scale</Label>
              <Input id="display_scale" type="number" v-model.number="display_scale" min="0" max="10" step="0.1"/>
              <Label for="display_axis">Axis</Label>
              <Select id="display_axis" v-model="display_axis">
                <SelectTrigger class="w-auto">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="'x'">Ex</SelectItem>
                  <SelectItem :value="'y'">Ey</SelectItem>
                  <SelectItem :value="'mag'">Magnitude</SelectItem>
                  <SelectItem :value="'vec'">Vector</SelectItem>
                </SelectContent>
              </Select>
            </form>
            <canvas ref="field_canvas" id="field_canvas" class="w-[100%] h-[100%]"></canvas>
          </TabsContent>
          <TabsContent value="param_search">
            <LineChart ref="param_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
          <TabsContent value="dx">
            <LineChart ref="dx_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
          <TabsContent value="dy">
            <LineChart ref="dy_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
canvas#field_canvas {
  image-rendering: pixelated;
}
</style>
