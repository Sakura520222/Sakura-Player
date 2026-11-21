<script setup lang="ts">
import { materialKey } from "@/themes/material";

const material = inject(materialKey);
const { t } = useI18n();
</script>

<template>
  <p v-if="material" class="text-xs px-1 text-on-surface-variant" data-theme-material-status>
    {{ t(`themes.material.${material.tier}`) }}
  </p>
</template>
