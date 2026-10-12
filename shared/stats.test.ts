import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestStreak, currentStreak, recentOccurrences, taskRate, weekTally } from './stats';
import type { Task } from './types';

const task = (p: Partial<Task>): Task => ({ id: 'x', kind: 'timed', title: 't', date: '2026-10-01', start: '07:00', dur: 30, color: 0, icon: 'alarm', repeat: 'daily', remind: 0, target: null, links: [], done: {}, ...p });
const days = (...ds: string[]) => Object.fromEntries(ds.map((d) => [d, true]));

test('a streak counts back from today; today still open does not break it', () => {
  const t = task({ done: days('2026-10-08', '2026-10-09', '2026-10-10') });
  assert.equal(currentStreak(t, '2026-10-11'), 3);
  t.done['2026-10-11'] = true;
  assert.equal(currentStreak(t, '2026-10-11'), 4);
  assert.equal(currentStreak(t, '2026-10-12'), 4);
  assert.equal(currentStreak(t, '2026-10-13'), 0, 'missing yesterday breaks it');
});

test('weekly habits count weeks; one-off tasks have no streak', () => {
  const w = task({ repeat: 'weekly', date: '2026-10-05', done: days('2026-10-05', '2026-10-12') });
  assert.equal(currentStreak(w, '2026-10-14'), 2);
  assert.equal(currentStreak(task({ repeat: 'none', done: days('2026-10-01') }), '2026-10-01'), 0);
});

test('best streak remembers the longest run', () => {
  const t = task({ done: days('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06') });
  assert.equal(bestStreak(t, '2026-10-07'), 4);
});

test('week tallies stop at today, and rates skip today until it is ticked', () => {
  const a = task({ id: 'a', done: days('2026-10-05', '2026-10-06') });
  const b = task({ id: 'b', repeat: 'weekly', date: '2026-10-05' });
  assert.deepEqual(weekTally([a, b], '2026-10-07', '2026-10-07'), { planned: 4, done: 2 });
  assert.deepEqual(taskRate(a, '2026-10-07', 7), { planned: 6, done: 2 });
  assert.deepEqual(recentOccurrences(a, '2026-10-03', 5).map((o) => o.done), [false, false, false]);
});
