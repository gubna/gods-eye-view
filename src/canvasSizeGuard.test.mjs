import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { installCanvasSizeGuard, isZeroSizeRenderError } from './canvasSizeGuard.js';

/**
 * A stand-in for CesiumWidget with the same sizing rule as Cesium 1.138's
 * configureCanvasSize: `_canRender` from the unrounded product, `canvas.width`
 * truncated the way an HTMLCanvasElement truncates assignments.
 */
function fakeViewer({ clientWidth = 800, clientHeight = 600, pixelRatio = 1 } = {}) {
  const canvas = {
    clientWidth,
    clientHeight,
    _w: 0,
    _h: 0,
    get width() { return this._w; },
    set width(v) { this._w = Math.trunc(v); },
    get height() { return this._h; },
    set height(v) { this._h = Math.trunc(v); },
  };
  const panel = { removed: false, remove() { this.removed = true; } };
  const widget = {
    _canvas: canvas,
    _canRender: false,
    pixelRatio,
    panelUp: false,
    element: { querySelector: (sel) => (sel === '.cesium-widget-errorPanel' && widget.panelUp && !panel.removed ? panel : null) },
    resize() {
      const width = canvas.clientWidth * this.pixelRatio;
      const height = canvas.clientHeight * this.pixelRatio;
      canvas.width = width;
      canvas.height = height;
      this._canRender = width !== 0 && height !== 0;
    },
  };
  const scene = { renderError: new Cesium.Event(), renders: 0, requestRender() { this.renders += 1; } };
  const viewer = { cesiumWidget: widget, scene, useDefaultRenderLoop: true };
  // Cesium's widget registers its stop-and-show listener in its constructor, before ours.
  scene.renderError.addEventListener(() => {
    viewer.useDefaultRenderLoop = false;
    widget.panelUp = true;
  });
  return { viewer, widget, canvas, scene, panel };
}

function manualTimers() {
  const queue = [];
  return {
    setTimer: (fn) => { queue.push(fn); return queue.length; },
    clearTimer: () => { queue.length = 0; },
    flush: () => { while (queue.length) queue.shift()(); },
    runOne: () => queue.shift()?.(),
    get pending() { return queue.length; },
  };
}

const ZERO = new Cesium.DeveloperError('Expected width to be greater than 0, actual value was 0');

test('recognizes the zero-size DeveloperError and nothing else', () => {
  assert.equal(isZeroSizeRenderError(ZERO), true);
  assert.equal(isZeroSizeRenderError(new Error('Expected height to be greater than 0, actual value was 0')), true);
  assert.equal(isZeroSizeRenderError(new Error('WebGL context lost')), false);
  assert.equal(isZeroSizeRenderError(undefined), false);
});

test('without the guard, half-scale on a 1 px window says "can render" over a 0-wide canvas', () => {
  const { widget, canvas } = fakeViewer({ clientWidth: 1, pixelRatio: 0.5 });
  widget.resize();
  assert.equal(canvas.width, 0);
  assert.equal(widget._canRender, true, 'this is the Cesium gap the guard closes');
});

test('the guard marks a truncated-to-zero canvas unrenderable, and renderable again once sized', () => {
  const { viewer, widget, canvas } = fakeViewer({ clientWidth: 1, pixelRatio: 0.5 });
  installCanvasSizeGuard(viewer, { warn() {} });
  widget.resize();
  assert.equal(canvas.width, 0);
  assert.equal(widget._canRender, false);

  canvas.clientWidth = 1400;
  widget.resize();
  assert.equal(canvas.width, 700);
  assert.equal(widget._canRender, true);
});

test('a full-size canvas is left exactly as Cesium sized it', () => {
  const { viewer, widget } = fakeViewer({ clientWidth: 1400, clientHeight: 900, pixelRatio: 0.75 });
  installCanvasSizeGuard(viewer, { warn() {} });
  widget.resize();
  assert.equal(widget._canRender, true);
});

test('a zero-size render error clears the panel and resumes once the canvas has a real size', () => {
  const { viewer, canvas, scene, panel } = fakeViewer({ clientWidth: 1, pixelRatio: 0.5 });
  const timers = manualTimers();
  installCanvasSizeGuard(viewer, { ...timers, warn() {} });

  scene.renderError.raiseEvent(scene, ZERO);
  assert.equal(panel.removed, true, 'Cesium\'s panel is taken down');
  assert.equal(viewer.useDefaultRenderLoop, false, 'still stopped while the canvas is 0 wide');

  timers.runOne(); // canvas still 1 px → keep waiting
  assert.equal(viewer.useDefaultRenderLoop, false);
  assert.equal(timers.pending, 1);

  canvas.clientWidth = 1400;
  timers.runOne();
  assert.equal(viewer.useDefaultRenderLoop, true, 'the render loop is back');
  assert.ok(scene.renders > 0);
});

test('any other render error keeps Cesium\'s stop-and-show behavior', () => {
  const { viewer, scene, panel } = fakeViewer();
  const timers = manualTimers();
  installCanvasSizeGuard(viewer, { ...timers, warn() {} });
  scene.renderError.raiseEvent(scene, new Error('Shader failed to compile'));
  assert.equal(panel.removed, false);
  assert.equal(viewer.useDefaultRenderLoop, false);
  assert.equal(timers.pending, 0);
});

test('uninstall restores resize and stops listening', () => {
  const { viewer, widget, scene, panel } = fakeViewer({ clientWidth: 1, pixelRatio: 0.5 });
  const original = widget.resize;
  const uninstall = installCanvasSizeGuard(viewer, { ...manualTimers(), warn() {} });
  uninstall();
  assert.equal(widget.resize, original);
  scene.renderError.raiseEvent(scene, ZERO);
  assert.equal(panel.removed, false);
});

test('a widget without the expected internals is left alone', () => {
  assert.doesNotThrow(() => installCanvasSizeGuard({ cesiumWidget: { resize() {} } })());
  assert.doesNotThrow(() => installCanvasSizeGuard(undefined)());
});
