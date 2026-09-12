import assert from 'node:assert/strict';

const { PET_STATES, NUZZLE_DURATION_MS, WAVE_DURATION_MS, getSwimStrideLength } = await import('../pet-renderer.js');

assert.equal(PET_STATES.NUZZLING, 'nuzzling');
assert.equal(NUZZLE_DURATION_MS, 3600);
assert.equal(WAVE_DURATION_MS, 1800);
assert.ok(Math.abs(getSwimStrideLength(172) - 48.16) < 1e-9);
assert.equal(getSwimStrideLength(0), 24);
assert.ok(Math.abs(getSwimStrideLength(Number.NaN) - 48.16) < 1e-9);

console.log('PASS: gesture exports and size-aware swim stride.');
