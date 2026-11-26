export { detect, kindLabel, kindNames, ruleNames } from './lib/vocabulary';
export type { ActionKind, ActionSegment, Evidence, EvidenceRule } from './lib/vocabulary';
export { conflictSteps, solve } from './lib/solve';
export type { Contested, Solution } from './lib/solve';
export { useRecognition } from './model/useRecognition';
export { default as RecognitionBoard } from './ui/RecognitionBoard.vue';
