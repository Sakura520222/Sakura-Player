import type { LyricFormat } from "@shared/types/lyrics";

export interface LyricPreviewField {
  key: "lyrics" | "translation" | "romaji" | "kana";
  before: string;
  after: string;
  beforeFormat?: LyricFormat;
  afterFormat?: LyricFormat;
}

export interface LyricSavePreviewTarget {
  key: "metadata" | "lrc" | "ttml";
  path?: string;
  exists?: boolean;
  needsDestination?: boolean;
  error?: string;
  fields: LyricPreviewField[];
}
