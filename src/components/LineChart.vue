<script setup lang="ts">
import { ref, useTemplateRef, onMounted, defineExpose } from "vue";
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

const chart = ref<LineChart>();

function set_data(data: { x: number, y: number }[]) {
  chart.value?.set_data(data);
}

function set_xlabel(label: string) {
  chart.value?.set_xlabel(label);
}

function set_ylabel(label: string) {
  chart.value?.set_ylabel(label);
}

function update() {
  chart.value?.update();
}

const canvas = useTemplateRef<HTMLCanvasElement>("line-canvas");

onMounted(() => {
  chart.value?.destroy();
  if (canvas.value !== null) {
    chart.value = create_line_chart(canvas.value);
  }
})

defineExpose({
  set_data,
  set_xlabel,
  set_ylabel,
  update,
});
</script>

<template>
  <canvas ref="line-canvas" v-bind="$attrs"></canvas>
</template>
