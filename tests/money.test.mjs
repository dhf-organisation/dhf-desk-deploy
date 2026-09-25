import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPureFunctions } from './lib/load-pure-functions.mjs';

const { calcInvoiceTotals, poTotal, creditNoteTotal, creditNoteApplied } =
  loadPureFunctions(['calcInvoiceTotals', 'poTotal', 'creditNoteTotal', 'creditNoteApplied']);

test('calcInvoiceTotals: unit prices include GST, so GST = totalIncl / 11', () => {
  const r = calcInvoiceTotals([{ qty: 1, unit_price: 110 }], null, null);
  assert.equal(r.rawTotal, 110);
  assert.equal(r.totalIncl, 110);
  assert.equal(r.gst, 10);
  assert.equal(r.exclSubtotal, 100);
});

test('calcInvoiceTotals: is_header rows are excluded from the total (fixed in PR #30)', () => {
  const r = calcInvoiceTotals(
    [
      { is_header: true, qty: 1, unit_price: 9999 },
      { qty: 2, unit_price: 50 },
    ],
    null,
    null,
  );
  assert.equal(r.rawTotal, 100);
});

test('calcInvoiceTotals: percent discount applies to the raw total before GST split', () => {
  const r = calcInvoiceTotals([{ qty: 1, unit_price: 100 }], 'percent', 10);
  assert.equal(r.rawTotal, 100);
  assert.equal(r.discountAmount, 10);
  assert.equal(r.totalIncl, 90);
});

test('calcInvoiceTotals: fixed discount is a flat dollar amount', () => {
  const r = calcInvoiceTotals([{ qty: 1, unit_price: 100 }], 'fixed', 15);
  assert.equal(r.discountAmount, 15);
  assert.equal(r.totalIncl, 85);
});

test('calcInvoiceTotals: discount is clamped so it never exceeds the raw total (no negative totalIncl)', () => {
  const r = calcInvoiceTotals([{ qty: 1, unit_price: 50 }], 'fixed', 500);
  assert.equal(r.discountAmount, 50);
  assert.equal(r.totalIncl, 0);
  assert.equal(r.gst, 0);
});

test('calcInvoiceTotals: discount is clamped so it never goes negative', () => {
  const r = calcInvoiceTotals([{ qty: 1, unit_price: 100 }], 'fixed', -20);
  // discountValue is falsy-checked, and a negative fixed value is still
  // truthy, so this exercises the Math.max(...,0) floor directly.
  assert.equal(r.discountAmount, 0);
  assert.equal(r.totalIncl, 100);
});

test('calcInvoiceTotals: empty items produce all-zero totals', () => {
  const r = calcInvoiceTotals([], null, null);
  assert.deepEqual(r, { rawTotal: 0, discountAmount: 0, totalIncl: 0, gst: 0, exclSubtotal: 0 });
});

test('poTotal: sums qty * unit_cost across items', () => {
  assert.equal(poTotal({ items: [{ qty: 2, unit_cost: 25 }, { qty: 1, unit_cost: 10 }] }), 60);
});

test('poTotal: no items is zero, not NaN', () => {
  assert.equal(poTotal({ items: [] }), 0);
  assert.equal(poTotal({}), 0);
});

test('creditNoteTotal: sums qty * unit_price across items', () => {
  assert.equal(creditNoteTotal({ items: [{ qty: 1, unit_price: 100 }] }), 100);
});

test('creditNoteApplied: sums application amounts', () => {
  assert.equal(creditNoteApplied({ applications: [{ amount: 40 }, { amount: 25 }] }), 65);
});

test('creditNoteApplied: no applications is zero, not NaN', () => {
  assert.equal(creditNoteApplied({ applications: [] }), 0);
  assert.equal(creditNoteApplied({}), 0);
});
