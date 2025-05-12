<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { routes } from "./routes.ts";

const router = useRouter();
const curr_route = useRoute();

</script>

<template>
  <div class="drawer-side">
    <label for="app-drawer" aria-label="close sidebar" class="drawer-overlay"></label>
    <aside class="bg-base-100 min-h-screen w-80">
      <ul class="menu w-full px-1 py-1 gap-y-1">
        <li v-for="route in routes" :key="route.name">
          <a
            :href="router.resolve(route.path).href"
            class="group"
            :class="`${route.name == curr_route.name ? 'menu-active' : ''}`"
          >
            <span>
              <component v-if="route.icon_component" :is="route.icon_component"/>
            </span>
            <span class="whitespace-nowrap">{{ route.name }}</span>
          </a>
        </li>
      </ul>
    </aside>
  </div>
</template>
