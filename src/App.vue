<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import ThemeProvider from "@/themes/ThemeProvider.vue";

const settings = useSettingsStore();

watchEffect(() => {
  const v = settings.appearance.fontFamily;
  const root = document.documentElement.style;
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <ThemeProvider>
    <AppBackground />
    <RouterView />
  </ThemeProvider>
</template>
