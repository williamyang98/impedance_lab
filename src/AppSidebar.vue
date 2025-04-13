<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  type SidebarProps,
} from "@/components/ui/sidebar"
import { routes } from "./routes.ts";

const router = useRouter();
const curr_route = useRoute();

const sidebar_props = withDefaults(defineProps<SidebarProps>(), {
  collapsible: 'icon',
});

</script>

<template>
  <Sidebar v-bind="sidebar_props">
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Calculators</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="route in routes" :key="route.name">
              <SidebarMenuButton asChild :is-active="route.name == curr_route.name">
                <a :href="router.resolve(route.path).href">
                  <component v-if="route.icon_component" :is="route.icon_component"/>
                  <span>{{ route.name }}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  </Sidebar>
</template>
