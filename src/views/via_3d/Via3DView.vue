<script lang="ts" setup>
import { toRaw, ref, useTemplateRef, watch } from 'vue';
import { providers } from '../../providers/providers';
import { CpuGrid, GpuGrid, GpuEngine } from "./grid.ts";
import { GridBuilder, type Region, type GridBuilderConfig, type GridBuilderPadding } from './grid_builder.ts';
import ExportView from './ExportView.vue';
import RendererView from './RendererView.vue';
import TabsView from '../../utility/TabsView.vue';
import { Profiler } from '../../utility/profiler.ts';
import ProfilerFlameChart from '../../utility/ProfilerFlameChart.vue';

const gpu_device = toRaw(providers.gpu_device.value);
const toast = providers.toast_manager.value;

const profiler = ref<Profiler | undefined>(undefined);

function create_grid(): GridBuilder {
  const regions: Region[] = [
    // reference planes
    {
      type: "voltage",
      voltage: 0,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0 },
          end: { z: 0.1 },
          config: {},
        }
      ],
    },
    {
      type: "dielectric",
      epsilon: 4.1,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0.05 },
          end: { z: 0.25 },
          config: {},
        }
      ],
    },
    {
      type: "voltage",
      voltage: 0,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0.2 },
          end: { z: 0.3 },
          config: {},
        }
      ],
    },
    {
      type: "dielectric",
      epsilon: 4.6,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0.25 },
          end: { z: 0.45 },
          config: {},
        }
      ],
    },
    {
      type: "voltage",
      voltage: 0,
      shapes: [
        {
          type: "cuboid",
          start: { z: 0.4 },
          end: { z: 0.5 },
          config: {},
        }
      ],
    },
    // antipad
    {
      type: "voltage",
      voltage: null,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0,
          },
          radius: 0.5,
          length: 0.5,
          axis: "z",
          config: {},
        }
      ],
    },
    // via
    {
      type: "voltage",
      voltage: 1,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0,
          },
          radius: 0.25,
          length: 0.5,
          axis: "z",
          config: {},
        }
      ],
    },
    // pads
    {
      type: "voltage",
      voltage: 1,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0,
          },
          radius: 0.3,
          length: 0.1,
          axis: "z",
          config: {},
        }
      ],
    },
    {
      type: "voltage",
      voltage: 1,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0.4,
          },
          radius: 0.3,
          length: 0.1,
          axis: "z",
          config: {},
        }
      ],
    },
    // drill through via
    {
      type: "voltage",
      voltage: null,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0,
          },
          radius: 0.2,
          length: 0.5,
          axis: "z",
          config: {},
        }
      ],
    },
    {
      type: "dielectric",
      epsilon: 3.3,
      shapes: [
        {
          type: "cylinder",
          center: {
            x: 0, y: 0, z: 0,
          },
          radius: 0.2,
          length: 0.5,
          axis: "z",
          config: {},
        }
      ],
    },
  ];

  const config: GridBuilderConfig = {
    minimum_grid_resolution: 1e-5,
    padding_size_multiplier: 1,
    max_x_ratio: 0.7,
    min_x_subdivisions: 5,
    max_y_ratio: 0.7,
    min_y_subdivisions: 5,
    max_z_ratio: 0.7,
    min_z_subdivisions: 5,
  };
  const padding: GridBuilderPadding = {
    x_left: true,
    x_right: true,
    y_top: true,
    y_bottom: true,
    z_top: true,
    z_bottom: true,
  };

  const new_profiler = new Profiler();
  const builder = new GridBuilder(regions, config, padding, new_profiler);
  new_profiler.end_all();
  profiler.value = new_profiler;
  return builder;
}

const grid_builder = create_grid();
const cpu_grid: CpuGrid = grid_builder.grid;
const grid_size = cpu_grid.size;

const gpu_grid = new GpuGrid(grid_size, gpu_device);
gpu_grid.from_cpu(cpu_grid);
const gpu_engine = new GpuEngine(gpu_device);

const total_steps = ref<number>(128);

type RunStatus =
  { type: "running", curr_step: number, total_steps: number } |
  { type: "error", error: string };
const run_status = ref<RunStatus | undefined>(undefined);
const is_running = ref<boolean>(false);
const renderer_view = useTemplateRef<typeof RendererView>("renderer_view");
watch(renderer_view, (view) => {
  if (view === null) return;
  view.copy_z = Math.round(grid_size.z/2);
});

async function run() {
  if (is_running.value) {
    return;
  }
  is_running.value = true;
  try {
    const stride_size = 64;
    const total_strides = Math.ceil(total_steps.value/stride_size);
    run_status.value = {
      type: "running",
      curr_step: 0,
      total_steps: stride_size*total_strides,
    };

    for (let i = 0; i < total_strides; i++) {
      const command_encoder = gpu_device.createCommandEncoder();
      gpu_engine.jacobi_smooth(command_encoder, gpu_grid, stride_size);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();
      run_status.value.curr_step = (i+1)*stride_size;
    }
    toast.info(`GPU engine ran ${run_status.value.total_steps} steps`);

    {
      console.log("Calculating residual");
      const command_encoder = gpu_device.createCommandEncoder();
      gpu_engine.calculate_residual(command_encoder, gpu_grid);
      gpu_device.queue.submit([command_encoder.finish()]);
      await gpu_device.queue.onSubmittedWorkDone();
    }

    renderer_view.value?.refresh();

    await gpu_grid.to_cpu(cpu_grid);
    await gpu_device.queue.onSubmittedWorkDone();
  } catch (error) {
    toast.error(`run failed with: ${String(error)}`);
    run_status.value = { type: "error", error: String(error) };
  }
  is_running.value = false;
}

</script>

<template>
<TabsView :initial_tab="'0'">
  <template #h-0>Calculator</template>
  <template #b-0>
    <div class="flex flex-col w-full h-full">
      <div class="flex flex-row items-center">
        <input class="input" type="number" v-model.number="total_steps" min="0" step="1"/>
        <button class="btn" @click="run" :disabled="is_running">Run</button>
        <div class="rounded-sm w-full h-[2.0rem] bg-slate-300 border-1 border-slate-300 border-sm">
          <template v-if="run_status?.type === 'running'">
            <div
              class="rounded-sm h-full bg-green-400 text-center"
              :style="{ width: `${(run_status.curr_step/run_status.total_steps*100).toFixed(2)}%` }"
            >
              <span class="align-middle px-2 font-medium">{{ run_status.curr_step }}/{{ run_status.total_steps }}</span>
            </div>
          </template>
          <template v-if="run_status?.type === 'error'">
            <div class="rounded-sm h-full bg-error text-center w-full">
              <span class="align-middle px-2 font-medium">{{ run_status.error }}</span>
            </div>
          </template>
        </div>
      </div>
      <div class="w-full h-full min-h-0">
        <RendererView :grid="gpu_grid" ref="renderer_view"/>
      </div>
    </div>
  </template>
  <template #h-1>Export</template>
  <template #b-1>
    <div class="w-full flex justify-center-safe overflow-x-auto">
      <ExportView :grid="cpu_grid" class="w-fit border border-base-300 bg-base-100"/>
    </div>
  </template>
  <template #h-2>Profiler</template>
  <template #b-2>
    <div class="w-full h-full">
      <ProfilerFlameChart v-if="profiler" :profiler="profiler"/>
    </div>
  </template>
</TabsView>
</template>
