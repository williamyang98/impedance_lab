<script setup lang="ts">
import { type RunResult } from "../../engine/electrostatic_2d.ts";
import { defineProps } from "vue";

const _props = defineProps<{
  result: RunResult,
}>();

</script>

<template>
<table class="table">
  <tbody>
    <tr>
      <td class="font-medium">Total steps</td>
      <td>{{ result.total_steps }}</td>
    </tr>
    <tr>
      <td class="font-medium">Time taken</td>
      <td>{{ `${(result.time_taken*1e3).toFixed(2)} ms` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Step rate</td>
      <td>{{ `${result.step_rate.toFixed(2)} steps/s` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Cell rate</td>
      <td>{{ `${(result.cell_rate*1e-6).toFixed(2)} Mcells/s` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Total cells</td>
      <td>{{ result.total_cells }}</td>
    </tr>
  </tbody>
</table>
</template>
