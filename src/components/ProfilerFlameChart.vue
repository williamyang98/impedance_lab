<script setup lang="ts">
import { Profiler, ProfilerTrace } from "../utility/profiler.ts";
import { defineProps, ref, computed, watch } from "vue";

const props = defineProps<{
  profiler: Profiler
}>();

interface Span {
  trace: ProfilerTrace;
  width: number;
  left: number;
}

interface Row {
  spans: Span[];
}

class FlameChart {
  rows: Row[];

  constructor(root_trace: ProfilerTrace) {
    const root_left = root_trace.start_ms;
    const root_right = root_trace.end_ms;
    const root_width = root_right-root_left;

    this.rows = [];
    this.draw_trace(root_trace, 0, root_left, root_width);
  }

  draw_trace(trace: ProfilerTrace, level: number, root_left: number, root_width: number) {
    let row: Row | undefined = undefined;
    if (this.rows.length <= level) {
      row = { spans: [] };
      this.rows.push(row);
    } else {
      row = this.rows[level];
    }
    const abs_width = trace.end_ms-trace.start_ms;
    const rel_width = abs_width/root_width;
    const rel_left = (trace.start_ms-root_left)/root_width;
    const span: Span = {
      trace,
      width: rel_width*100,
      left: rel_left*100,
    };
    row.spans.push(span);
    for (const child of trace.sub_traces) {
      this.draw_trace(child, level+1, root_left, root_width);
    }
  }
}

const root_trace = computed(() => props.profiler.root_trace);
const base_trace = ref<ProfilerTrace>(props.profiler.root_trace);
const flame_chart = computed(() => new FlameChart(base_trace.value));

watch(root_trace, (new_root) => {
  base_trace.value = new_root;
});

function select_trace(trace: ProfilerTrace) {
  if (base_trace.value === trace) {
    base_trace.value = props.profiler.root_trace;
  } else {
    base_trace.value = trace;
  }
}

function get_trace_info(trace: ProfilerTrace) {
  const info: { label: string, description: string }[] = [];
  const push_info = (label: string, description: string) => {
    info.push({ label, description });
  }
  const rebase_timestamp = (timestamp: number): number => {
    return timestamp - root_trace.value.start_ms;
  }
  if (trace.label) push_info("Label", trace.label);
  if (trace.description) push_info("Description", trace.description);
  push_info("Elapsed", `${trace.elapsed_ms.toPrecision(2)} ms`);
  push_info("Start", `${rebase_timestamp(trace.start_ms).toPrecision(2)} ms`);
  push_info("End", `${rebase_timestamp(trace.end_ms).toPrecision(2)} ms`);
  return info;
}

</script>

<template>
<div class="chart-row" v-for="(row, row_index) of flame_chart.rows" :key="row_index">
  <template v-for="(span, span_index) of row.spans" :key="span_index">
    <div
      class="chart-span"
      :style="`width: ${span.width.toFixed(2)}%; left: ${span.left.toFixed(2)}%`"
      @click="select_trace(span.trace)"
    >
      <div class="chart-span-inner">
        {{ span.trace.label }}
        <span v-if="row_index == 0 && root_trace !== base_trace">*</span>
        <div class="chart-tooltip">
          <div class="card card-border bg-base-100">
            <div class="card-body p-2">
              <table class="table table-sm">
                <tbody>
                  <tr v-for="(trow, trow_index) of get_trace_info(span.trace)" :key="trow_index">
                    <td class="font-medium">{{ trow.label }}</td>
                    <td>{{ trow.description }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</div>
</template>

<style scoped>
.chart-row {
  position: relative;
  width: 100%;
  height: 2rem;
  display: flex;
  flex-direction: row;
}

.chart-span {
  position: absolute;
  padding-top: 1px;
  padding-bottom: 1px;
  padding-left: 1px;
  padding-right: 1px;
}

.chart-span-inner {
  border: 1px solid black;
  padding: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
}

.chart-tooltip {
  display: none;
  position: absolute;
  z-index: 2;
}

.chart-span-inner:hover .chart-tooltip {
  display: block;
}

</style>
