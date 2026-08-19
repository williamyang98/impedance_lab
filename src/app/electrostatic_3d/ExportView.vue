<script lang="ts" setup>
import { toRaw, computed } from "vue";
import { CpuGrid } from "./grid.ts";
import { DownloadIcon } from "@lucide/vue";
import { Uint8ArrayNdarrayWriter } from "../../utility/ndarray.ts";
import { Ndarray } from "../../utility/ndarray.ts";
import { with_standard_suffix } from "../../utility/standard_suffix.ts";
import { ZipFile } from "../../wasm/index.ts";
import { providers } from "../../providers/providers.ts";
import { ModuleNdarrayWriter } from "../../utility/module_ndarray.ts";

const toast = providers.toast_manager.value;
const wasm_module = toRaw(providers.wasm_module.value);

const props = defineProps<{
  grid: CpuGrid,
}>();

interface DownloadLink {
  name: string;
  data: Ndarray;
}

const download_links = computed<DownloadLink[]>(() => {
  const grid = toRaw(props.grid);
  return [
    { name: "Xin.npy", data: grid.Xin },
    { name: "b.npy", data: grid.b },
    { name: "r.npy", data: grid.r },
    { name: "mask.npy", data: grid.mask },
    { name: "dx.npy", data: grid.dx },
    { name: "dy.npy", data: grid.dy },
    { name: "dz.npy", data: grid.dz },
    { name: "x.npy", data: grid.x },
    { name: "y.npy", data: grid.y },
    { name: "z.npy", data: grid.z },
    { name: "er.npy", data: grid.er },
  ]
});

function download_ndarray(link: DownloadLink) {
  const writer = new Uint8ArrayNdarrayWriter();
  link.data.export_as_numpy_bytecode(writer);
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
  if (links.length <= 0) return;
  let zip_file = undefined;
  let zip_data = undefined;
  try {
    zip_file = new ZipFile(wasm_module);
    for (let link of links) {
      link = toRaw(link);
      const writer = new ModuleNdarrayWriter(wasm_module);
      try {
        link.data.export_as_numpy_bytecode(writer);
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
      <td>{{ link.data.dtype }}</td>
      <td class="text-nowrap">{{ with_standard_suffix(link.data.data.byteLength, "B") }}</td>
      <td>
        <button class="btn btn-sm float-right p-1" @click="download_ndarray(link)">
          <DownloadIcon class="w-[1.25rem] h-[1.25rem]"/>
        </button>
      </td>
    </tr>
    <tr>
      <td colspan="5">
        <button class="w-fit btn btn-primary float-right" @click="download_all_ndarrays('via_3d.zip')">Download All</button>
      </td>
    </tr>
  </tbody>
</table>
</template>
