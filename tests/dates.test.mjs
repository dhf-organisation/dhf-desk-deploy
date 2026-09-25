import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPureFunctions } from './lib/load-pure-functions.mjs';

// These functions read the LOCAL calendar date off a Date object, so the
// result depends on the runner's timezone unless pinned. Pin it to the
// business's actual timezone rather than assuming the CI runner defaults to
// UTC — that's also what these functions exist to get right for real users.
process.env.TZ = 'Australia/Melbourne';

const { isoDateOnly, toDateInputValue, sameLocalDate, isMultiDayJob } = loadPureFunctions([
  'isoDateOnly',
  'toDateInputValue',
  'sameLocalDate',
  'isMultiDayJob',
]);

test('isoDateOnly: formats using local getters, not UTC (the PR #28 bug)', () => {
  // Deliberately picked so UTC and local slice(0,10) would disagree for many
  // Australian timezones if this regressed to toISOString().slice(0,10).
  const d = new Date(2026, 2, 5); // 5 March 2026, local midnight
  assert.equal(isoDateOnly(d), '2026-03-05');
});

test('isoDateOnly: zero-pads single-digit month and day', () => {
  const d = new Date(2026, 0, 1); // 1 January 2026
  assert.equal(isoDateOnly(d), '2026-01-01');
});

test('toDateInputValue: delegates to isoDateOnly (PR #28 fix — no independent UTC formatting)', () => {
  const d = new Date(2026, 8, 25);
  assert.equal(toDateInputValue(d), isoDateOnly(d));
  assert.equal(toDateInputValue(d), '2026-09-25');
});

test('sameLocalDate: true for the same local calendar day at different times', () => {
  assert.equal(sameLocalDate(new Date(2026, 5, 1, 0, 5), new Date(2026, 5, 1, 23, 55)), true);
});

test('sameLocalDate: false across a day boundary', () => {
  assert.equal(sameLocalDate(new Date(2026, 5, 1, 23, 59), new Date(2026, 5, 2, 0, 1)), false);
});

test('isMultiDayJob: false when booked_at or pickup_at is missing', () => {
  assert.equal(isMultiDayJob({}), false);
  assert.equal(isMultiDayJob({ booked_at: '2026-06-01T09:00:00Z' }), false);
});

test('isMultiDayJob: false when pickup and booking share a local date, even hours apart (PR #43 bug)', () => {
  // Both timestamps land on the same LOCAL date. Comparing raw UTC
  // slice(0,10) instead used to falsely call this multi-day for any booking
  // late enough in the day that UTC had already rolled to the next date.
  const job = { booked_at: '2026-06-01T23:30:00+10:00', pickup_at: '2026-06-01T23:45:00+10:00' };
  assert.equal(isMultiDayJob(job), false);
});

test('isMultiDayJob: true only when the pickup local date is strictly later than the booking local date', () => {
  const job = { booked_at: '2026-06-01T09:00:00+10:00', pickup_at: '2026-06-03T09:00:00+10:00' };
  assert.equal(isMultiDayJob(job), true);
});

test('isMultiDayJob: false when pickup is on an earlier local date than booking', () => {
  const job = { booked_at: '2026-06-03T09:00:00+10:00', pickup_at: '2026-06-01T09:00:00+10:00' };
  assert.equal(isMultiDayJob(job), false);
});
