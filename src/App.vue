<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppSidebar from "./AppSidebar.vue";
import GpuProvider from "./components/GpuProvider.vue";
import WasmProvider from "./components/WasmProvider.vue";
import { Moon, Sun, MenuIcon } from 'lucide-vue-next';
</script>

<template>
<GpuProvider>
  <WasmProvider>
    <div class="drawer">
      <input id="app-drawer" type="checkbox" class="drawer-toggle"/>
      <div class="drawer-content flex flex-col">
        <!-- Navbar -->
        <div class="navbar shadow w-full min-h-[3rem]">
          <div class="flex-none">
            <label for="app-drawer" aria-label="open sidebar" class="btn btn-square btn-ghost">
              <MenuIcon/>
            </label>
          </div>
          <div class="mx-2 flex-1 px-2">Impedance Lab</div>
          <div class="hidden flex-none lg:block">
            <ul class="menu menu-horizontal py-0">
              <li>Search</li>
              <li>
                <label class="swap swap-rotate">
                  <input type="checkbox" class="theme-controller" value="light"/>
                  <Sun class="swap-off h-5 w-5"/>
                  <Moon class="swap-on h-5 w-5"/>
                </label>
              </li>
            </ul>
          </div>
        </div>
        <div class="pt-2 px-4">
          <RouterView />
        </div>
      </div>
      <AppSidebar/>
    </div>
  </WasmProvider>
</GpuProvider>
</template>

<style scoped>

</style>
