<script setup lang="ts">
import { LayerStackup, type LayerType } from "./stackup.ts";
import { computed } from "vue";
import { Trash2Icon } from "@lucide/vue";

const props = defineProps<{
  stackup: LayerStackup,
}>();

const stackup = computed(() => props.stackup);

const layers = computed(() => stackup.value.layers.map((layer, layer_index) => {
  let add_before = undefined;
  if (stackup.value.can_add_inner_layer(layer_index)) {
    add_before = () => { stackup.value.add_inner_layer(layer_index); };
  }
  return {
    parent: layer,
    id: layer.id,
    delete: layer.delete,
    add_before,
    types: stackup.value.get_layer_types(layer_index),
    set type(type: LayerType) {
      stackup.value.set_layer_type(layer_index, type);
    },
    get type(): LayerType {
      return this.parent.type;
    },
  };
}));

const append_layer = computed(() => {
  let append_layer = undefined;
  const N = stackup.value.layers.length;
  if (stackup.value.can_add_inner_layer(N)) {
    append_layer = () => { stackup.value.add_inner_layer(N); };
  }
  return append_layer;
});

</script>

<template>
  <div class="grid grid-cols-[1.5rem_auto_2rem] gap-x-1 gap-y-0">
    <template v-for="(layer, layer_index) in layers" :key="layer.id">
      <div v-if="layer.add_before" class="add-button col-span-3" @click="layer.add_before()"></div>
      <div class="flex flex-col justify-center font-medium ml-1">L{{ layer_index }}:</div>
      <select v-model="layer.type" class="w-full select">
        <template v-for="type in layer.types" :key="type">
          <option :value="type">{{ type }}</option>
        </template>
      </select>
      <div class="flex flex-col justify-center">
        <button class="delete-button" @click="layer.delete?.()" :disabled="layer.delete === undefined">
          <Trash2Icon/>
        </button>
      </div>
    </template>
    <div v-if="append_layer" class="add-button col-span-3" @click="append_layer()"></div>
  </div>
</template>

<style scoped>
.add-button {
  height: 0.45rem;
  width: 100%;
  background-color: var(--color-base-300);
  cursor: cell;
  padding: none;
  user-select: none;
  margin-top: 0.15rem;
  margin-bottom: 0.15rem;
}

.add-button:hover {
  background-color: var(--color-primary);
}

button.delete-button {
  padding: 0.25rem;
  vertical-align: middle;
  width: 2rem;
  height: 2rem;
  width: calc(height);
  color: var(--color-error);
  background: var(--color-base-200);
  cursor: pointer;
  border: 1px solid var(--color-base-300);
  border-radius: 25%;
}

button.delete-button:disabled {
  cursor: not-allowed;
  color: var(--color-base-300);
}

button.delete-button:hover:not([disabled]) {
  background: var(--color-error);
  color: var(--color-base-200);
}

button.delete-button svg {
  width: 100%;
  height: 100%;
}
</style>
