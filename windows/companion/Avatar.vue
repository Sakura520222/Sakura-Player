<script setup lang="ts">
import type { AvatarMood } from "./avatarMotion";

defineProps<{
  mood: AvatarMood;
  dragging?: boolean;
}>();
</script>

<template>
  <span class="character" :class="[mood, { dragging }]" aria-hidden="true">
    <span class="breath-primary">
      <span class="breath-secondary">
        <span class="head">
          <i class="ear left" />
          <i class="ear right" />
          <span class="headphone-rig">
            <i class="band" />
            <i class="cup left" />
            <i class="cup right" />
          </span>
          <span class="face">
            <span class="face-features">
              <i class="eye left" />
              <i class="eye right" />
              <i class="mouth" />
              <i class="cheek left" />
              <i class="cheek right" />
            </span>
          </span>
        </span>
      </span>
    </span>
  </span>
</template>

<style scoped>
.character {
  --spring-soft: cubic-bezier(0.22, 1.32, 0.36, 1);
  --spring-soft: linear(
    0,
    0.09 4%,
    0.34 10%,
    0.72 18%,
    0.99 27%,
    1.1 35%,
    1.08 45%,
    1.01 58%,
    0.985 71%,
    1.003 85%,
    1
  );

  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.breath-primary,
.breath-secondary {
  display: grid;
  place-items: center;
  transform-origin: 50% 88%;
}

.head {
  position: relative;
  width: 61px;
  height: 47px;
  margin-top: 11px;
  transform-origin: 50% 86%;
  transform: translate3d(var(--head-x, 0px), var(--head-y, 0px), 0)
    scale(var(--head-sx, 1), var(--head-sy, 1));
}

.headphone-rig {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform: translate3d(0, var(--cup-y, 0px), 0);
}

.face {
  position: absolute;
  inset: 0 4px;
  border-radius: 42% 42% 36% 36%;
  background: linear-gradient(145deg, #fff3dd 12%, #ffdfc7 80%);
  border: 2px solid #603b4c;
  box-shadow:
    inset 0 -3px #efbcae,
    0 2px 1px #412d4240;
}

.face-features {
  position: absolute;
  inset: 0;
  transform: translate3d(var(--face-x, 0px), var(--face-y, 0px), 0);
}

.ear {
  position: absolute;
  width: 18px;
  height: 23px;
  top: -10px;
  border: 2px solid #603b4c;
  border-radius: 70% 15% 20% 30%;
  background: #ffdfc7;
  transform-origin: 50% 90%;
}

.ear.left {
  left: 6px;
  transform: rotate(calc(-22deg + var(--ear-l, 0deg)));
}

.ear.right {
  right: 6px;
  transform: scaleX(-1) rotate(calc(-22deg + var(--ear-r, 0deg)));
}

.ear::before {
  content: "";
  position: absolute;
  inset: 4px 3px;
  background: #efa5a6;
  border-radius: inherit;
}

.band {
  position: absolute;
  z-index: 1;
  inset: -4px 1px 8px;
  border: 4px solid color-mix(in srgb, rgb(var(--s-primary)) 38%, #49323e);
  border-bottom: 0;
  border-radius: 46% 46% 40% 40%;
}

.cup {
  position: absolute;
  z-index: 2;
  width: 10px;
  height: 20px;
  top: 17px;
  border-radius: 6px;
  border: 2px solid #624352;
  background: linear-gradient(90deg, rgb(var(--s-primary-container)), rgb(var(--s-primary)));
}

.cup.left {
  left: -1px;
  transform: rotate(calc(-8deg + var(--ear-l, 0deg) * 0.2));
}

.cup.right {
  right: -1px;
  transform: rotate(calc(8deg - var(--ear-r, 0deg) * 0.2));
}

.eye {
  position: absolute;
  top: 17px;
  width: 5px;
  height: 7px;
  background: #543845;
  border-radius: 50%;
  transform-origin: 50% 60%;
  transform: translate3d(var(--gaze-x, 0px), var(--gaze-y, 0px), 0);
  transition:
    height 180ms var(--spring-soft),
    border-radius 180ms ease-out;
}

.eye::after {
  content: "";
  position: absolute;
  top: 1.5px;
  left: 1px;
  width: 1.8px;
  height: 1.8px;
  border-radius: 50%;
  background: #fff9f2;
  opacity: 0.92;
  transition: opacity 140ms ease-out;
}

.eye.left {
  left: 12px;
}

.eye.right {
  right: 12px;
}

.mouth {
  position: absolute;
  top: 22px;
  left: calc(50% - 4px);
  width: 8px;
  height: 6px;
  border: solid #694151;
  border-width: 0 0 2px;
  border-radius: 50%;
  transform-origin: 50% 40%;
  transform: scale(calc(1 + var(--groove, 0) * 0.08), calc(1 + var(--groove, 0) * 0.24));
  transition:
    height 200ms var(--spring-soft),
    width 200ms var(--spring-soft),
    border-radius 180ms ease-out,
    background-color 180ms ease-out;
}

.cheek {
  position: absolute;
  top: 25px;
  width: 7px;
  height: 3px;
  border-radius: 50%;
  background: #e89a9a;
  opacity: calc(0.74 + var(--groove, 0) * 0.26);
  transform: scale(calc(1 + var(--groove, 0) * 0.14));
  transition:
    opacity 240ms ease-out,
    scale 280ms var(--spring-soft);
}

.cheek.left {
  left: 6px;
}

.cheek.right {
  right: 6px;
}

.thinking .mouth {
  width: 5px;
  height: 4px;
  left: calc(50% - 2.5px);
  top: 24px;
  border-width: 1.8px;
  border-radius: 50%;
  transform: scale(0.92);
}

.curious .eye.right {
  height: 8px;
  top: 16px;
}

.curious .mouth {
  width: 6px;
  height: 5px;
  left: calc(50% - 3px);
  top: 23.5px;
  border-width: 1.8px;
  border-radius: 50%;
}

.happy .eye {
  height: 6px;
  border-radius: 50% 50% 0 0;
  background: none;
  border-top: 3px solid #543845;
}

.happy .eye::after {
  opacity: 0;
}

.happy .mouth {
  height: 7px;
  background: #985461;
  border-radius: 0 0 8px 8px;
}

.happy .cheek {
  opacity: 0.98;
  scale: 1.18;
}

.dragging .eye {
  height: 7.5px;
}

.dragging .mouth {
  width: 5.5px;
  height: 5.5px;
  left: calc(50% - 2.75px);
  top: 23.5px;
  border-width: 1.8px;
  border-radius: 50%;
}

/* 两个互质周期叠加的自然呼吸，仅在窗口可见且允许动态效果时启用，避免固定节拍循环的机械感 */
@media (prefers-reduced-motion: no-preference) {
  html:not([data-reduced-motion], [data-theme-visibility="hidden"])
    .character:not(.dragging)
    .breath-primary {
    animation: avatar-float 3.7s ease-in-out infinite;
  }

  html:not([data-reduced-motion], [data-theme-visibility="hidden"])
    .character:not(.dragging)
    .breath-secondary {
    animation: avatar-breathe 6.1s ease-in-out infinite;
  }

  html:not([data-reduced-motion], [data-theme-visibility="hidden"])
    .character[data-blink="single"]
    .eye {
    animation: avatar-blink-once 170ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  html:not([data-reduced-motion], [data-theme-visibility="hidden"])
    .character[data-blink="double"]
    .eye {
    animation: avatar-blink-twice 400ms cubic-bezier(0.4, 0, 0.2, 1);
  }
}

html[data-reduced-motion] .head,
html[data-reduced-motion] .headphone-rig,
html[data-reduced-motion] .face-features,
html[data-reduced-motion] .eye,
html[data-reduced-motion] .eye::after,
html[data-reduced-motion] .mouth,
html[data-reduced-motion] .cheek {
  transition: none;
}

html[data-reduced-motion] .thinking .eye {
  transform: translate3d(2px, -2px, 0);
}

@keyframes avatar-float {
  0%,
  100% {
    transform: translate3d(0, 0.6px, 0);
  }
  50% {
    transform: translate3d(0, -0.9px, 0);
  }
}

@keyframes avatar-breathe {
  0%,
  100% {
    transform: scale(1.006, 0.994);
  }
  50% {
    transform: scale(0.993, 1.014);
  }
}

@keyframes avatar-blink-once {
  0%,
  100% {
    scale: 1 1;
  }
  45% {
    scale: 1.08 0.08;
  }
}

@keyframes avatar-blink-twice {
  0%,
  100% {
    scale: 1 1;
  }
  20% {
    scale: 1.08 0.08;
  }
  42% {
    scale: 1 1;
  }
  68% {
    scale: 1.08 0.08;
  }
}
</style>
