import test from 'node:test';
import assert from 'node:assert/strict';
import { MSAA_OVERRIDE_KEY, _resetMsaaDecisionForTest, isMsaaUnsafeRenderer, msaaAllowed } from './renderQuality.js';

const HD4000_GL = 'ANGLE (Intel, Mesa Intel(R) HD Graphics 4000 (IVB GT2), OpenGL ES 3.0)';
const HD4000_VK = 'ANGLE (Intel, Vulkan 1.2.354 (Intel(R) HD Graphics 4000 (IVB GT2) (0x00000166)), Intel open-source Mesa driver)';

const store = (value) => ({ getItem: (k) => (k === MSAA_OVERRIDE_KEY ? value : null) });

test('the HD 4000 renderer strings Chromium reported are flagged, on both backends', () => {
  assert.equal(isMsaaUnsafeRenderer(HD4000_GL), true);
  assert.equal(isMsaaUnsafeRenderer(HD4000_VK), true);
  assert.equal(isMsaaUnsafeRenderer('ANGLE (Intel, Mesa Intel(R) HD Graphics 3000 (SNB GT2), OpenGL ES 3.0)'), true);
});

test('modern GPUs keep MSAA', () => {
  for (const r of [
    'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL ES 3.2)',
    'ANGLE (Intel, Mesa Intel(R) HD Graphics 5500 (BDW GT2), OpenGL ES 3.1)',
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23), OpenGL 4.6)',
    'Apple M2',
    'Google SwiftShader',
  ]) assert.equal(isMsaaUnsafeRenderer(r), false, r);
  assert.equal(isMsaaUnsafeRenderer(null), false);
});

test('the decision follows the GPU, is made once, and the override wins', () => {
  _resetMsaaDecisionForTest();
  let probes = 0;
  const probe = () => { probes += 1; return HD4000_GL; };
  const origInfo = console.info;
  console.info = () => {};
  try {
    assert.equal(msaaAllowed({ probe, storage: store(null) }), false);
    assert.equal(msaaAllowed({ probe, storage: store(null) }), false);
    assert.equal(probes, 1, 'one throwaway context per page');

    _resetMsaaDecisionForTest();
    assert.equal(msaaAllowed({ probe, storage: store('on') }), true, 'override forces it on');
    _resetMsaaDecisionForTest();
    assert.equal(msaaAllowed({ probe: () => 'Apple M2', storage: store('off') }), false, 'override forces it off');
    _resetMsaaDecisionForTest();
    assert.equal(msaaAllowed({ probe: () => null, storage: { getItem() { throw new Error('blocked'); } } }), true, 'unknown GPU + blocked storage keeps MSAA');
  } finally {
    console.info = origInfo;
    _resetMsaaDecisionForTest();
  }
});
