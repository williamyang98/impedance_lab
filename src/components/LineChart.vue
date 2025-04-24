<script lang="ts">
import { defineComponent } from "vue";
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

interface ComponentData {
  chart?: LineChart;
}

export default defineComponent({
  data(): ComponentData {
    return {
      chart: undefined,
    }
  },
  methods: {
    set_data(data: { x: number, y: number }[]) {
      this.chart?.set_data(data);
    },
    set_xlabel(label: string) {
      this.chart?.set_xlabel(label);
    },
    set_ylabel(label: string) {
      this.chart?.set_ylabel(label);
    },
    update() {
      this.chart?.update();
    }
  },
  mounted() {
    this.chart?.destroy();
    if (this.$refs.canvas) {
      this.chart = create_line_chart(this.$refs.canvas as HTMLCanvasElement);
    }
  }
})
</script>

<template>
  <canvas ref="canvas" v-bind="$attrs"></canvas>
</template>
