<script setup lang="ts">
import { type ImpedanceResult } from "../../engine/electrostatic_2d.ts";
import { defineProps } from "vue";

const _props = defineProps<{
  result: ImpedanceResult,
}>();

</script>

<template>
<table class="table">
  <tbody>
    <tr>
      <td class="font-medium">Z0</td>
      <td>{{ `${result.Z0.toFixed(2)} Ω` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Cih</td>
      <td>{{ `${(result.Cih*1e12/100).toFixed(2)} pF/cm` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Lh</td>
      <td>{{ `${(result.Lh*1e9/100).toFixed(2)} nH/cm` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Propagation speed</td>
      <td>{{ `${(result.propagation_speed/3e8*100).toFixed(2)}%` }}</td>
    </tr>
    <tr>
      <td class="font-medium">Propagation delay</td>
      <td>{{ `${(result.propagation_delay*1e12/100).toFixed(2)} ps/cm` }}</td>
    </tr>
  </tbody>
              </table>
</template>
