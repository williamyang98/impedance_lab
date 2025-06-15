<script setup lang="ts">
import { Profiler, ProfilerTrace } from "../utility/profiler.ts";
import { defineProps, ref, useTemplateRef, computed, watch } from "vue";

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
    const abs_width = trace.end_ms-trace.start_ms;
    const rel_width = abs_width/root_width;
    const rel_left = (trace.start_ms-root_left)/root_width;

    let row: Row | undefined = undefined;
    if (this.rows.length <= level) {
      row = { spans: [] };
      this.rows.push(row);
    } else {
      row = this.rows[level];
    }
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

function rebase_timestamp(timestamp: number): number {
  return timestamp - root_trace.value.start_ms;
}

function get_span_colour(span: Span): string {
  const beta = span.width/100;
  const r = (1-beta)*0.7 + beta*1.0;
  const g = (1-beta)*1.0 + beta*0.5;
  const b = (1-beta)*0.3 + beta*0.2;

  function to_string(v: number): string {
    return (v*256).toFixed(0);
  }

  return `rgb(${to_string(r)},${to_string(g)},${to_string(b)})`;
}

// align tooltip
const viewport_elem = useTemplateRef<HTMLElement>("flamechart-viewport");
const is_tooltip_right_aligned = ref<boolean>(false);
function on_span_enter(ev: MouseEvent) {
  const root_elem = viewport_elem.value;
  if (root_elem === null) return;
  const span_elem = ev.target as (Element | null);
  if (span_elem === null) return;
  const tooltip_elem = span_elem.querySelector(".chart-tooltip");
  if (tooltip_elem === null) return;
  const root_rect = root_elem.getBoundingClientRect();
  const span_rect = span_elem.getBoundingClientRect();
  const tooltip_rect = tooltip_elem.getBoundingClientRect();
  const calculated_right = span_rect.left + tooltip_rect.width*1.5;
  is_tooltip_right_aligned.value = calculated_right > root_rect.right;
}

</script>

<template>
<div class="w-full" ref="flamechart-viewport">
  <div class="chart-row" v-for="(row, row_index) of flame_chart.rows" :key="row_index">
    <template v-for="(span, span_index) of row.spans" :key="span_index">
      <div
        class="chart-span"
        :style="`width: ${span.width.toFixed(2)}%; left: ${span.left.toFixed(2)}%`"
        @click="select_trace(span.trace)"
      >
        <div
          class="chart-span-inner"
          :style="`background: ${get_span_colour(span)}`"
          @mouseenter="ev => on_span_enter(ev)"
        >
          <span class="chart-span-label">
            {{ span.trace.label }}
            <span v-if="row_index == 0 && root_trace !== base_trace">*</span>
          </span>
          <div
            class="chart-tooltip"
            :style="`${is_tooltip_right_aligned ? 'right: 0' : ''}`"
          >
            <div class="card card-border bg-base-100 w-full">
              <div class="card-body p-2">
                <table class="table table-sm">
                  <colgroup>
                    <col class="w-fit">
                    <col class="w-full">
                  </colgroup>
                  <tbody>
                    <tr class="table-separator">
                      <td class="font-medium text-base" colspan="2">
                        {{ span.trace.label }} ({{ span.width.toFixed(0) }}%)
                      </td>
                    </tr>
                    <tr v-if="span.trace.description">
                      <td class="font-medium">Description</td>
                      <td>{{ span.trace.description }}</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Elapsed</td>
                      <td>{{ span.trace.elapsed_ms.toFixed(2) }} ms</td>
                    </tr>
                    <tr>
                      <td class="font-medium">Start</td>
                      <td>{{ rebase_timestamp(span.trace.start_ms).toFixed(2) }} ms</td>
                    </tr>
                    <tr :class="`${span.trace.metadata ? 'table-separator' : ''}`">
                      <td class="font-medium">End</td>
                      <td>{{ rebase_timestamp(span.trace.end_ms).toFixed(2) }} ms</td>
                    </tr>
                    <template v-if="span.trace.metadata">
                      <tr v-for="([key, value], row_index) in Object.entries(span.trace.metadata)" :key="row_index">
                        <td class="font-medium">{{ key }}</td>
                        <td>{{ value }}</td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
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
  padding: 0.5px;
  height: 100%;
}

.chart-span-inner {
  width: 100%;
  height: 100%;
  border: solid 1px slategray;
  border-radius: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  justify-content: center;
  padding-top: 2px;
  padding-bottom: 2px;
  padding-left: 3px;
  padding-right: 3px;
  cursor: pointer;
}

.chart-tooltip {
  display: none;
  position: absolute;
  z-index: 2;
  min-width: 20rem;
}

.chart-span-inner:hover {
  border-width: 2px;
}

.chart-span-inner:hover .chart-span-label {
  font-weight: bold;
}

.chart-span-inner:hover .chart-tooltip {
  display: block;
}

.table-separator {
  border-bottom: 2px solid var(--color-base-300);
}

</style>
