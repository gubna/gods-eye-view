import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * On load the camera flies to HOME_VIEW (below), not to one of these.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Where the camera lands on load when no share link is being restored.
 * Heights are above the ellipsoid; downtown Boston tops out near 240 m, so the
 * fly-in ends well above the skyline.
 */
export const HOME_VIEW = Object.freeze({
  name: 'Boston, MA',
  lat: 42.3601,
  lon: -71.0589,
  approachHeightM: 25000,
  heightM: 1200,
});

/**
 * Set camera to the home view on load with a cinematic fly-in.
 */
export function flyToHome(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.approachHeightM),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.heightM),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}
