import { COMPANION_REPLY_BUBBLE_SECONDS } from "@shared/types/companion";
import type { SettingCategory } from "@/types/settings-schema";
import McpConfigDialog from "@/components/settings/custom/McpConfigDialog.vue";
import McpStatusCard from "@/components/settings/custom/McpStatusCard.vue";
import AiModelConfig from "@/components/settings/custom/AiModelConfig.vue";
import IconLucideBot from "~icons/lucide/bot";

const aiIntegrationCategory: SettingCategory = {
  id: "aiIntegration",
  icon: IconLucideBot,
  sections: [
    {
      id: "aiModel",
      tag: { text: "Beta" },
      items: [
        {
          key: "aiModelConfig",
          type: "custom",
          component: AiModelConfig,
          fullWidth: true,
          searchable: false,
        },
      ],
    },
    {
      id: "companion",
      items: [
        {
          key: "companionEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.companion.enabled" },
          defaultValue: false,
          hideChildren: true,
          children: [
            {
              key: "companionAvatar",
              type: "switch",
              binding: { store: "settings", path: "system.companion.showAvatar" },
              defaultValue: true,
              hideChildren: true,
              children: [
                {
                  key: "companionReplyBubble",
                  type: "switch",
                  binding: { store: "settings", path: "system.companion.replyBubble" },
                  defaultValue: true,
                  hideChildren: true,
                  children: [
                    {
                      key: "companionReplyBubbleSeconds",
                      type: "number",
                      binding: { store: "settings", path: "system.companion.replyBubbleSeconds" },
                      defaultValue: COMPANION_REPLY_BUBBLE_SECONDS.default,
                      min: COMPANION_REPLY_BUBBLE_SECONDS.min,
                      max: COMPANION_REPLY_BUBBLE_SECONDS.max,
                      step: 1,
                      unit: "s",
                    },
                  ],
                },
                {
                  key: "companionTop",
                  type: "switch",
                  binding: { store: "settings", path: "system.companion.alwaysOnTop" },
                  defaultValue: true,
                },
                {
                  key: "companionThrough",
                  type: "switch",
                  binding: { store: "settings", path: "system.companion.clickThrough" },
                  defaultValue: false,
                },
              ],
            },
            {
              key: "companionProactive",
              type: "switch",
              binding: { store: "settings", path: "system.companion.proactive" },
              defaultValue: false,
            },
            {
              key: "companionDanmaku",
              type: "switch",
              binding: { store: "settings", path: "system.companion.danmaku" },
              defaultValue: true,
              hideChildren: true,
              children: [
                {
                  key: "companionSeconds",
                  type: "number",
                  binding: { store: "settings", path: "system.companion.danmakuSeconds" },
                  defaultValue: 9,
                  min: 5,
                  max: 18,
                  step: 1,
                  unit: "s",
                },
                {
                  key: "companionLanes",
                  type: "number",
                  binding: { store: "settings", path: "system.companion.danmakuLanes" },
                  defaultValue: 2,
                  min: 1,
                  max: 3,
                  step: 1,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "mcp",
      tag: { text: "Beta" },
      items: [
        {
          key: "mcpStatusCard",
          type: "custom",
          component: McpStatusCard,
          fullWidth: true,
          searchable: false,
        },
        {
          key: "mcpEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.mcp.enabled" },
          defaultValue: false,
          hideChildren: true,
          children: [
            {
              key: "mcpPort",
              type: "number",
              binding: { store: "settings", path: "system.mcp.port" },
              min: 1024,
              max: 65535,
              defaultValue: 14569,
            },
            {
              key: "mcpConfigDetails",
              type: "custom",
              component: McpConfigDialog,
            },
          ],
        },
      ],
    },
  ],
};

export default aiIntegrationCategory;
