export type LeaderboardFinish = {
  idKey?: string;
  name: string;
  category: string;
  finishedAt: string;
};

export type LeaderboardSortColumn = 'place' | 'runner' | 'category' | 'finishTime';
export type LeaderboardSortDirection = 'asc' | 'desc';
export type RankedFinish<T extends LeaderboardFinish> = { runner: T; place: number };

export function getLeaderboardRows<T extends LeaderboardFinish>(
  finishes: T[],
  categoryFilter: string | null,
  sortColumn: LeaderboardSortColumn,
  sortDirection: LeaderboardSortDirection,
): RankedFinish<T>[] {
  const filtered = categoryFilter === null ? finishes : finishes.filter((runner) => runner.category === categoryFilter);
  const officialOrder = filtered.map((runner, originalIndex) => ({ runner, originalIndex }))
    .sort((left, right) => Date.parse(left.runner.finishedAt) - Date.parse(right.runner.finishedAt) || left.originalIndex - right.originalIndex);
  const places = new Map(officialOrder.map(({ runner }, index) => [runner, index + 1]));
  return filtered.map((runner, originalIndex) => ({ runner, originalIndex }))
    .sort((left, right) => {
      let comparison = 0;
      if (sortColumn === 'place' || sortColumn === 'finishTime') {
        comparison = Date.parse(left.runner.finishedAt) - Date.parse(right.runner.finishedAt);
      } else if (sortColumn === 'runner') {
        comparison = left.runner.name.localeCompare(right.runner.name, undefined, { sensitivity: 'base', numeric: true });
      } else {
        comparison = left.runner.category.localeCompare(right.runner.category, undefined, { sensitivity: 'base', numeric: true });
      }
      if (sortDirection === 'desc') comparison = -comparison;
      return comparison || left.originalIndex - right.originalIndex;
    })
    .map(({ runner }) => ({ runner, place: places.get(runner) ?? 0 }));
}
