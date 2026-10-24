export const fmtClock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export const localDateTimeInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};

export const elapsedFinishTime = (finishedAt: string, startAt: string | null) => (
  startAt ? fmtClock(Date.parse(finishedAt) - Date.parse(startAt)) : new Date(finishedAt).toLocaleTimeString()
);
