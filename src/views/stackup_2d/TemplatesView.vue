<script setup lang="ts">
import { useRouter } from "vue-router";
import StackupViewer from "./StackupViewer.vue";
import { StackupParameters } from "./parameters.ts";
import {
  StackupEditor,
  BroadsideStackupEditor,
  ColinearStackupEditor,
} from "./editor.ts";
import {
  broadside_layer_templates, broadside_trace_templates,
  colinear_layer_templates, colinear_trace_templates,
} from "./editor_templates.ts";
import { type ViewerConfig, get_default_viewer_config } from "./viewer";

const parameters = new StackupParameters();
interface Tag {
  type: "broadside" | "colinear";
  layer: string;
  trace: string;
};

function tag_to_title(tag: Tag): string {
  return [tag.type, tag.layer, tag.trace]
    .join(' ')
    .split(' ')
    .map(word => {
      return word.at(0)?.toUpperCase() + word.substring(1).toLowerCase();
    })
    .join(' ');
}

function tag_to_query_string(tag: Tag): string {
  return `type=${tag.type}&layer=${tag.layer}&trace=${tag.trace}`;
}

interface TaggedEditor {
  tag: Tag;
  editor: StackupEditor;
}

const editors: TaggedEditor[] = [];

{
  for (const [layer_name, layer_template] of Object.entries(broadside_layer_templates)) {
    for (const [trace_name, trace_template] of Object.entries(broadside_trace_templates)) {
      const editor = new BroadsideStackupEditor(parameters, trace_template, layer_template);
      editors.push({
        editor,
        tag: {
          type: "broadside",
          trace: trace_name,
          layer: layer_name,
        },
      });
    }
  }
}

{
  for (const [layer_name, layer_template] of Object.entries(colinear_layer_templates)) {
    for (const [trace_name, trace_template] of Object.entries(colinear_trace_templates)) {
      const editor = new ColinearStackupEditor(parameters, trace_template, layer_template);
      editors.push({
        editor,
        tag: {
          type: "colinear",
          trace: trace_name,
          layer: layer_name,
        },
      });
    }
  }
}

const viewer_config: ViewerConfig = {
  ...get_default_viewer_config(),
  stackup_minimum_width: 150,
  stackup_minimum_x_padding: 25,
};

const router = useRouter();

async function on_editor_select(tagged_editor: TaggedEditor) {
  // TODO: need to store relevant metadata to create query parameters for editor route
  const query_string = tag_to_query_string(tagged_editor.tag);
  await router.push(`/stackup_2d/editor?${query_string}`);
}

</script>

<template>
<div class="w-full grid grid-cols-4 gap-x-2 gap-y-2">
  <template v-for="(tagged_editor, index) in editors" :key="index">
    <div
      class="card card-border bg-base-100 select-none cursor-pointer"
      @click="on_editor_select(tagged_editor)"
    >
      <div class="card-body p-3">
        <div class="card-title">{{ tag_to_title(tagged_editor.tag) }}</div>
        <div class="w-full h-full flex flex-col justify-center">
          <StackupViewer :stackup="tagged_editor.editor.get_simulation_stackup()" :config="viewer_config"/>
        </div>
      </div>
    </div>
  </template>
</div>
</template>
