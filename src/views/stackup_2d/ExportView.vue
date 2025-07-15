<script lang="ts" setup>
import { defineProps, toRaw, computed } from "vue";
import { Grid } from "../../app/electrostatic_2d/grid.ts";
import { DownloadIcon } from "lucide-vue-next";
import { Uint8ArrayNdarrayWriter } from "../../utility/ndarray.ts";
import { type IModuleNdarray, ModuleNdarrayWriter } from "../../utility/module_ndarray.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { ZipFile } from "../../wasm/index.ts";
import { providers } from "../../providers/providers.ts";

const toast = providers.toast_manager.value;

const props = defineProps<{
  grid: Grid,
}>();

interface DownloadLink {
  name: string;
  data: IModuleNdarray;
}

const download_links = computed<DownloadLink[]>(() => {
  const grid = toRaw(props.grid);
  return [
    { name: "ex_field.npy", data: grid.ex_field },
    { name: "ey_field.npy", data: grid.ey_field },
    { name: "v_field.npy", data: grid.v_field },
    { name: "dx.npy", data: grid.dx },
    { name: "dy.npy", data: grid.dy },
    { name: "ek_table.npy", data: grid.ek_table },
    { name: "ek_index_beta.npy", data: grid.ek_index_beta },
    { name: "v_table.npy", data: grid.v_table },
    { name: "v_index_beta.npy", data: grid.v_index_beta },
  ]
});

function download_ndarray(link: DownloadLink) {
  const writer = new Uint8ArrayNdarrayWriter();
  link.data.ndarray.export_as_numpy_bytecode(writer);
  if (writer.buffer !== undefined) {
    const blob = new Blob([writer.buffer], { type: "application/octet-stream" });
    const elem = document.createElement("a");
    elem.href = window.URL.createObjectURL(blob);
    elem.download = link.name;
    elem.click();
  }
}

function download_all_ndarrays(name: string) {
  const links = download_links.value;
  if (links === undefined) return;
  const module = links[0].data.module;
  let zip_file = undefined;
  let zip_data = undefined;
  try {
    zip_file = new ZipFile(module);
    for (let link of links) {
      link = toRaw(link);
      const writer = new ModuleNdarrayWriter(link.data.module);
      try {
        link.data.ndarray.export_as_numpy_bytecode(writer);
        if (writer.write_buffer !== undefined) {
          zip_file.write_file(link.name, writer.write_buffer);
        }
      } catch (err) {
        toast.error(`failed to write numpy file '${link.name}' to zip with: ${String(err)}`);
      }
      writer.delete();
    }
    zip_data = zip_file.get_bytes();

    const blob = new Blob([zip_data.data_view], { type: "application/octet-stream" });
    const elem = document.createElement("a");
    elem.href = window.URL.createObjectURL(blob);
    elem.download = name;
    elem.click();
  } catch (err) {
    toast.error(`download_all_ndarrays failed with: ${String(err)}`);
  } finally {
    zip_file?.delete();
    zip_data?.delete();
  }
}

</script>

<template>
<table class="table table-pin-rows table-compact" :class="$attrs.class">
  <thead>
    <tr>
      <th>Name</th>
      <th>Shape</th>
      <th>Type</th>
      <th>Size</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="(link, index) in download_links" :key="index">
      <td class="font-medium text-nowrap">{{ link.name }}</td>
      <td>[{{ link.data.shape.join(',') }}]</td>
      <td>{{ link.data.ndarray.dtype }}</td>
      <td class="text-nowrap">{{ with_standard_suffix(link.data.data_view.byteLength, "B") }}</td>
      <td>
        <button class="btn btn-sm float-right p-1" @click="download_ndarray(link)">
          <DownloadIcon class="w-[1.25rem] h-[1.25rem]"/>
        </button>
      </td>
    </tr>
    <tr>
      <td colspan="5">
        <button class="w-fit btn btn-primary float-right" @click="download_all_ndarrays('grid_data.zip')">Download All</button>
      </td>
    </tr>
  </tbody>
</table>
</template>
