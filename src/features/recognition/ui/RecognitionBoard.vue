<script setup lang="ts">
import { computed, toRef } from 'vue';
import { Crosshair, Pin, PinOff, ScanSearch, Swords } from 'lucide-vue-next';
import type { Attempt, Route } from '../../../shared/types';
import { limbNames, limbTags } from '../../limbs';
import { kindLabel, ruleNames, type ActionSegment } from '../lib/vocabulary';
import { useRecognition } from '../model/useRecognition';

const CELL = 78;

const props = defineProps<{ route: Route; attempt: Attempt; step: number }>();
defineEmits<{ jump: [index: number] }>();

const { solution, pinnedIds, totalDistance, togglePin } = useRecognition(toRef(props, 'route'), toRef(props, 'attempt'));

const trackWidth = computed(() => props.attempt.moves.length * CELL);
const laned = computed(() => {
  const lanes: ActionSegment[][] = [];
  return solution.value.segments.map(segment => {
    let lane = lanes.findIndex(row => row.every(other => other.to < segment.from || segment.to < other.from));
    if (lane === -1) lane = lanes.push([]) - 1;
    lanes[lane].push(segment);
    return { segment, lane };
  });
});
const laneCount = computed(() => Math.max(1, ...laned.value.map(item => item.lane + 1)));
const covered = computed(() => {
  const set = new Set<number>();
  for (const segment of solution.value.segments) for (let k = segment.from; k <= segment.to; k++) set.add(k);
  return set;
});
const blankCount = computed(() => props.attempt.moves.length - covered.value.size);
const contestedSteps = computed(() => new Set(solution.value.contested.flatMap(item => item.steps)));

function range(segment: ActionSegment) {
  return segment.to > segment.from ? '第 ' + (segment.from + 1) + '–' + (segment.to + 1) + ' 步' : '第 ' + (segment.from + 1) + ' 步';
}
</script>

<template>
  <section class="recognition" aria-label="动作识别台">
    <div class="section-heading">
      <h2><ScanSearch :size="17" /> 动作识别台</h2>
      <span>{{ route.name }} · {{ attempt.moves.length }} 步 · 位移解释 {{ solution.explained }} / {{ totalDistance }}</span>
    </div>
    <p class="recog-legend">动作词由<b>落点顺序</b>、<b>身体朝向</b>、<b>对侧肢体受力</b>定义，同一规则识别左右镜像版本；相邻片段可共享边缘接触作为证据，但承重的同一肢体不会被两段动作同时当作主动者；覆盖并列时以证据强度决胜，无法判断的区间留白。</p>

    <div class="recog-scroll">
      <div class="recog-track" :style="{ width: trackWidth + 'px' }">
        <div class="recog-lanes" :style="{ height: laneCount * 26 + 'px' }">
          <button v-for="item in laned" :key="item.segment.id" class="recog-bar" type="button"
            :class="[item.segment.kind, { pinned: pinnedIds.includes(item.segment.id) }]"
            :style="{ left: item.segment.from * CELL + 3 + 'px', width: (item.segment.to - item.segment.from + 1) * CELL - 8 + 'px', top: item.lane * 26 + 'px' }"
            :title="kindLabel(item.segment) + ' · 证据 ' + item.segment.strength + ' · 点击回到实际姿态'"
            @click="$emit('jump', item.segment.key)">{{ kindLabel(item.segment) }}</button>
        </div>
        <div class="recog-cells">
          <button v-for="(record, i) in attempt.moves" :key="i" class="recog-cell" type="button"
            :class="{ current: i === step, covered: covered.has(i), clash: contestedSteps.has(i) }"
            @click="$emit('jump', i)">
            <small>第 {{ i + 1 }} 步</small>
            <b>{{ limbTags[record.move.limb] }} → {{ record.move.target }}</b>
            <small>位移 {{ record.distance }}</small>
          </button>
        </div>
      </div>
    </div>
    <p v-if="blankCount" class="recog-blank">留白 {{ blankCount }} 步：证据不足，暂不标注。点击任意步可回看该步实际姿态。</p>

    <div class="recog-columns">
      <div class="recog-list">
        <h3>识别片段 · {{ solution.segments.length }}</h3>
        <p v-if="!solution.segments.length" class="empty">没有识别出动作片段</p>
        <article v-for="segment in solution.segments" :key="segment.id" class="recog-item"
          :class="[segment.kind, { pinned: pinnedIds.includes(segment.id) }]">
          <div class="recog-item-head">
            <b>{{ kindLabel(segment) }}</b>
            <span>{{ range(segment) }} · {{ limbNames[segment.mover] }}主动 · 证据 {{ segment.strength }}</span>
          </div>
          <ul>
            <li v-for="(item, k) in segment.evidence" :key="k"><i>{{ ruleNames[item.rule] }}</i>{{ item.text }} <em>+{{ item.weight }}</em></li>
          </ul>
          <div class="recog-item-actions">
            <button type="button" @click="$emit('jump', segment.key)"><Crosshair :size="14" /> 回到姿态</button>
            <button type="button" @click="togglePin(segment.id)">
              <PinOff v-if="pinnedIds.includes(segment.id)" :size="14" /><Pin v-else :size="14" />
              {{ pinnedIds.includes(segment.id) ? '取消固定' : '固定范围' }}
            </button>
          </div>
        </article>
      </div>

      <div class="recog-side">
        <template v-if="solution.contested.length">
          <h3><Swords :size="15" /> 互抢片段 · {{ solution.contested.length }}</h3>
          <article v-for="item in solution.contested" :key="item.candidate.id" class="recog-item contested">
            <div class="recog-item-head">
              <b>{{ kindLabel(item.candidate) }}</b>
              <span>与「{{ kindLabel(item.rival) }}」互抢第 {{ item.steps.map(s => s + 1).join('、') }} 步</span>
            </div>
            <div class="recog-item-actions">
              <button type="button" @click="$emit('jump', item.candidate.key)"><Crosshair :size="14" /> 回到姿态</button>
              <button type="button" @click="togglePin(item.candidate.id)"><Pin :size="14" /> 改固定此项</button>
            </div>
          </article>
        </template>
        <template v-if="solution.pool.length">
          <h3>候选未采用 · {{ solution.pool.length }}</h3>
          <article v-for="segment in solution.pool" :key="segment.id" class="recog-item idle">
            <div class="recog-item-head">
              <b>{{ kindLabel(segment) }}</b>
              <span>{{ range(segment) }} · 证据 {{ segment.strength }}</span>
            </div>
            <div class="recog-item-actions">
              <button type="button" @click="$emit('jump', segment.key)"><Crosshair :size="14" /> 回到姿态</button>
              <button type="button" @click="togglePin(segment.id)"><Pin :size="14" /> 固定范围</button>
            </div>
          </article>
        </template>
      </div>
    </div>
  </section>
</template>
