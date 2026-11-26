import type { Limb } from '../../../shared/types';
import type { ActionSegment } from './vocabulary';

const bit: Record<Limb, number> = { lh: 1, rh: 2, lf: 4, rf: 8 };

function maskOf(segment: ActionSegment) {
  return segment.limbs.reduce((mask, limb) => mask | bit[limb], 0);
}

/**
 * 互抢判定：两段动作在时间上有共同步，且主动肢体集合相交（同一承重肢体被同时认领）。
 * 首尾相接（一段收尾的接触正是下一段的起势）不算互抢，允许共享边缘证据。
 * 返回互抢的动作步下标，空数组表示相容。
 */
export function conflictSteps(a: ActionSegment, b: ActionSegment): number[] {
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  if (from > to) return [];
  if (!a.limbs.some(limb => b.limbs.includes(limb))) return [];
  const steps: number[] = [];
  for (let k = from; k <= to; k++) steps.push(k);
  return steps;
}

export interface Contested {
  candidate: ActionSegment;
  rival: ActionSegment;
  steps: number[];
}

export interface Solution {
  segments: ActionSegment[];
  explained: number;
  strength: number;
  pool: ActionSegment[];
  contested: Contested[];
}

interface Score {
  explained: number;
  strength: number;
  picks: ActionSegment[];
}

function better(a: Score, b: Score) {
  return a.explained !== b.explained ? a.explained - b.explained : a.strength - b.strength;
}

/**
 * 选出一组相容片段：先最大化被解释的已记录位移，并列时以证据强度决胜。
 * 固定的片段强制入选，与其互抢的候选被剔除并标注。
 * 片段最长跨三步，故按步推进时只需记录未来两步的肢体占用。
 */
export function solve(moveCount: number, candidates: ActionSegment[], pinned: ActionSegment[]): Solution {
  const pinnedIds = new Set(pinned.map(segment => segment.id));
  const contested: Contested[] = [];
  const compat: ActionSegment[] = [];
  for (const candidate of candidates) {
    if (pinnedIds.has(candidate.id)) continue;
    const rival = pinned.find(segment => conflictSteps(candidate, segment).length > 0);
    if (rival) contested.push({ candidate, rival, steps: conflictSteps(candidate, rival) });
    else compat.push(candidate);
  }

  const byStart: ActionSegment[][] = Array.from({ length: Math.max(moveCount, 1) }, () => []);
  for (const candidate of compat) byStart[candidate.from].push(candidate);

  let states = new Map<number, Score>([[0, { explained: 0, strength: 0, picks: [] }]]);
  for (let i = 0; i < moveCount; i++) {
    const next = new Map<number, Score>();
    for (const [key, state] of states) {
      const busyNow = key & 15;
      const busyNext = key >> 4;
      const options: ActionSegment[][] = [[]];
      for (const candidate of byStart[i]) {
        const mask = maskOf(candidate);
        if (mask & busyNow) continue;
        for (let k = 0, len = options.length; k < len; k++) {
          if (options[k].some(other => maskOf(other) & mask)) continue;
          options.push([...options[k], candidate]);
        }
      }
      for (const subset of options) {
        let nb = busyNext;
        let nb2 = 0;
        const score: Score = { explained: state.explained, strength: state.strength, picks: state.picks };
        if (subset.length) score.picks = [...state.picks];
        for (const candidate of subset) {
          const mask = maskOf(candidate);
          if (candidate.to >= i + 1) nb |= mask;
          if (candidate.to >= i + 2) nb2 |= mask;
          score.explained += candidate.explained;
          score.strength += candidate.strength;
          score.picks.push(candidate);
        }
        const nkey = nb | (nb2 << 4);
        const current = next.get(nkey);
        if (!current || better(score, current) > 0) next.set(nkey, score);
      }
    }
    states = next;
  }

  let best: Score = { explained: 0, strength: 0, picks: [] };
  for (const state of states.values()) if (better(state, best) > 0) best = state;

  const chosen = new Set(best.picks.map(segment => segment.id));
  const segments = [...pinned, ...best.picks].sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
  return {
    segments,
    explained: pinned.reduce((sum, segment) => sum + segment.explained, 0) + best.explained,
    strength: Math.round((pinned.reduce((sum, segment) => sum + segment.strength, 0) + best.strength) * 10) / 10,
    pool: compat.filter(candidate => !chosen.has(candidate.id)),
    contested,
  };
}
