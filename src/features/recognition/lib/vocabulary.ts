import { centroid } from '../../../shared/geometry';
import type { Contacts, Limb, MoveRecord, Route } from '../../../shared/types';
import { grip, holdAt } from '../../wall';
import { body, isHand, limbNames, limbs } from '../../limbs';

export type ActionKind = 'cross' | 'flag' | 'footswap';
export type EvidenceRule = 'sequence' | 'facing' | 'load';

export interface Evidence {
  rule: EvidenceRule;
  text: string;
  weight: number;
}

export interface ActionSegment {
  id: string;
  kind: ActionKind;
  mirror: 'left' | 'right';
  mover: Limb;
  limbs: Limb[];
  from: number;
  to: number;
  key: number;
  evidence: Evidence[];
  strength: number;
  explained: number;
}

export const kindNames: Record<ActionKind, string> = { cross: '交叉手', flag: '旗式', footswap: '换脚' };
export const ruleNames: Record<EvidenceRule, string> = { sequence: '落点顺序', facing: '身体朝向', load: '对侧受力' };

export function kindLabel(segment: Pick<ActionSegment, 'kind' | 'mirror'>) {
  const left = segment.mirror === 'left';
  if (segment.kind === 'cross') return '交叉手 · ' + (left ? '左越右' : '右越左');
  if (segment.kind === 'flag') return '旗式 · ' + (left ? '左旗' : '右旗');
  return '换脚 · ' + (left ? '左脚接上' : '右脚接上');
}

const opposite: Record<Limb, Limb> = { lh: 'rh', rh: 'lh', lf: 'rf', rf: 'lf' };

interface Frame {
  contacts: Contacts;
  centerX: number;
  facing: number;
  loads: Record<Limb, number>;
}

/** 每帧姿态事实：身体中线、朝向（脚相对手的水平偏移）与四肢承重份额 */
function frames(route: Route, moves: MoveRecord[]): Frame[] {
  const states = [moves[0].before, ...moves.map(record => record.next)];
  return states.map(contacts => {
    const center = body(route, contacts);
    const hands = centroid([holdAt(route, contacts.lh), holdAt(route, contacts.rh)]);
    const feet = centroid([holdAt(route, contacts.lf), holdAt(route, contacts.rf)]);
    const raw = limbs.map(limb => {
      const hold = holdAt(route, contacts[limb]);
      const dx = Math.abs(hold.x - center.x);
      const dy = Math.abs(hold.y - center.y);
      return grip[hold.kind].support * 60 / (30 + dx + dy * .35);
    });
    const total = raw.reduce((sum, value) => sum + value, 0) || 1;
    return {
      contacts,
      centerX: center.x,
      facing: feet.x - hands.x,
      loads: { lh: raw[0] / total, rh: raw[1] / total, lf: raw[2] / total, rf: raw[3] / total },
    };
  });
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function loadEvidence(before: Frame, after: Frame, limb: Limb, text: string): Evidence | null {
  const delta = after.loads[limb] - before.loads[limb];
  if (delta < .05) return null;
  const weight = Math.min(2.5, Math.max(.5, Math.round(delta * 12) / 2));
  return { rule: 'load', text: text + '承重 +' + Math.round(delta * 100) + '%', weight };
}

function finish(id: string, kind: ActionKind, mover: Limb, active: Limb[], from: number, to: number, key: number, evidence: Evidence[], explained: number): ActionSegment | null {
  if (!evidence.some(item => item.rule === 'sequence') || evidence.length < 2) return null;
  return {
    id, kind, mover, limbs: active, from, to, key, evidence,
    mirror: mover.startsWith('l') ? 'left' : 'right',
    strength: round1(evidence.reduce((sum, item) => sum + item.weight, 0)),
    explained,
  };
}

/** 交叉手：动手越过静止手落到对侧；身体中线被越过；对侧手承接负荷。左右镜像同一条规则 */
function detectCross(route: Route, moves: MoveRecord[], pose: Frame[], i: number): ActionSegment | null {
  const record = moves[i];
  const hand = record.move.limb;
  if (!isHand(hand) || record.failure) return null;
  const other = opposite[hand];
  const start = holdAt(route, record.before[hand]);
  const target = holdAt(route, record.move.target);
  const anchor = holdAt(route, record.before[other]);
  const evidence: Evidence[] = [];
  const fromSide = start.x - anchor.x;
  const toSide = target.x - anchor.x;
  if (Math.abs(fromSide) >= 12 && fromSide * toSide < 0 && Math.abs(toSide) >= 24) {
    evidence.push({ rule: 'sequence', text: limbNames[hand] + '越过' + limbNames[other] + '落到对侧点 ' + record.move.target, weight: 3 });
  }
  const mid = pose[i].centerX;
  if (Math.abs(start.x - mid) >= 10 && (start.x - mid) * (target.x - mid) < 0) {
    evidence.push({ rule: 'facing', text: '手臂越过身体中线，肩胯朝向随之反转', weight: 2 });
  }
  const load = loadEvidence(pose[i], pose[i + 1], other, limbNames[other]);
  if (load) evidence.push(load);
  return finish('cross-' + i, 'cross', hand, [hand], i, i, i, evidence, record.distance);
}

/** 旗式：脚越过中线或外展到远侧支点；髋部扭转打开；对侧脚承接重心、旗脚只作平衡 */
function detectFlag(route: Route, moves: MoveRecord[], pose: Frame[], i: number): ActionSegment | null {
  const record = moves[i];
  const foot = record.move.limb;
  if (isHand(foot) || record.failure) return null;
  const other = opposite[foot];
  const start = holdAt(route, record.before[foot]);
  const target = holdAt(route, record.move.target);
  const evidence: Evidence[] = [];
  const fromOffset = start.x - pose[i].centerX;
  const toOffset = target.x - pose[i + 1].centerX;
  if (Math.abs(fromOffset) >= 10 && fromOffset * toOffset < 0 && Math.abs(toOffset) >= 20) {
    evidence.push({ rule: 'sequence', text: limbNames[foot] + '越过身体中线落到对侧点 ' + record.move.target, weight: 3 });
  } else if (Math.abs(toOffset) >= 92 && Math.abs(toOffset) - Math.abs(fromOffset) >= 24) {
    evidence.push({ rule: 'sequence', text: limbNames[foot] + '外展到远侧点 ' + record.move.target + ' 作平衡支点', weight: 2 });
  }
  const twist = Math.abs(pose[i + 1].facing - pose[i].facing);
  if (twist >= 8) evidence.push({ rule: 'facing', text: '髋部朝向扭转 ' + Math.round(twist) + '，身体侧向打开', weight: 1.5 });
  const load = loadEvidence(pose[i], pose[i + 1], other, limbNames[other]);
  if (load && pose[i + 1].loads[foot] <= .26) evidence.push({ ...load, text: load.text + '，' + limbNames[foot] + '仅作平衡' });
  // 旗式的定义性特征是重心倒向对侧脚，缺少受力证据不成立
  if (!evidence.some(item => item.rule === 'load')) return null;
  return finish('flag-' + i, 'flag', foot, [foot], i, i, i, evidence, record.distance);
}

/** 换脚：一脚让出落点，对侧脚在三步窗口内顺序接上；重心在双脚间转移 */
function detectFootswap(moves: MoveRecord[], pose: Frame[], i: number): ActionSegment | null {
  const record = moves[i];
  const foot = record.move.limb;
  if (isHand(foot) || record.failure) return null;
  const other = opposite[foot];
  const freed = record.before[foot];
  for (let j = i + 1; j <= Math.min(i + 2, moves.length - 1); j++) {
    const landing = moves[j];
    if (landing.move.limb !== other || landing.move.target !== freed || landing.failure) continue;
    const evidence: Evidence[] = [
      { rule: 'sequence', text: limbNames[foot] + '让出点 ' + freed + '，' + limbNames[other] + '顺序接上', weight: 3 },
    ];
    const load = loadEvidence(pose[i], pose[j + 1], other, limbNames[other]);
    if (load) evidence.push(load);
    const shift = Math.abs(pose[j + 1].facing - pose[i].facing);
    if (shift >= 8) evidence.push({ rule: 'facing', text: '换脚后髋部朝向移动 ' + Math.round(shift), weight: 1.5 });
    let explained = 0;
    for (let k = i; k <= j; k++) if (!isHand(moves[k].move.limb)) explained += moves[k].distance;
    return finish('footswap-' + i + '-' + j, 'footswap', other, [foot, other], i, j, j, evidence, explained);
  }
  return null;
}

/** 从完攀/坠落记录中识别全部候选动作片段 */
export function detect(route: Route, moves: MoveRecord[]): ActionSegment[] {
  if (!moves.length) return [];
  const pose = frames(route, moves);
  const found: ActionSegment[] = [];
  for (let i = 0; i < moves.length; i++) {
    const cross = detectCross(route, moves, pose, i);
    if (cross) found.push(cross);
    const flag = detectFlag(route, moves, pose, i);
    if (flag) found.push(flag);
    const swap = detectFootswap(moves, pose, i);
    if (swap) found.push(swap);
  }
  return found;
}
