<script setup lang="ts">
import { watch } from "vue";
import { useRouter, useRoute, RouterView } from "vue-router";
import GpuProvider from "./providers/GpuProvider.vue";
import WasmProvider from "./providers/WasmProvider.vue";
import ToastProvider from "./providers/toast/ToastProvider.vue";
import UserDataProvider from "./providers/user_data/UserDataProvider.vue";
import { MenuIcon, ChevronDownIcon } from 'lucide-vue-next';
import { navigation_tree, type NavigationEndpoint } from "./routes.ts";
import GithubIcon from "./assets/github.svg";
import DarkModeToggle from "./utility/DarkModeToggle.vue";

const router = useRouter();
const curr_route = useRoute();

// close open dropdowns on route change (such as those on navbar)
watch(() => curr_route.fullPath, () => {
  if (document.activeElement) {
    (document.activeElement as HTMLElement).blur();
  }
});

function get_navigation_class(item: NavigationEndpoint): string {
  return curr_route.name === item.route.name ? "menu-active" : "";
}

</script>

<template>
<GpuProvider>
<WasmProvider>
<ToastProvider>
<UserDataProvider>
  <div class="w-screen h-screen overflow-hidden flex flex-col">
    <!-- Navbar -->
    <div class="navbar bg-base-100 shadow-sm min-h-[3rem] p-1">
      <div class="navbar-start w-full md:w-[50%]">
        <!--Mobile hamburger navigation menu-->
        <div class="dropdown md:hidden">
          <div tabindex="0" role="button" class="btn btn-ghost py-1 px-2">
            <MenuIcon class="w-[1.5rem] h-[1.5rem]"/>
          </div>
          <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-10 mt-3 w-52 p-2 shadow">
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
        <!--Title-->
        <div class="app-title flex flex-row items-center gap-x-2 mx-2">
          <img src="/favicon.png" class="w-[2rem] h-[2rem] flex-none"/>
          <div class="text-lg text-nowrap font-medium">Impedance Lab</div>
        </div>
      </div>
      <!--Desktop navigation menu-->
      <div class="navbar-center hidden md:flex">
        <ul class="menu menu-horizontal px-1 gap-x-1 z-10 p-0">
          <li v-for="item in navigation_tree" :key="item.name">
            <a
              v-if="item.type === 'endpoint'"
              :href="router.resolve(item.route.path).href"
              class="w-full flex flex-row gap-x-2 items-center" :class="get_navigation_class(item)"
            >
              <component v-if="item.icon_component" :is="item.icon_component"/>
              <span class="whitespace-nowrap">{{ item.name }}</span>
            </a>
            <div v-if="item.type === 'group'" class="dropdown dropdown-center dropdown-bottom p-0">
              <!-- NOTE: remove padding from parent div to button div so entire click region will activate popup -->
              <div class="w-full flex flex-row gap-x-2 items-center p-2" tabindex="0" role="button">
                <component v-if="item.icon_component" :is="item.icon_component"/>
                <div class="flex flex-row gap-x-1">
                  <span class="whitespace-nowrap">{{ item.name }}</span>
                  <ChevronDownIcon class="size-4 mt-1"/>
                </div>
              </div>
              <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-1 mt-3 ml-0 w-45 p-2 shadow">
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
            </div>
          </li>
        </ul>
      </div>
      <div class="navbar-end gap-x-2">
        <a class="cursor-pointer mx-1" href="https://github.com/williamyang98/impedance_lab">
          <GithubIcon class="w-[1.75rem] h-[1.75rem]" style="fill: var(--color-base-content)"/>
        </a>
        <DarkModeToggle/>
      </div>
    </div>
    <div class="p-1 flex-1 min-h-0 w-full">
      <RouterView/>
    </div>
  </div>
</UserDataProvider>
</ToastProvider>
</WasmProvider>
</GpuProvider>
</template>

<style scoped>
@media (width < 24rem) {
.app-title {
  display: none;
}
}
</style>
