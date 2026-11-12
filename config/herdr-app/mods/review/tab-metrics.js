// The review tab's sizes. They follow the terminal font (settings().font_size is before zoom, as mod px are):
// code rows match the terminals; notes and threads use at least 13 px. metrics() refreshes them per frame.
import { settings } from "herdr";

export const M = { CODE: 14, ROW: 20, FILE_ROW: 30, TEXT: 14, LINE: 20, COMPOSER: 124 };
// Inserted rows have exact heights (no guess, so nothing drifts): a draft's frame, a thread chip.
export const NOTE_PAD = 40, CHIP = 32;
// A GitHub comment shows at most this many lines in the diff.
export const BODY_LINES = 12;
export const FILES_RAIL = 36;

export function metrics() {
  M.CODE = Number(settings().font_size) || 14;
  M.ROW = Math.round(M.CODE * 1.45);
  M.FILE_ROW = Math.max(30, M.ROW + 10);
  M.TEXT = Math.max(13, M.CODE);
  M.LINE = Math.round(M.TEXT * 1.45);
  M.COMPOSER = M.LINE * 3 + 64;
}
