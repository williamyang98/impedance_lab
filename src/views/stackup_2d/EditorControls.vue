<script setup lang="ts">
import { StackupEditor, type LayerType } from "./editor.ts";
import { computed, defineProps } from "vue";
import { Trash2Icon } from "lucide-vue-next";

const { editor } = defineProps<{
  editor: StackupEditor,
}>();

const layers = computed(() => editor.layers.map((layer, index) => {
  const change_type: Partial<Record<LayerType, (() => void)>> = {};
  const types: LayerType[] = ["soldermask", "unmasked", "core", "prepreg"];
  const valid_types = [];
  for (const type of types) {
    const handler = editor.try_change_layer_type(index, type);
    if (handler == undefined) continue;
    change_type[type] = handler;
    valid_types.push(type);
  }

  return {
    delete: editor.try_delete_layer(index),
    add_above: editor.try_add_prepreg_layer(index),
    valid_types,
    type: computed<LayerType>({
      get() {
        return layer.type;
      },
      set(type: LayerType) {
        const handler = change_type[type];
        handler?.();
      },
    }),
    id: layer.id,
    parent: layer,
  };
}));

const append_layer_to_end = computed(() => editor.try_add_prepreg_layer(editor.layers.length));

</script>

<template>
  <div class="grid grid-cols-[1.5rem_auto_2rem] gap-x-1 gap-y-0">
    <template v-for="(layer, layer_index) in layers" :key="layer.id">
      <div v-if="layer.add_above" class="add-button col-span-3" @click="layer.add_above()"></div>
      <div class="flex flex-col justify-center font-medium ml-1">L{{ layer_index }}:</div>
      <select v-model="layer.type.value" class="w-full select">
        <template v-for="(type, index) in layer.valid_types" :key="index">
          <option :value="type">{{ type }}</option>
        </template>
      </select>
      <div class="flex flex-col justify-center">
        <button class="delete-button" @click="layer.delete?.()" :disabled="layer.delete === undefined">
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
  background-color: #99999977;
  cursor: cell;
  padding: none;
  user-select: none;
  margin-top: 0px;
  margin-bottom: 0px;
}

.add-button:hover {
  background-color: #0000bb77;
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
