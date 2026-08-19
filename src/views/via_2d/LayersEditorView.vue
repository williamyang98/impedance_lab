<script lang="ts" setup>
import { computed } from "vue";
import { Stackup, type LayerType } from "./stackup.ts";
import { Trash2Icon } from "@lucide/vue";

const props = defineProps<{
  stackup: Stackup,
}>();

const stackup = computed(() => props.stackup);

const layers = computed(() => {
  return props.stackup.layers.map((layer, index) => {
    let prepend = undefined;
    if (stackup.value.can_add_before_layer(index)) {
      prepend = () => { stackup.value.add_before_layer(index); };
    }
    let remove = undefined;
    if (stackup.value.can_remove_layer(index)) {
      remove = () => { stackup.value.remove_layer(index); };
    }
    return {
      id: layer.id,
      get types(): LayerType[] {
        return stackup.value.get_layer_types(index);
      },
      get type(): LayerType {
        return layer.type;
      },
      set type(type: LayerType) {
        stackup.value.set_layer_type(index, type);
      },
      prepend,
      remove,
    }
  });
});

const append_layer_to_end = computed(() => {
  let append = undefined;
  if (stackup.value.can_append_layer()) {
    append = () => { stackup.value.append_layer(); };
  }
  return append;
});

</script>

<template>
  <div class="grid grid-cols-[1.5rem_auto_2rem] gap-x-1 gap-y-0">
    <template v-for="(layer, layer_index) of layers" :key="layer.id">
      <div v-if="layer.prepend" class="add-button col-span-3" @click="layer.prepend()"></div>
      <div class="flex flex-col justify-center font-medium ml-1">L{{ layer_index }}:</div>
      <select v-model="layer.type" class="w-full select">
        <template v-for="type of layer.types" :key="type">
          <option :value="type">{{ type }}</option>
        </template>
      </select>
      <div class="flex flex-col justify-center">
        <button class="delete-button" @click="layer.remove?.()" :disabled="layer.remove === undefined">
          <Trash2Icon/>
        </button>
      </div>
    </template>
    <div v-if="append_layer_to_end" class="add-button col-span-3" @click="append_layer_to_end()"></div>
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
