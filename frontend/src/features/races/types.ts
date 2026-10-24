export type Race = {
  id: number;
  name: string;
  race_date: string;
  status: 'setup' | 'ready' | 'running' | 'completed';
  start_at: string | null;
  completed_at: string | null;
  rosterCount?: number;
  finishCount?: number;
  roster_count?: number;
  finish_count?: number;
};

export type Runner = {
  id: number;
  idKey: string;
  name: string;
  category: string;
  finishedAt: string;
  finished?: boolean;
};

export type ImportPreview = {
  records: Array<{ idKey: string; name: string; category: string }>;
  errors: Array<{ line: number; error: string }>;
  additions: number;
  updates: number;
};
