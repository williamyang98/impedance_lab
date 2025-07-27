<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useRouter } from "vue-router";
import {
  create_colinear_stackup, create_broadside_stackup, layer_template_types,
} from "./stackup_templates.ts";
import VisualiserView from "../visualiser_2d/VisualiserView.vue";
import { type VisualiserConfig, get_default_viewer_config, StackupVisualiser } from "./stackup_to_visualiser.ts";
import { SearchIcon } from "lucide-vue-next";
import "fuzzysort";
import fuzzysort from "fuzzysort";

interface Tag {
  stackup: string;
  layer: string;
  trace: string;
};

function tag_to_title(tag: Tag): string {
  return [tag.stackup, tag.layer, tag.trace]
    .join(' ')
    .split(/[\s_]/)
    .map(word => {
      return (word.at(0)?.toUpperCase() ?? '') + word.substring(1).toLowerCase();
    })
    .join(' ');
}

function tag_to_query_string(tag: Tag): string {
  return `stackup=${tag.stackup}&layer=${tag.layer}&trace=${tag.trace}`;
}

interface Template {
  tag: Tag;
  title: string;
  prepared_title: Fuzzysort.Prepared;
  visualiser: StackupVisualiser;
}

const templates: Template[] = [];

const visualiser_config: VisualiserConfig = {
  ...get_default_viewer_config(),
  stackup_minimum_width: 200,
  stackup_minimum_x_padding: 50,
};


for (const layer_type of layer_template_types) {
  const stackups = {
    colinear: create_colinear_stackup(layer_type),
    broadside: create_broadside_stackup(layer_type),
  };
  for (const [stackup_type, stackup] of Object.entries(stackups)) {
    for (const trace_type of Object.keys(stackup.layouts)) {
      (stackup.selected_layout as string) = trace_type;
      const tag: Tag = {
        stackup: stackup_type,
        trace: trace_type,
        layer: layer_type,
      };
      const title = tag_to_title(tag);
      const prepared_title = fuzzysort.prepare(title);
      const visualiser = new StackupVisualiser(stackup, false, visualiser_config);
      templates.push({
        tag,
        title,
        prepared_title,
        visualiser,
      });
    }
  }
}

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
                <VisualiserView :visualiser="template.visualiser"/>
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
