<script setup lang="ts">
import { usePopupZIndex } from "@/composables/useZIndex";

export interface SPopoverProps {
  /** 弹出位置 */
  side?: "top" | "right" | "bottom" | "left";
  /** 对齐方式 */
  align?: "start" | "center" | "end";
  /** 与触发元素的距离（px） */
  sideOffset?: number;
  /** 触发方式 */
  trigger?: "click" | "hover" | "focus" | "manual";
  /** 直接使用插槽中的单个按钮承载触发器及其无障碍属性 */
  triggerAsChild?: boolean;
  /** 手动控制 open（trigger="manual" 时使用） */
  open?: boolean;
  /** hover 触发时的延迟（ms） */
  openDelay?: number;
  /** hover 离开时的关闭延迟（ms） */
  closeDelay?: number;
  /** 是否显示箭头 */
  arrow?: boolean;
  /** 封面主题模式 */
  cover?: boolean;
  /** 触发器是否撑满父容器宽度 */
  block?: boolean;
  /** 内容区附加 class */
  contentClass?: string;
  /** 弹层的无障碍名称 */
  contentLabel?: string;
}

const props = withDefaults(defineProps<SPopoverProps>(), {
  side: "bottom",
  align: "center",
  sideOffset: 6,
  trigger: "click",
  openDelay: 0,
  closeDelay: 100,
  arrow: false,
  cover: false,
  block: false,
  contentClass: "",
});

const emit = defineEmits<{
  "update:open": [value: boolean];
  "pointer-down-outside": [event: Event];
  "open-auto-focus": [event: Event];
  "close-auto-focus": [event: Event];
}>();

const { zIndex, onOpenChange } = usePopupZIndex();

const isOpen = ref(props.open ?? false);

// 同步外部 open prop
watch(
  () => props.open,
  (val) => {
    if (val !== undefined) isOpen.value = val;
  },
);

watch(isOpen, onOpenChange, { immediate: true });

const setOpen = (val: boolean): void => {
  isOpen.value = val;
  emit("update:open", val);
};

// hover 触发的延时器
let openTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const clearTimers = (): void => {
  if (openTimer) {
    clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
};

const handlePointerEnter = (): void => {
  if (props.trigger !== "hover") return;
  clearTimers();
  openTimer = setTimeout(() => setOpen(true), props.openDelay);
};

const handlePointerLeave = (): void => {
  if (props.trigger !== "hover") return;
  clearTimers();
  closeTimer = setTimeout(() => setOpen(false), props.closeDelay);
};

const handleFocus = (): void => {
  if (props.trigger !== "focus") return;
  setOpen(true);
};

const handleBlur = (): void => {
  if (props.trigger !== "focus") return;
  setOpen(false);
};

onUnmounted(clearTimers);

// hover 桥：用伪元素把弹层命中区延伸到「朝向触发器」的那一侧，覆盖 sideOffset 间隙
// data-side 由 reka-ui 在 PopoverContent 上自动设置，表示弹层相对触发器的位置
const bridgeClasses = computed(() =>
  props.trigger === "hover"
    ? [
        `before:content-[''] before:absolute`,
        // 弹层在触发器上方 → 桥铺在弹层底部
        "data-[side=top]:before:inset-x-0 data-[side=top]:before:top-full data-[side=top]:before:h-3",
        // 弹层在触发器下方 → 桥铺在弹层顶部
        "data-[side=bottom]:before:inset-x-0 data-[side=bottom]:before:bottom-full data-[side=bottom]:before:h-3",
        // 弹层在触发器左侧 → 桥铺在弹层右侧
        "data-[side=left]:before:inset-y-0 data-[side=left]:before:left-full data-[side=left]:before:w-3",
        // 弹层在触发器右侧 → 桥铺在弹层左侧
        "data-[side=right]:before:inset-y-0 data-[side=right]:before:right-full data-[side=right]:before:w-3",
      ]
    : null,
);
</script>

<template>
  <PopoverRoot :open="isOpen" @update:open="trigger === 'click' ? setOpen($event) : undefined">
    <PopoverTrigger
      as-child
      @pointerenter="handlePointerEnter"
      @pointerleave="handlePointerLeave"
      @focusin="handleFocus"
      @focusout="handleBlur"
    >
      <slot v-if="triggerAsChild" name="trigger" />
      <span v-else :class="block ? 'flex w-full' : 'inline-flex'">
        <slot name="trigger" />
      </span>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :key="arrow ? 'arrow' : 'plain'"
        as-child
        :side="side"
        :align="align"
        :side-offset="sideOffset"
        :avoid-collisions="true"
        :collision-padding="12"
        @pointer-down-outside="emit('pointer-down-outside', $event)"
        @escape-key-down="setOpen(false)"
        @open-auto-focus="emit('open-auto-focus', $event)"
        @close-auto-focus="emit('close-auto-focus', $event)"
      >
        <div
          data-theme-popup
          :aria-label="contentLabel"
          v-bind="contentLabel ? { 'aria-labelledby': undefined } : undefined"
          :data-theme-tone="cover ? 'cover' : undefined"
          :style="{ zIndex }"
          :class="[
            'rounded-xl shadow-lg p-3 text-sm data-[state=open]:animate-popover-in data-[state=closed]:animate-popover-out',
            cover
              ? 'bg-black/55 backdrop-blur-xl backdrop-saturate-160 border border-solid border-white/10 text-cover'
              : 'bg-surface-bright text-on-surface',
            bridgeClasses,
            contentClass,
          ]"
          @pointerenter="handlePointerEnter"
          @pointerleave="handlePointerLeave"
        >
          <slot />
          <PopoverArrow
            v-if="arrow"
            data-theme-popup-arrow
            :class="cover ? 'fill-black/60' : 'fill-surface-bright'"
          />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
