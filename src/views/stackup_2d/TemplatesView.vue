<script setup lang="ts">
import { ref, watch, computed } from "vue";
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
import { SearchIcon } from "lucide-vue-next";
import "fuzzysort";
import fuzzysort from "fuzzysort";

const parameters = new StackupParameters();
interface Tag {
  type: string;
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

interface Template {
  tag: Tag;
  editor: StackupEditor;
  title: string;
  prepared_title: Fuzzysort.Prepared;
}

const templates: Template[] = [];

const stackup_types = [
  {
    name: "colinear",
    ctor: ColinearStackupEditor,
    layer_templates: colinear_layer_templates,
    trace_templates: colinear_trace_templates,
  },
  {
    name: "broadside",
    ctor: BroadsideStackupEditor,
    layer_templates: broadside_layer_templates,
    trace_templates: broadside_trace_templates,
  },
];

for (const stackup of stackup_types) {
  for (const [layer_name, layer_template] of Object.entries(stackup.layer_templates)) {
    for (const [trace_name, trace_template] of Object.entries(stackup.trace_templates)) {
      const editor = new stackup.ctor(parameters, trace_template, layer_template);
      const tag: Tag = {
        type: stackup.name,
        trace: trace_name,
        layer: layer_name,
      };
      const title = tag_to_title(tag);
      const prepared_title = fuzzysort.prepare(title);
      templates.push({
        editor,
        tag,
        title,
        prepared_title,
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

function get_template_url(tagged_editor: Template): string {
  const query_string = tag_to_query_string(tagged_editor.tag);
  const url = `/2d_stackup/editor?${query_string}`;
  return router.resolve(url).href;
}

interface SearchResult {
  template: Template;
  result: Fuzzysort.Result;
}
const search_string = ref<string | undefined>(undefined);
const search_results = ref<SearchResult[] | undefined>(undefined);
const sorted_templates = computed(() => {
  const results = search_results.value;
  if (results === undefined) return templates;
  return results.map(result => result.template);
});

function perform_search(search_string: string | undefined) {
  if (search_string === undefined || search_string.length === 0) {
    search_results.value = undefined;
    return;
  };

  const results: SearchResult[] = [];
  for (const template of templates) {
    const result = fuzzysort.single(search_string, template.prepared_title);
    if (result === null) continue;
    results.push({
      template,
      result,
    });
  }
  results.sort((a,b) => b.result.score-a.result.score);
  search_results.value = results;
}

watch(search_string, (new_search_string) => {
  perform_search(new_search_string);
});

</script>

<template>
<div class="flex flex-col h-full w-full gap-y-1">
  <div class="flex flex-row justify-center w-full my-1">
    <label class="input w-full sm:w-[25rem]">
      <SearchIcon class="w-[1.25rem] h-[1.25rem]"/>
      <input type="search" placeholder="Search" v-model="search_string"/>
    </label>
  </div>
  <div class="h-full w-full overflow-y-auto">
    <div class="w-full grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-x-2 gap-y-2">
      <template v-for="(template, index) in sorted_templates" :key="index">
        <a
          class="card card-border bg-base-100 hover:bg-base-300 select-none cursor-pointer"
          :href="get_template_url(template)"
        >
          <div class="card-body p-3">
            <div class="card-title w-full justify-center text-center">{{ tag_to_title(template.tag) }}</div>
            <div class="w-full h-full flex flex-col justify-center">
              <div class="w-full rounded-sm bg-white">
                <StackupViewer :stackup="template.editor.get_simulation_stackup()" :config="viewer_config"/>
              </div>
            </div>
          </div>
        </a>
      </template>
    </div>
    <div v-if="sorted_templates.length === 0" class="text-center py-2 w-full">
      <h1 class="text-2xl">No search results</h1>
    </div>
  </div>
</div>

</template>
