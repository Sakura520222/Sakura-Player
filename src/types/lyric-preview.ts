import type { CompatibleLyricFormat, LyricFormat } from "@shared/types/lyrics";

export interface LyricPreviewField {
  key: "lyrics" | "translation" | "romaji" | "kana";
  before: string;
  after: string;
  beforeFormat?: LyricFormat;
  afterFormat?: LyricFormat | CompatibleLyricFormat;
}

export interface LyricSavePreviewTarget {
  key: "metadata" | "lrc" | "ttml" | "translation" | "romanization";
  label?: string;
  path?: string;
  exists?: boolean;
  needsDestination?: boolean;
  error?: string;
  fields: LyricPreviewField[];
}
