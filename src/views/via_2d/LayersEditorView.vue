<script lang="ts" setup>
import { Editor } from "./editor.ts";
import { computed, defineProps } from "vue";
import { type LayerType } from "./stackup.ts";
import { Trash2Icon } from "lucide-vue-next";

const props = defineProps<{
  editor: Editor,
}>();

const editor = computed(() => props.editor);

const layers = computed(() => {
  return props.editor.stackup.layers.map((layer, index) => {
    return {
      id: layer.id,
      get type(): LayerType {
        return layer.type;
      },
      set type(type: LayerType) {
        editor.value.set_layer_type(index, type);
      },
      remove() {
        editor.value.remove_layer(index);
      },
    }
  });
});

const append_layer_to_end = computed(() => {
  if (!editor.value.can_append_layer()) return undefined;
  return () => editor.value.append_layer();
});

</script>

<template>
  <div class="grid grid-cols-[1.5rem_auto_2rem] gap-x-1 gap-y-0">
    <template v-for="(layer, layer_index) of layers" :key="layer.id">
      <div v-if="editor.can_add_before_layer(layer_index)" class="add-button col-span-3" @click="editor.add_before_layer(layer_index)"></div>
      <div class="flex flex-col justify-center font-medium ml-1">L{{ layer_index }}:</div>
      <select v-model="layer.type" class="w-full select">
        <template v-for="type of editor.get_layer_types(layer_index)" :key="type">
          <option :value="type">{{ type }}</option>
        </template>
      </select>
      <div class="flex flex-col justify-center">
        <button class="delete-button" @click="editor.remove_layer(layer_index)" :disabled="!editor.can_remove_layer(layer_index)">
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
