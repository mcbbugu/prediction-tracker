export type SourcePerson = {
  id: string;
  name_zh: string;
  name_en: string;
};

export type RawDoc = {
  url: string;
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
