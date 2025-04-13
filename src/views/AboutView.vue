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
  type TransmissionLineParameters, type RunResult, type ImpedanceResult, create_grid_layout,
  type ParameterSearchConfig, type ParameterSearchResults, perform_parameter_search,
} from "../app/app_2d.ts";
import LineChart from "./LineChart.vue";

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
    update_charts() {
      function create_markers(arr: Ndarray): { x: number, y: number }[] {
        return Array.from(arr.data).map((e,i) => {
          return { x: i, y: e }
        });
      }
      if (this.$refs.dx_chart) {
        const chart = this.$refs.dx_chart as typeof LineChart;
        chart.set_data(create_markers(this.setup.grid.dx));
        chart.set_ylabel("dx");
        chart.update();
      }
      if (this.$refs.dy_chart) {
        const chart = this.$refs.dy_chart as typeof LineChart;
        chart.set_data(create_markers(this.setup.grid.dy));
        chart.set_ylabel("dy");
        chart.update();
      }
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
      this.update_params();
    };
    void mount();
  },
  beforeUnmount() {

  },
  watch: {
    dx_canvas(old_canvas, new_canvas) {
      console.log(old_canvas, new_canvas);
    }
  },
});
</script>

<template>
  <div class="grid grid-flow-dense grid-cols-3 gap-2">
    <Card class="gap-3 row-span-2">
      <CardHeader>
        <CardTitle>Transmission line parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid grid-cols-[6rem_auto] gap-y-1 gap-x-2">
          <Label for="er0">Dielectric εr bottom</Label>
          <Input id="er0" type="number" v-model.number="params.dielectric_bottom_epsilon"/>
          <Label for="er1">Dielectric εr top</Label>
          <Input id="er1" type="number" v-model.number="params.dielectric_top_epsilon"/>
          <Label for="h0">Dielectric height bottom</Label>
          <Input id="h0" type="number" v-model.number="params.dielectric_bottom_height"/>
          <Label for="h1">Dielectric height top</Label>
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
        <Button @click="update_params()">Update Parameters</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3">
      <CardHeader>
        <CardTitle>Parameter search</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid grid-cols-[6rem_auto] gap-y-1 gap-x-2">
          <Label for="z0">Z0</Label>
          <Input id="z0" type="number" v-model.number="Z0_target"/>
          <Label for="search_option">Parameter</Label>
          <Select id="search_option" v-model="search_option">
            <SelectTrigger class="w-auto">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in search_options" :key="option" :value="option">
                {{ option }}
              </SelectItem>
            </SelectContent>
          </Select>
        </form>
      </CardContent>
      <CardFooter class="flex justify-end mt-auto">
        <Button @click="run_parameter_search()">Search</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3">
      <CardHeader>
        <CardTitle>Simulation Controls</CardTitle>
      </CardHeader>
      <CardContent>
        <form class="grid grid-cols-[6rem_auto] gap-y-1 gap-x-2">
          <Label for="threshold">Settling threshold</Label>
          <Input id="threshold" type="number" v-model.number="energy_threshold" min="-5" max="-1" step="0.1"/>
        </form>
      </CardContent>
      <CardFooter class="flex justify-end gap-x-2 mt-auto">
        <Button @click="reset()" variant="outline">Reset</Button>
        <Button @click="run()">Run</Button>
      </CardFooter>
    </Card>
    <Card class="gap-3 row-span-2" v-if="run_result">
      <CardHeader>
        <CardTitle>Run Results</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
    <Card class="gap-3 row-span-2" v-if="impedance_result">
      <CardHeader>
        <CardTitle>Impedance Results</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
    <Card class="gap-3 col-span-2 row-span-2">
      <CardHeader>
        <CardTitle>Field viewer</CardTitle>
      </CardHeader>
      <CardContent>
        <canvas ref="field_canvas" class="w-[100%] h-[100%]"></canvas>
      </CardContent>
    </Card>
    <Card class="gap-3 col-span-2 row-span-2">
      <CardHeader>
        <CardTitle>Debug charts</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs default-value="dx" class="w-[100%]" :unmount-on-hide="false">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="dx">dx</TabsTrigger>
            <TabsTrigger value="dy">dy</TabsTrigger>
            <TabsTrigger value="param_search">Parameter Search</TabsTrigger>
          </TabsList>
          <TabsContent value="dx">
            <LineChart ref="dx_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
          <TabsContent value="dy">
            <LineChart ref="dy_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
          <TabsContent value="param_search">
            <LineChart ref="param_chart" class="w-[100%] h-[100%]"></LineChart>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
</style>
