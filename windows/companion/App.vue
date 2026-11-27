<script setup lang="ts">
import {
  COMPANION_AVATAR_SIZE,
  type CompanionLayout,
  type CompanionMessage,
  type CompanionState,
  type CompanionSurface,
} from "@shared/types/companion";
import type { VNode } from "vue";
import Avatar from "./Avatar.vue";
import type { AvatarMood } from "./avatarMotion";
import { windowCopy } from "./copy";
import { companionReducedMotion } from "./theme";
import { useAvatarMotion } from "./useAvatarMotion";
import { useCompanionDrag } from "./useCompanionDrag";

const api = window.api.companion;
const state = shallowRef<CompanionState | null>(null);
const copy = computed(() => windowCopy[state.value?.locale ?? "zh-CN"]);
const surface = ref<CompanionSurface | null>(null);
const expanded = computed(() => surface.value === "chat");
const painted = ref<CompanionSurface | null>(null);
const layout = shallowRef<CompanionLayout | null>(null);
const { width: windowWidth, height: windowHeight } = useWindowSize();
const fixedFrame = computed(() => layout.value?.frame ?? null);
const nativeSurface = computed<CompanionSurface | null>(() => {
  const chat = layout.value;
  if (!chat) return null;
  if (chat.frame) return surface.value ?? painted.value;
  if (windowHeight.value <= COMPANION_AVATAR_SIZE) return null;
  const bubble = chat.bubble;
  const chatDistance =
    Math.abs(chat.width - windowWidth.value) + Math.abs(chat.height - windowHeight.value);
  const bubbleDistance =
    Math.abs(bubble.width - windowWidth.value) + Math.abs(bubble.height - windowHeight.value);
  if (chatDistance === bubbleDistance) return surface.value ?? painted.value;
  return chatDistance < bubbleDistance ? "chat" : "bubble";
});
const placement = computed(() => {
  const active = fixedFrame.value ? (surface.value ?? painted.value) : nativeSurface.value;
  return active === "bubble" ? layout.value?.bubble : layout.value;
});
const avatarPosition = computed(() =>
  fixedFrame.value
    ? { x: fixedFrame.value.avatarX, y: fixedFrame.value.avatarY }
    : { x: placement.value?.avatarX ?? 0, y: placement.value?.avatarY ?? 0 },
);
// 在对应原生尺寸生效后切换内容，离场期间保留最后一次绘制的气泡或聊天
watchEffect(() => {
  if (surface.value && (fixedFrame.value || nativeSurface.value === surface.value))
    painted.value = surface.value;
});
const panelVisible = computed(
  () => !!surface.value && !!painted.value && (!!fixedFrame.value || !!nativeSurface.value),
);
// 弹层通过 Portal 挂在 body 下，将面板和气泡尺寸同步到根元素以便固定外框复用
watchEffect(() => {
  const root = document.documentElement.style;
  const chat = layout.value;
  if (!chat) return;
  root.setProperty("--companion-chat-width", `${Math.max(160, chat.width - 24)}px`);
  root.setProperty("--companion-chat-height", `${Math.max(160, chat.height - 104)}px`);
  root.setProperty("--companion-bubble-max-width", `${Math.max(120, chat.bubble.width - 24)}px`);
  root.setProperty("--companion-bubble-max-height", `${Math.max(48, chat.bubble.height - 108)}px`);
});
const reply = shallowRef<CompanionMessage | null>(null);
const replyPreview = ref<HTMLButtonElement>();
const hoveringReply = ref(false);
const focusingReply = ref(false);
const input = ref("");
const localError = ref("");
const sending = ref(false);
const unread = ref(false);
const expression = ref<"happy" | "curious" | "listening">("listening");
const mood = computed<AvatarMood>(() => (state.value?.pending ? "thinking" : expression.value));
const avatar = ref<HTMLButtonElement>();
const characterHost = computed(
  () => avatar.value?.querySelector<HTMLElement>(".character") ?? undefined,
);
const editor = ref<{ focus: () => void }>();
const surfaceBody = ref<HTMLElement>();
const closingState = shallowRef<CompanionState | null>(null);
const visibleState = computed(() => closingState.value ?? state.value);
let closing: { body: HTMLElement; revision: number } | undefined;
const log = ref<HTMLElement>();
const coverFailed = ref(false);
const canSend = computed(() => !!input.value.trim() && !state.value?.pending && !sending.value);
let faceTimer: ReturnType<typeof setTimeout> | undefined;
let onDragDelta: ((dx: number, dy: number) => void) | undefined;
const { startDrag, activate, moveByKey, isDragging } = useCompanionDrag(togglePanel, (dx, dy) =>
  onDragDelta?.(dx, dy),
);
const avatarMotion = useAvatarMotion({
  target: characterHost,
  mood,
  dragging: isDragging,
  reducedMotion: companionReducedMotion,
});
onDragDelta = avatarMotion.nudgeDrag;
let pointingOutside: boolean | undefined;
let lastPointer: { x: number; y: number } | null = null;
let pointerSyncFrame = 0;
let scrollPinned = true;
let beatSubscribed = false;
let disposed = false;
const off: (() => void)[] = [];

/**
 * 应用会话快照，将新回复映射到角色动作和未读提示
 * @param next - 来自主进程的会话
 */
function receive(next: CompanionState) {
  const prev = state.value;
  if (prev?.track?.cover !== next.track?.cover) coverFailed.value = false;
  state.value = next;
  document.documentElement.lang = next.locale;
  const last = next.messages.at(-1);
  if (prev && last?.role === "assistant" && prev.messages.at(-1)?.id !== last.id) {
    const nextMood = /[?？]\s*$/u.test(last.text) ? "curious" : "happy";
    const sameMood = expression.value === nextMood;
    expression.value = nextMood;
    if (sameMood) avatarMotion.react("message");
    unread.value = !expanded.value;
    if (!expanded.value && next.replyBubble) {
      reply.value = last;
      setSurface("bubble");
      void nextTick(() => {
        if (replyPreview.value) replyPreview.value.scrollTop = 0;
      });
    }
    clearTimeout(faceTimer);
    faceTimer = setTimeout(() => {
      expression.value = "listening";
    }, 4500);
  }
  if (!next.replyBubble && surface.value === "bubble") setSurface(null);
  if (expanded.value && scrollPinned) {
    void nextTick(() => log.value?.scrollTo({ top: log.value.scrollHeight }));
  }
}

/** 记住用户是否正在阅读较早的对话 */
function updateScrollPin() {
  const el = log.value;
  if (el) scrollPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
}

/**
 * 切换同一个角色窗口的展示内容，气泡消失后仍保留未读提示
 * @param next - 聊天、回复气泡或仅显示角色
 */
function setSurface(next: CompanionSurface | null) {
  const previous = surface.value;
  if (previous === next) return;
  const revision = api.setExpanded(next !== null, next ?? previous!);
  surface.value = next;
  hoveringReply.value = focusingReply.value = false;
  if (next) {
    closing = undefined;
    closingState.value = null;
    if (next === "chat") {
      unread.value = false;
      scrollPinned = true;
      // 中途反向展开会沿用同一个弹层，此时 Reka 不会再次触发挂载焦点事件
      if (editor.value) void nextTick(focusEditor);
    }
  } else {
    if (previous === "chat") {
      api.setTyping(false);
      closingState.value = state.value;
      avatar.value?.focus();
    } else if (document.hasFocus() && document.activeElement === replyPreview.value) {
      avatar.value?.focus();
    }
    if (surfaceBody.value) closing = { body: surfaceBody.value, revision };
    else {
      api.finishCollapse(revision);
      painted.value = null;
      void nextTick(syncPointerAtLastPoint);
    }
  }
}

/** 切换角色聊天面板 */
function togglePanel() {
  avatarMotion.react("click");
  setSurface(expanded.value ? null : "chat");
}

/** 按下角色按钮时同时触发微幅下压弹性反馈 */
function handleAvatarPointerDown(event: PointerEvent) {
  if (event.isPrimary && event.button === 0) avatarMotion.react("press");
  startDrag(event);
}

/** 将弹层焦点交给输入框并显示最近的对话 */
function focusEditor() {
  if (!expanded.value) return;
  editor.value?.focus();
  log.value?.scrollTo({ top: log.value.scrollHeight });
}

/**
 * 等共享弹层真正卸载后收缩原生窗口，保留快速重开时的新面板
 * @param vnode - 已完成离场的面板内容节点
 */
function finishPanelClose(vnode: VNode) {
  if (!closing || closing.body !== vnode.el || surface.value) return;
  api.finishCollapse(closing.revision);
  closing = undefined;
  closingState.value = null;
  painted.value = null;
  reply.value = null;
  void nextTick(syncPointerAtLastPoint);
}

/** 发送输入内容，保留发送失败时的草稿 */
async function send() {
  if (!canSend.value) return;
  const message = input.value.trim();
  sending.value = true;
  localError.value = "";
  scrollPinned = true;
  input.value = "";
  api.setTyping(false);
  try {
    await api.send(message);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
    if (!input.value) input.value = message;
  } finally {
    sending.value = false;
    api.setTyping(expanded.value && !!input.value.trim());
  }
}

/**
 * 按当前命中的节点更新透明留白的点击穿透状态
 * @param target - 光标下方的 DOM 节点
 */
function syncPointerHit(target: EventTarget | null) {
  const empty = !(target instanceof Element && target.closest("button, [data-theme-popup]"));
  if (empty !== pointingOutside) {
    pointingOutside = empty;
    api.setIgnoreMouse(empty);
  }
}

/** 面板关闭或拖动结束后复核最近光标位置，避免刚消失的弹层区域残留拦截 */
function syncPointerAtLastPoint() {
  if (isDragging.value) return;
  if (!lastPointer) {
    if (fixedFrame.value && pointingOutside !== true) {
      pointingOutside = true;
      api.setIgnoreMouse(true);
    }
    return;
  }
  if (typeof document.elementFromPoint !== "function") return;
  syncPointerHit(document.elementFromPoint(lastPointer.x, lastPointer.y));
}

/**
 * 仅在角色拖动结束后恢复透明留白的点击穿透
 * @param event - 窗口中的指针移动
 */
function movePointer(event: PointerEvent) {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (!isDragging.value) avatarMotion.trackPointer(event.clientX, event.clientY);
  if (isDragging.value || event.buttons) return;
  syncPointerHit(event.target);
}

/** 弹层显示或切换后在下一帧复核静止光标下的命中状态 */
function schedulePointerSync() {
  if (!fixedFrame.value) return;
  cancelAnimationFrame(pointerSyncFrame);
  pointerSyncFrame = requestAnimationFrame(() => {
    pointerSyncFrame = 0;
    if (!disposed) syncPointerAtLastPoint();
  });
}

/** 选区或滚动条拖动在透明区域松手后立即恢复点击穿透 */
function releasePointer() {
  if (!isDragging.value) syncPointerAtLastPoint();
}

/** 指针离开透明窗口或失焦时恢复外框穿透，防止边缘空白吞掉点击 */
function leaveWindow() {
  lastPointer = null;
  avatarMotion.clearPointer();
  if (isDragging.value) return;
  if (fixedFrame.value && pointingOutside !== true) {
    pointingOutside = true;
    api.setIgnoreMouse(true);
  }
}

/**
 * 允许从输入框或角色按钮收起对话
 * @param event - 浮窗按键
 */
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape" && surface.value) {
    event.preventDefault();
    setSurface(null);
    return;
  }
}

/** 显示且允许运动反馈时才持有频谱采集 */
function syncBeat() {
  const active = !document.hidden && !companionReducedMotion.value;
  if (beatSubscribed === active) return;
  beatSubscribed = active;
  void window.api.player.setFftEnabled(active);
}

onMounted(async () => {
  off.push(
    api.onLayout((next) => {
      const previousFrame = layout.value?.frame;
      const frameShifted =
        previousFrame?.avatarX !== next.frame?.avatarX ||
        previousFrame?.avatarY !== next.frame?.avatarY;
      layout.value = next;
      if (frameShifted && next.frame) {
        lastPointer = null;
        syncPointerAtLastPoint();
      }
    }),
    api.onState(receive),
    api.onDraft((draft) => {
      if (state.value?.pending) receive({ ...state.value, draft });
    }),
    api.onBeat((level) => {
      if (beatSubscribed) avatarMotion.pushBeat(level);
    }),
  );
  document.addEventListener("visibilitychange", syncBeat);
  document.documentElement.addEventListener("pointerleave", leaveWindow);
  window.addEventListener("blur", leaveWindow);
  window.addEventListener("pointermove", movePointer);
  window.addEventListener("pointerup", releasePointer);
  window.addEventListener("keydown", keydown);
  syncBeat();
  try {
    const [initial, placement] = await Promise.all([api.getState(), api.getLayout()]);
    if (disposed) return;
    layout.value ??= placement;
    if (!state.value) receive(initial);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(faceTimer);
  cancelAnimationFrame(pointerSyncFrame);
  for (const unsubscribe of off) unsubscribe();
  document.removeEventListener("visibilitychange", syncBeat);
  document.documentElement.removeEventListener("pointerleave", leaveWindow);
  window.removeEventListener("blur", leaveWindow);
  window.removeEventListener("pointermove", movePointer);
  window.removeEventListener("pointerup", releasePointer);
  window.removeEventListener("keydown", keydown);
  if (beatSubscribed) void window.api.player.setFftEnabled(false);
  api.setTyping(false);
  for (const name of [
    "--companion-chat-width",
    "--companion-chat-height",
    "--companion-bubble-max-width",
    "--companion-bubble-max-height",
  ]) {
    document.documentElement.style.removeProperty(name);
  }
});
watch(companionReducedMotion, syncBeat);
watch(isDragging, (active) => {
  if (!active) syncPointerAtLastPoint();
});
watch(
  [panelVisible, painted],
  ([visible]) => {
    if (visible) schedulePointerSync();
  },
  { flush: "post" },
);
// 原生窗口切换尺寸时会重新接收鼠标，下一次命中检查必须同步当前透明区域
watch(
  [windowWidth, windowHeight],
  () => {
    pointingOutside = undefined;
  },
  { flush: "sync" },
);
watch(
  editor,
  (input) => {
    if (input && expanded.value) focusEditor();
  },
  { flush: "post" },
);
// 只在新回复实际显示后开始计时；读者悬停或键盘聚焦时暂停
watch(
  [
    replyPreview,
    () => reply.value?.id,
    surface,
    hoveringReply,
    focusingReply,
    () => state.value?.replyBubbleSeconds,
  ],
  ([preview, , current, hovered, focused, seconds], _, onCleanup) => {
    if (!preview || current !== "bubble" || hovered || focused || !seconds) return;
    const timer = setTimeout(() => setSurface(null), seconds * 1000);
    onCleanup(() => clearTimeout(timer));
  },
  { flush: "post" },
);
</script>

<template>
  <main
    class="companion"
    :style="{
      '--avatar-size': COMPANION_AVATAR_SIZE + 'px',
      '--avatar-x': avatarPosition.x + 'px',
      '--avatar-y': avatarPosition.y + 'px',
    }"
  >
    <div v-if="layout" class="avatar-anchor">
      <SPopover
        trigger="manual"
        trigger-as-child
        :open="panelVisible"
        :side="placement?.side ?? 'top'"
        :align="placement?.align ?? 'end'"
        :arrow="painted === 'bubble'"
        :side-offset="4"
        :content-label="copy.title"
        :content-class="
          painted === 'bubble'
            ? 'reply-bubble w-max max-w-[var(--companion-bubble-max-width,calc(100vw-24px))] !p-0'
            : 'panel w-[var(--companion-chat-width,calc(100vw-24px))] h-[var(--companion-chat-height,calc(100dvh-104px))] max-h-[var(--reka-popover-content-available-height)] overflow-hidden !p-0'
        "
        @update:open="!$event && setSurface(null)"
        @pointer-down-outside="!fixedFrame && setSurface(null)"
        @open-auto-focus.prevent="focusEditor"
        @close-auto-focus.prevent
      >
        <template #trigger>
          <button
            ref="avatar"
            type="button"
            class="avatar"
            :class="{ dragging: isDragging }"
            :aria-label="expanded ? copy.close : unread ? copy.unread : copy.open"
            @click="activate"
            @pointerenter="avatarMotion.react('hover')"
            @pointerdown="handleAvatarPointerDown"
            @keydown="moveByKey"
          >
            <Avatar :mood="mood" :dragging="isDragging" />
            <i v-if="unread && surface !== 'bubble'" class="unread" />
          </button>
        </template>
        <div
          ref="surfaceBody"
          :class="painted === 'chat' ? 'flex h-full min-h-0 flex-col' : ''"
          :inert="!surface"
          @vue:unmounted="finishPanelClose"
        >
          <button
            v-if="painted === 'bubble'"
            ref="replyPreview"
            type="button"
            class="reply-preview"
            :aria-label="copy.open"
            aria-describedby="companion-reply"
            @pointerenter="hoveringReply = true"
            @pointerleave="hoveringReply = false"
            @focus="focusingReply = true"
            @blur="focusingReply = false"
            @keydown.tab.stop.prevent="avatar?.focus()"
            @click="setSurface('chat')"
          >
            <span id="companion-reply" role="status">{{ reply?.text }}</span>
          </button>
          <template v-else>
            <header
              class="flex shrink-0 items-center gap-3 border-b border-b-solid border-outline-variant/30 px-4 py-3"
            >
              <span
                class="now-art grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-primary-container text-on-primary-container"
                aria-hidden="true"
              >
                <img
                  v-if="visibleState?.track?.cover && !coverFailed"
                  :src="visibleState.track.cover"
                  alt=""
                  decoding="async"
                  class="size-full object-cover"
                  referrerpolicy="no-referrer"
                  @error="coverFailed = true"
                />
                <icon-lucide-disc-3 v-else class="size-5" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="song truncate text-sm font-semibold">
                  {{ visibleState?.track?.title || copy.title }}
                </p>
                <p class="artist truncate text-xs text-on-surface-variant">
                  {{ visibleState?.track?.artists || copy.noTrack }}
                </p>
              </div>
              <SButton
                class="collapse shrink-0"
                size="small"
                variant="ghost"
                circle
                :aria-label="copy.close"
                @click="setSurface(null)"
              >
                <template #icon><IconLucideChevronDown /></template>
              </SButton>
            </header>
            <div
              ref="log"
              class="thread min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
              role="log"
              aria-live="polite"
              :aria-label="copy.history"
              @scroll="updateScrollPin"
            >
              <p
                v-if="!visibleState?.messages.length && !visibleState?.pending"
                class="empty text-sm text-on-surface-variant"
              >
                {{ copy.empty }}
              </p>
              <div
                v-for="message in visibleState?.messages"
                :key="message.id"
                class="turn"
                :class="message.role"
              >
                <span class="text-xs text-on-surface-variant">
                  {{ message.role === "user" ? copy.you : copy.title }}
                </span>
                <p>{{ message.text }}</p>
                <small v-if="message.usage" class="usage text-xs text-on-surface-variant">
                  {{ message.usage.totalTokens.toLocaleString(visibleState?.locale) }} tokens
                </small>
              </div>
              <div v-if="visibleState?.pending" class="turn assistant" aria-live="off">
                <span class="text-xs text-on-surface-variant">{{ copy.title }}</span>
                <p>{{ visibleState.draft || copy.thinking }}</p>
              </div>
            </div>
            <p
              v-if="localError || visibleState?.error"
              class="error text-red-700 dark:text-red-400"
              role="alert"
            >
              {{ localError || visibleState?.error }}
            </p>
            <form
              class="composer flex shrink-0 items-center gap-2 px-3 pb-3 pt-1"
              @submit.prevent="send"
            >
              <SInput
                ref="editor"
                v-model="input"
                round
                class="min-w-0 flex-1"
                :maxlength="4000"
                :aria-label="copy.input"
                :placeholder="copy.input"
                @update:model-value="api.setTyping(!!$event.trim())"
                @focus="api.setTyping(!!input.trim())"
                @blur="api.setTyping(false)"
              />
              <SButton
                class="submit shrink-0"
                type="primary"
                circle
                :disabled="!canSend"
                :aria-label="copy.send"
              >
                <template #icon><IconLucideArrowUp /></template>
              </SButton>
            </form>
          </template>
        </div>
      </SPopover>
    </div>
  </main>
</template>

<style scoped>
.companion {
  position: relative;
  height: 100%;
}
.avatar-anchor {
  position: absolute;
  left: clamp(0px, var(--avatar-x), calc(100% - var(--avatar-size)));
  top: clamp(0px, var(--avatar-y), calc(100% - var(--avatar-size)));
  line-height: 0;
}
.reply-preview {
  display: block;
  width: 100%;
  max-height: min(
    var(--companion-bubble-max-height, calc(100dvh - 108px)),
    var(--reka-popover-content-available-height)
  );
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0.55rem 0.8rem;
  border: 0;
  border-radius: inherit;
  color: inherit;
  background: transparent;
  text-align: start;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.45;
  cursor: pointer;
}
.reply-preview:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: -3px;
}
.turn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 12px;
}
.turn.user {
  align-items: flex-end;
}
.turn p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  line-height: 1.5;
  max-width: 94%;
  border-radius: 3px 12px 12px;
  padding: 8px 12px;
  background: rgb(var(--s-on-surface) / 6%);
}
.turn.user p {
  color: rgb(var(--s-on-primary-container));
  background: rgb(var(--s-primary-container));
  border-radius: 12px 3px 12px 12px;
}
.error {
  margin: 0 12px 6px;
  max-height: 4.5em;
  overflow: auto;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
}
.avatar {
  display: block;
  position: relative;
  width: var(--avatar-size);
  height: var(--avatar-size);
  cursor: grab;
  border: 0;
  background: transparent;
  border-radius: 50%;
  user-select: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
}
.avatar:focus-visible,
.collapse:focus-visible,
.submit:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: -3px;
}
.avatar:active,
.avatar.dragging {
  cursor: grabbing;
}
.avatar .character {
  transform-origin: 50% 72%;
  transition: scale 280ms cubic-bezier(0.22, 1.32, 0.36, 1);
  transition-timing-function: linear(
    0,
    0.1 4%,
    0.36 10%,
    0.74 18%,
    1.01 27%,
    1.1 36%,
    1.07 47%,
    1.01 60%,
    0.988 74%,
    1
  );
}
.avatar:hover .character {
  scale: 1.03;
}
.avatar:active .character,
.avatar.dragging .character {
  scale: 0.96;
  transition-duration: 90ms;
  transition-timing-function: ease-out;
}
html[data-reduced-motion] .avatar:is(:hover, :active, .dragging) .character,
html[data-reduced-motion] .avatar .character {
  transition: none;
  scale: 1;
}
.unread {
  pointer-events: none;
  position: absolute;
  right: 7px;
  top: 11px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgb(var(--s-primary));
  border: 2px solid rgb(var(--s-surface-bright));
}
</style>
