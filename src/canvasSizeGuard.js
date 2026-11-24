/**
 * Keep a sub-pixel canvas from killing the render loop.
 *
 * Cesium's configureCanvasSize decides `_canRender` from the UNROUNDED buffer
 * size (`clientWidth * pixelRatio`), then assigns that to `canvas.width`, which
 * truncates. With a pixel ratio below 1 — the Low (0.5) and Medium (0.75)
 * quality levels, or the flight-sim floor — a 1 px client dimension yields
 * 0.5: `_canRender` stays true while the real canvas is 0 wide, the next frame
 * builds a 0-width framebuffer, and Cesium throws
 * "Expected width to be greater than 0", stops the loop for good, and shows
 * its error panel. Tiling window managers produce 1 px windows during layout
 * changes, which is how this was hit.
 *
 * Two layers:
 *   PREVENT — after every resize, a canvas that truncated to 0 is not
 *   renderable, so Cesium skips frames until the next real size arrives.
 *   RECOVER — if a zero-size render error still lands (another path to a 0
 *   drawing buffer), drop Cesium's panel and restart the loop once the canvas
 *   has a real size. Any other render error keeps Cesium's stop-and-show
 *   behavior untouched.
 *
 * Both reach into CesiumWidget internals (`_canvas`, `_canRender`). The guard
 * checks they exist and does nothing if a future Cesium renames them.
 */

const ZERO_SIZE_ERROR = /Expected (width|height) to be greater than 0/;
const RECOVERY_POLL_MS = 250;

/**
 * @param {Error|unknown} error
 * @returns {boolean}
 */
export function isZeroSizeRenderError(error) {
  return ZERO_SIZE_ERROR.test(String(error?.message || error || ''));
}

/**
 * @param {object} viewer - Cesium Viewer.
 * @param {{setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, warn?: (msg: string) => void}} [deps]
 * @returns {() => void} uninstall
 */
export function installCanvasSizeGuard(viewer, {
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  warn = (msg) => console.warn(msg),
} = {}) {
  const widget = viewer?.cesiumWidget;
  const canvas = widget?._canvas;
  if (!widget || !canvas || typeof widget.resize !== 'function' || !('_canRender' in widget)) {
    return () => {};
  }
  const hasRealSize = () => canvas.width > 0 && canvas.height > 0;

  // PREVENT
  const originalResize = widget.resize;
  widget.resize = function guardedResize(...args) {
    const result = originalResize.apply(this, args);
    if (!hasRealSize()) this._canRender = false;
    return result;
  };

  // RECOVER
  let recoveryTimer = null;
  const resumeWhenSized = () => {
    recoveryTimer = null;
    try { widget.resize(); } catch { /* still mid-layout */ }
    if (!hasRealSize()) {
      recoveryTimer = setTimer(resumeWhenSized, RECOVERY_POLL_MS);
      return;
    }
    viewer.useDefaultRenderLoop = true;
    viewer.scene?.requestRender?.();
  };
  const onRenderError = (_scene, error) => {
    if (!isZeroSizeRenderError(error)) return;
    // Cesium's own listener ran first (it registers in the widget constructor):
    // the loop is stopped and its panel is up. Undo both for this one cause.
    widget.element?.querySelector?.('.cesium-widget-errorPanel')?.remove();
    warn('[Render] canvas hit zero size mid-frame; resuming once it has a real size.');
    if (recoveryTimer === null) recoveryTimer = setTimer(resumeWhenSized, 0);
  };
  const removeListener = viewer.scene?.renderError?.addEventListener?.(onRenderError);

  return () => {
    widget.resize = originalResize;
    if (typeof removeListener === 'function') removeListener();
    if (recoveryTimer !== null) clearTimer(recoveryTimer);
    recoveryTimer = null;
  };
}
