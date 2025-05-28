<script setup lang="ts">
import { VerticalStackupEditor, type LayerType } from "./stackup_templates.ts";
import StackupViewer from "./StackupViewer.vue";
import { computed, ref, defineProps } from "vue";

const { editor } = defineProps<{
  editor: VerticalStackupEditor,
}>();
const is_hover = ref<boolean>(false);
const viewer_stackup = computed(() => {
  if (is_hover.value) {
    return editor.get_viewer_stackup();
  } else {
    return editor.get_simulation_stackup();
  }
});

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
<div class="grid grid-cols-2">
  <!--Layer editor-->
  <div class="bg-base-100 border-base-300 border-sm border-1">
    <div class="grid grid-cols-[1.25rem_auto_1.5rem] gap-x-1">
      <template v-for="layer in layers" :key="layer.id">
        <div v-if="layer.add_above" class="add-button col-span-3" @click="layer.add_above()"></div>
        <b>L{{ layer.id }}:</b>
        <select v-model="layer.type.value" class="w-full min-w-[7rem]">
          <template v-for="(type, index) in layer.valid_types" :key="index">
            <option :value="type">{{ type }}</option>
          </template>
        </select>
        <div class="w-full">
          <button v-if="layer.delete" class="btn btn-xs btn-outline btn-error" @click="layer.delete()">x</button>
        </div>
      </template>
      <div v-if="append_layer_to_end" class="add-button col-span-3" @click="append_layer_to_end()"></div>
    </div>
  </div>
  <div class="w-full h-full" @mouseenter="is_hover = true" @mouseleave="is_hover = false">
    <StackupViewer :stackup="viewer_stackup"/>
  </div>
</div>
</template>

<style scoped>
.add-button {
  height: 0.35rem;
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
</style>
