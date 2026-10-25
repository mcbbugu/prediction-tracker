export type SourcePerson = {
  id: string;
  name_zh: string;
  name_en: string;
};

export type RawDoc = {
  url: string;
  // Where the bytes actually came from, if the adapter fetched them itself (after redirects).
  finalUrl?: string;
  status?: number;
  // Captions and transcripts: auto = machine speech recognition (may mishear), manual = made by a person.
  transcriptKind?: "auto" | "manual";
  title: string;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
};

export type AdapterResult = {
  docs: RawDoc[];
  searches: number;
  detail: string;
  searchLog: { query: string; urls: string[]; error?: string }[];
};

export type SourceAdapter = {
  name: string;
  find(person: SourcePerson, ctx: { clues: string[]; searchesUsed: number }): Promise<AdapterResult>;
};
