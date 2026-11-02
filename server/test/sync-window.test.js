import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSyncWindowStart } from '../sync-window.js';

test('window sync memakai cursor dengan overlap dan tidak mundur ke awal rolling window', () => {
  const cursor = new Date('2026-10-29T10:42:00.000Z');
  const rolling = new Date('2026-10-26T10:42:00.000Z');
  const actual = computeSyncWindowStart(cursor, rolling, 2, rolling);
  assert.equal(actual.toISOString(), '2026-10-29T10:40:00.000Z');
});

test('window sync pertama memakai initial from', () => {
  const initial = new Date('2026-10-29T00:00:00.000Z');
  assert.equal(computeSyncWindowStart(null, new Date('2026-10-26T00:00:00.000Z'), 2, initial).toISOString(), initial.toISOString());
});
