<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppSidebar from "./AppSidebar.vue";
import GpuProvider from "./components/GpuProvider.vue";
import WasmProvider from "./components/WasmProvider.vue";
import ToastProvider from "./components/toast/ToastProvider.vue";
import { Moon, Sun, MenuIcon } from 'lucide-vue-next';
</script>

<template>
<GpuProvider>
  <WasmProvider>
    <ToastProvider>
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
                <li>
                  <label class="flex cursor-pointer gap-2">
                    <Sun class="h-5 w-5"/>
                    <input type="checkbox" class="toggle theme-controller" value="dark"/>
                    <Moon class="h-5 w-5"/>
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
    </ToastProvider>
  </WasmProvider>
</GpuProvider>
</template>

<style scoped>

</style>
