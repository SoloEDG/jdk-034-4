import { computed, ref, watch, type Ref } from 'vue';
import type { Attempt, Route } from '../../../shared/types';
import { detect, type ActionSegment } from '../lib/vocabulary';
import { conflictSteps, solve } from '../lib/solve';

export function useRecognition(route: Ref<Route>, attempt: Ref<Attempt | null>) {
  const pinnedIds = ref<string[]>([]);
  const candidates = computed<ActionSegment[]>(() => attempt.value ? detect(route.value, attempt.value.moves) : []);
  const pinned = computed(() => pinnedIds.value
    .map(id => candidates.value.find(candidate => candidate.id === id))
    .filter((candidate): candidate is ActionSegment => Boolean(candidate)));
  const solution = computed(() => solve(attempt.value?.moves.length ?? 0, candidates.value, pinned.value));
  const totalDistance = computed(() => (attempt.value?.moves ?? []).reduce((sum, record) => sum + record.distance, 0));

  function togglePin(id: string) {
    if (pinnedIds.value.includes(id)) {
      pinnedIds.value = pinnedIds.value.filter(item => item !== id);
      return;
    }
    const target = candidates.value.find(candidate => candidate.id === id);
    if (!target) return;
    // 固定新范围时，与其互抢的旧固定让位（它们会出现在互抢列表中）
    pinnedIds.value = [...pinnedIds.value.filter(item => {
      const other = candidates.value.find(candidate => candidate.id === item);
      return other && conflictSteps(target, other).length === 0;
    }), id];
  }

  watch(attempt, () => { pinnedIds.value = []; });

  return { candidates, solution, pinnedIds, totalDistance, togglePin };
}
