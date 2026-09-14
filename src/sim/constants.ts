// Moon and physical constants. Sources: JPL SSD astrodynamic parameters (GM), IAU mean radius.

/** Lunar gravitational parameter, m^3/s^2 (JPL: 4902.800066 km^3/s^2). */
export const MU = 4.902800066e12;
/** Mean lunar radius, m. Terrain heights are measured from this sphere. */
export const R_MOON = 1_737_400;
/** Sidereal rotation period, s (27.321661 days). */
export const SIDEREAL_DAY = 27.321661 * 86400;
/** Lunar rotation rate about +Z of the Moon-centred inertial frame, rad/s. */
export const OMEGA_MOON = (2 * Math.PI) / SIDEREAL_DAY;
/** Standard gravity for specific impulse, m/s^2. */
export const G0 = 9.80665;

/**
 * Moon-centred inertial frame (MCI) used by the simulation:
 * +Z along the lunar spin axis (north), +X through 0 deg longitude at sim time t = 0, +Y completes the right-handed set.
 * The renderer maps MCI onto astronomy-engine's J2000 frame using the real lunar orientation at the scenario epoch.
 */
export const FRAME_NOTE = 'MCI: Z = spin axis, X = prime meridian at t=0';

export const surfaceGravity = () => MU / (R_MOON * R_MOON);
export const circularSpeed = (radius: number) => Math.sqrt(MU / radius);
export const escapeSpeed = (radius: number) => Math.sqrt((2 * MU) / radius);
export const orbitalPeriod = (semiMajorAxis: number) => 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / MU);
