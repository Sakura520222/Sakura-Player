<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import { materialKey, probeAcceleration, probeSvgRefraction, resolveMaterial } from "./material";

const theme = useThemeStore();
const settings = useSettingsStore();
const visibility = useDocumentVisibility();
const nativeVisible = shallowRef(true);
const visible = computed(() => nativeVisible.value && visibility.value === "visible");
const unsubscribe = window.api.window.onMainVisibilityChange(
  (value) => (nativeVisible.value = value),
);
onScopeDispose(unsubscribe);
const highContrast = useMediaQuery(
  "(prefers-contrast: more), (forced-colors: active), (prefers-reduced-transparency: reduce)",
);
const accelerated = shallowRef(false);
const svgFilterVerified = shallowRef(false);
const backdrop = CSS.supports("backdrop-filter", "blur(1px)");
const displacement = CSS.supports("backdrop-filter", "url(#sakura-lens) saturate(1.2)");
const limitedDevice = navigator.hardwareConcurrency <= 4;
const optics = computed(() => theme.definition.material.configure?.(theme.options));
let probed = false;
let disposed = false;

onScopeDispose(() => {
  disposed = true;
});

watchEffect(() => {
  const config = optics.value;
  if (!config || probed || !visible.value || !displacement) return;
  if (config.quality === "low" || highContrast.value || !config.refraction) return;
  probed = true;
  const hw = probeAcceleration();
  accelerated.value = hw;
  if (!hw) return;
  // 真实渲染验证 SVG 位移管线，未通过前保持 frosted 稳定回退
  void probeSvgRefraction().then((verified) => {
    if (!disposed) svgFilterVerified.value = verified;
  });
});

const material = computed(() => ({
  ...resolveMaterial(optics.value?.quality ?? "low", optics.value?.refraction ?? 0, {
    backdrop,
    displacement,
    accelerated: accelerated.value,
    highContrast: highContrast.value,
    limitedDevice,
    svgFilterVerified: svgFilterVerified.value,
  }),
  visible: visible.value,
}));
provide(materialKey, material);

watchEffect((onCleanup) => {
  const root = document.documentElement;
  const definition = theme.definition;
  root.dataset.theme = theme.themeId;
  root.dataset.themeMaterial = definition.material.variant;
  root.dataset.themeMotion = definition.motion.variant;
  root.dataset.themeVisibility = visible.value ? "visible" : "hidden";
  root.dataset.materialTier = material.value.tier;
  root.toggleAttribute("data-reduced-motion", settings.reducedMotion);
  if (optics.value)
    root.style.setProperty("--liquid-transparency", String(optics.value.transparency / 100));
  else root.style.removeProperty("--liquid-transparency");
  for (const [key, value] of Object.entries(definition.tokens)) root.style.setProperty(key, value);
  onCleanup(() => {
    for (const key of Object.keys(definition.tokens)) root.style.removeProperty(key);
  });
});
</script>

<template>
  <slot />
</template>
