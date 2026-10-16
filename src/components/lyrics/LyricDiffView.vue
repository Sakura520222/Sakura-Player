<script setup lang="ts">
import { structuredPatch } from "diff";
import type { SVirtualListExposed } from "@/components/ui/SVirtualList.vue";

const props = defineProps<{ before: string; after: string }>();
const { t } = useI18n();
const list = ref<SVirtualListExposed | null>(null);
const contentHeight = ref(0);
useResizeObserver(
  () => list.value?.scrollRef?.firstElementChild as HTMLElement | undefined,
  (entries) => {
    contentHeight.value = Math.ceil(entries[0].contentRect.height);
  },
);

interface DiffRow {
  type: "context" | "added" | "removed" | "hunk" | "note";
  text: string;
  beforeLine?: number;
  afterLine?: number;
}

const difference = computed(() => {
  if (props.before === props.after) return { rows: [], added: 0, removed: 0 };
  // 大段完全重写时限制对齐开销；仍完整显示删除和新增内容，不截断歌词。
  const patch = structuredPatch("", "", props.before, props.after, "", "", {
    context: 3,
    timeout: 200,
  });
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  if (!patch) {
    for (const [text, type] of [
      [props.before, "removed"],
      [props.after, "added"],
    ] as const) {
      if (!text) continue;
      const lines = text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      lines.forEach((line, index) =>
        rows.push({
          type,
          text: line.replace(/\r$/, ""),
          beforeLine: type === "removed" ? index + 1 : undefined,
          afterLine: type === "added" ? index + 1 : undefined,
        }),
      );
      if (type === "removed") removed = lines.length;
      else added = lines.length;
      if (!text.endsWith("\n")) rows.push({ type: "note", text: "" });
    }
  } else {
    for (const hunk of patch.hunks) {
      rows.push({
        type: "hunk",
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      });
      let beforeLine = hunk.oldStart;
      let afterLine = hunk.newStart;
      for (const line of hunk.lines) {
        const prefix = line[0];
        if (prefix === "\\") {
          rows.push({ type: "note", text: "" });
          continue;
        }
        const type = prefix === "+" ? "added" : prefix === "-" ? "removed" : "context";
        rows.push({
          type,
          text: line.slice(1).replace(/\r$/, ""),
          beforeLine: type === "added" ? undefined : beforeLine++,
          afterLine: type === "removed" ? undefined : afterLine++,
        });
        if (type === "added") added++;
        if (type === "removed") removed++;
      }
    }
  }
  return { rows, added, removed };
});

const lineEndings = computed(() => {
  const endings = (text: string): string => {
    if (!text.includes("\n")) return "—";
    const crlf = text.includes("\r\n");
    return crlf ? (/([^\r]|^)\n/.test(text) ? "CRLF / LF" : "CRLF") : "LF";
  };
  const before = endings(props.before);
  const after = endings(props.after);
  return before === after ? "" : `${before} → ${after}`;
});
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-outline-variant/30">
    <div
      class="flex flex-wrap items-center gap-3 bg-surface-container px-3 py-2 text-xs text-on-surface/60"
    >
      <span>
        {{ t("player.copyLyric.preview.before") }} → {{ t("player.copyLyric.preview.after") }}
      </span>
      <span v-if="lineEndings">
        {{ t("player.copyLyric.preview.lineEndings") }}: {{ lineEndings }}
      </span>
      <span class="ml-auto text-green-700 dark:text-green-400">+{{ difference.added }}</span>
      <span class="text-red-700 dark:text-red-400">−{{ difference.removed }}</span>
    </div>
    <p v-if="!difference.rows.length" class="px-3 py-5 text-center text-xs text-on-surface/50">
      {{ t("player.copyLyric.preview.unchanged") }}
    </p>
    <SVirtualList
      v-else
      ref="list"
      :items="difference.rows"
      :item-height="24"
      :height="Math.min(Math.max(difference.rows.length * 24, contentHeight), 360)"
    >
      <template #default="{ item }">
        <div
          class="grid grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)] font-mono text-xs leading-6"
          :data-diff="item.type"
          :class="{
            'bg-green-500/12 text-green-900 dark:text-green-200': item.type === 'added',
            'bg-red-500/12 text-red-900 dark:text-red-200': item.type === 'removed',
            'bg-primary/8 text-primary': item.type === 'hunk',
            'text-on-surface/50': item.type === 'note',
          }"
        >
          <span class="select-none pr-2 text-right text-on-surface/40">{{ item.beforeLine }}</span>
          <span class="select-none pr-2 text-right text-on-surface/40">{{ item.afterLine }}</span>
          <span class="select-none">
            {{ item.type === "added" ? "+" : item.type === "removed" ? "−" : "" }}
          </span>
          <span class="min-w-0 whitespace-pre-wrap break-all pr-3">
            {{ item.type === "note" ? t("player.copyLyric.preview.noNewline") : item.text || " " }}
          </span>
        </div>
      </template>
    </SVirtualList>
  </div>
</template>
