import test from 'node:test';
import assert from 'node:assert/strict';
import { arizonaToday, preparationDate } from '../workflow/preparation-date.js';

const friday = new Date('2026-09-25T20:00:00Z');

test('Sunday is preserved when preparing on Friday', () => {
  assert.equal(preparationDate('2026-09-27', friday), '2026-09-27');
});

test('older clients default to tomorrow in Arizona, including before local midnight', () => {
  assert.equal(preparationDate(undefined, friday), '2026-09-26');
  assert.equal(arizonaToday(new Date('2026-09-26T06:59:59Z')), '2026-09-25');
  assert.equal(
    preparationDate(undefined, new Date('2026-09-26T06:59:59Z')),
    '2026-09-26',
  );
  assert.equal(
    preparationDate(undefined, new Date('2026-09-26T07:00:00Z')),
    '2026-09-27',
  );
});

test('today is allowed, but past dates cannot be prepared', () => {
  assert.equal(preparationDate('2026-09-25', friday), '2026-09-25');
  assert.throws(
    () => preparationDate('2026-09-24', friday),
    /today or a future date/,
  );
});

test('invalid and ambiguous values fail rather than silently using tomorrow', () => {
  for (const value of [
    '',
    null,
    20260927,
    {},
    [],
    '09/27/2026',
    '2026-9-27',
    '2026-09-27T00:00:00Z',
    '2026-02-30',
    '2026-13-01',
    '2027-02-29',
  ]) {
    assert.throws(
      () => preparationDate(value, friday),
      /valid appointment date/,
    );
  }
});

test('calendar arithmetic handles month, year and leap-day boundaries', () => {
  assert.equal(
    preparationDate(undefined, new Date('2026-12-31T20:00:00Z')),
    '2027-01-01',
  );
  assert.equal(
    preparationDate(undefined, new Date('2028-02-28T20:00:00Z')),
    '2028-02-29',
  );
  assert.equal(preparationDate('2028-02-29', friday), '2028-02-29');
});
