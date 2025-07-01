<script setup lang="ts">
import { watch, useTemplateRef, ref } from "vue";
import { useRouter, useRoute, RouterView } from "vue-router";
import GpuProvider from "./providers/GpuProvider.vue";
import WasmProvider from "./providers/WasmProvider.vue";
import ToastProvider from "./providers/toast/ToastProvider.vue";
import { Moon, Sun, MenuIcon } from 'lucide-vue-next';
import { navigation_tree, type NavigationEndpoint } from "./routes.ts";
import GithubIcon from "./assets/github.svg";

const router = useRouter();
const curr_route = useRoute();

const desktop_nav_menu = useTemplateRef<HTMLUListElement>("desktop-nav-menu");

watch(() => curr_route.fullPath, () => {
  if (document.activeElement) {
    (document.activeElement as HTMLElement).blur();
  }
  if (desktop_nav_menu.value) {
    desktop_nav_menu.value
      .querySelectorAll("details[open]")
      .forEach(elem => elem.removeAttribute("open"));
  }
});

function get_navigation_class(item: NavigationEndpoint): string {
  return curr_route.name === item.route.name ? "menu-active" : "";
}

const is_dark_mode = ref<boolean>(localStorage.getItem("is_dark_mode") === "true");
watch(is_dark_mode, (new_is_dark_mode) => {
  try {
    localStorage.setItem("is_dark_mode", new_is_dark_mode ? "true" : "false");
  } catch (error) {
    console.error(`Failed to set is_dark_mode=${new_is_dark_mode} with: ${String(error)}`);
  }
});

</script>

<template>
<!-- menu-active -->
<GpuProvider>
  <WasmProvider>
    <ToastProvider>
      <!-- Navbar -->
      <div class="navbar bg-base-100 shadow-sm min-h-[3rem]">
        <div class="navbar-start w-full md:w-[50%]">
          <!--Mobile hamburger navigation menu-->
          <div class="dropdown md:hidden">
            <div tabindex="0" role="button" class="btn btn-ghost py-1 px-2">
              <MenuIcon class="w-[1.5rem] h-[1.5rem]"/>
            </div>
            <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-1 mt-3 w-52 p-2 shadow">
              <li v-for="item in navigation_tree" :key="item.name">
                <a
                  v-if="item.type === 'endpoint'"
                  :href="router.resolve(item.route.path).href"
                  class="w-full group" :class="get_navigation_class(item)"
                >
                  <component v-if="item.icon_component" :is="item.icon_component"/>
                  <span class="whitespace-nowrap">{{ item.name }}</span>
                </a>
                <template v-if="item.type === 'group'">
                  <a class="w-full group menu-title flex flex-row gap-x-2">
                    <component v-if="item.icon_component" :is="item.icon_component"/>
                    <span class="whitespace-nowrap">{{ item.name }}</span>
                  </a>
                  <ul class="p-2">
                    <li v-for="endpoint in item.endpoints" :key="endpoint.name">
                      <a
                        :href="router.resolve(endpoint.route.path).href"
                        class="w-full group" :class="get_navigation_class(endpoint)"
                      >
                        <component v-if="endpoint.icon_component" :is="endpoint.icon_component"/>
                        <span class="whitespace-nowrap">{{ endpoint.name }}</span>
                      </a>
                    </li>
                  </ul>
                </template>
              </li>
            </ul>
          </div>
          <div class="hidden sm:flex flex-row items-center gap-x-2 mx-2">
            <img src="/favicon.png" class="w-[2rem] h-[2rem] flex-none"/>
            <div class="text-lg text-nowrap font-medium">Impedance Lab</div>
          </div>
        </div>
        <!--Desktop navigation menu-->
        <div class="navbar-center hidden md:flex">
          <ul class="menu menu-horizontal px-1 gap-x-1 z-1 p-0" ref="desktop-nav-menu">
            <li v-for="item in navigation_tree" :key="item.name">
              <a
                v-if="item.type === 'endpoint'"
                :href="router.resolve(item.route.path).href"
                class="w-full group" :class="get_navigation_class(item)"
              >
                <component v-if="item.icon_component" :is="item.icon_component"/>
                <span class="whitespace-nowrap">{{ item.name }}</span>
              </a>
              <template v-if="item.type === 'group'">
                <details>
                  <summary class="w-full group">
                    <component v-if="item.icon_component" :is="item.icon_component"/>
                    <span class="whitespace-nowrap">{{ item.name }}</span>
                  </summary>
                  <ul class="p-2">
                    <li v-for="endpoint in item.endpoints" :key="endpoint.name">
                      <a
                        :href="router.resolve(endpoint.route.path).href"
                        class="w-full group" :class="get_navigation_class(endpoint)"
                      >
                        <component v-if="endpoint.icon_component" :is="endpoint.icon_component"/>
                        <span class="whitespace-nowrap">{{ endpoint.name }}</span>
                      </a>
                    </li>
                  </ul>
                </details>
              </template>
            </li>
          </ul>
        </div>
        <div class="navbar-end gap-x-2">
          <a class="cursor-pointer mx-1" href="https://github.com/williamyang98/impedance_lab">
            <GithubIcon class="w-[1.75rem] h-[1.75rem]" style="fill: var(--color-base-content)"/>
          </a>
          <label class="flex cursor-pointer gap-2">
            <Sun class="h-5 w-5"/>
            <input type="checkbox" v-model="is_dark_mode" class="toggle theme-controller" value="dark"/>
            <Moon class="h-5 w-5"/>
          </label>
        </div>
      </div>
      <div class="px-2 pt-2 w-full">
        <RouterView/>
      </div>
    </ToastProvider>
  </WasmProvider>
</GpuProvider>
</template>

<style scoped>

</style>
