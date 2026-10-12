import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalInPeriod, goalProgress, weeksOfMonth } from './goals';
import type { Task } from './types';

const task = (p: Partial<Task>): Task => ({ id: 'x', kind: 'timed', title: 't', date: '2026-10-05', start: '18:00', dur: 60, color: 0, icon: 'alarm', repeat: 'daily', remind: 0, target: null, links: [], done: {}, ...p });

test('a linked weekly goal completes itself at the target', () => {
  const gym = task({ id: 'gym', done: { '2026-10-05': true, '2026-10-06': true, '2026-10-08': true } });
  const goal = task({ id: 'g', kind: 'week', title: 'Gym 4x', start: null, dur: null, repeat: 'weekly', target: 4, links: ['gym'] });
  assert.deepEqual(goalProgress(goal, '2026-10-05', [gym, goal]), { count: 3, target: 4, auto: false, done: false });
  gym.done['2026-10-10'] = true;
  assert.equal(goalProgress(goal, '2026-10-05', [gym, goal]).done, true);
  // The next week starts from zero.
  assert.equal(goalProgress(goal, '2026-10-12', [gym, goal]).count, 0);
});

test('weekly ticks only count days the task actually happens', () => {
  const mon = task({ id: 'm', repeat: 'weekly', done: { '2026-10-05': true, '2026-10-06': true } });
  const goal = task({ id: 'g', kind: 'week', start: null, dur: null, target: 2, links: ['m'] });
  assert.equal(goalProgress(goal, '2026-10-05', [mon, goal]).count, 1);
});

test('a monthly goal can count weeks in which a weekly goal was met', () => {
  const gym = task({ id: 'gym', date: '2026-09-28', done: Object.fromEntries(['2026-10-05', '2026-10-06', '2026-10-12', '2026-10-13'].map((d) => [d, true])) });
  const weekly = task({ id: 'w', kind: 'week', date: '2026-09-28', start: null, dur: null, repeat: 'weekly', target: 2, links: ['gym'] });
  const monthly = task({ id: 'm', kind: 'month', date: '2026-10-01', start: null, dur: null, target: 3, links: ['w'] });
  assert.deepEqual(weeksOfMonth('2026-10'), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(goalProgress(monthly, '2026-10', [gym, weekly, monthly]).count, 2);
  // Ticking the weekly goal by hand counts too.
  weekly.done['2026-10-19'] = true;
  assert.equal(goalProgress(monthly, '2026-10', [gym, weekly, monthly]).done, true);
});

test('repeating goals show up in later periods, one-off goals only in their own', () => {
  assert.equal(goalInPeriod(task({ kind: 'week', date: '2026-10-07', repeat: 'weekly' }), '2026-10-19'), true);
  assert.equal(goalInPeriod(task({ kind: 'week', date: '2026-10-07', repeat: 'none' }), '2026-10-19'), false);
  assert.equal(goalInPeriod(task({ kind: 'week', date: '2026-10-07', repeat: 'weekly' }), '2026-09-28'), false);
  assert.equal(goalInPeriod(task({ kind: 'month', date: '2026-10-07', repeat: 'monthly' }), '2026-12'), true);
});
