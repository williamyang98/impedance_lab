<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppSidebar from "./AppSidebar.vue";
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
</script>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({

});
</script>

<template>
  <SidebarProvider v-bind="{ defaultOpen: false }">
    <AppSidebar />
    <main class="w-[100%]">
      <SidebarTrigger/>
      <div class="p-3 pt-0 w-[100%]">
        <RouterView />
      </div>
    </main>
  </SidebarProvider>
</template>

<style scoped>

</style>
