/**
 * Named places on the Moon. Selenographic latitude, east-positive longitude (-180..180), degrees.
 * Apollo landing coordinates are LROC-measured descent-stage positions. Other landers and large features use published
 * values rounded to ~0.1°, good to a few km, which is finer than the 3.8 km globe grid most of them sit on.
 * Local Hadley landforms are located from the SLDEM2015 grid at runtime (see `hadleyLandforms`).
 */
export type PlaceKind = 'apollo' | 'lander' | 'rover' | 'mare' | 'crater' | 'mountain' | 'rille' | 'basin' | 'base';

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: PlaceKind;
  note: string;
  /** Larger values survive decluttering and show from farther away. */
  rank: number;
}

export const PLACES: Place[] = [
  // Apollo (LROC positions of the descent stages)
  {id: 'apollo11', name: 'Apollo 11', lat: 0.67408, lon: 23.47297, kind: 'apollo', rank: 5, note: 'Tranquility Base · 20 July 1969 · Armstrong, Aldrin'},
  {id: 'apollo12', name: 'Apollo 12', lat: -3.01239, lon: -23.42157, kind: 'apollo', rank: 4, note: 'Ocean of Storms · Nov 1969 · beside Surveyor 3'},
  {id: 'apollo14', name: 'Apollo 14', lat: -3.6453, lon: -17.47136, kind: 'apollo', rank: 4, note: 'Fra Mauro highlands · Feb 1971'},
  {id: 'apollo15', name: 'Apollo 15', lat: 26.13222, lon: 3.63386, kind: 'apollo', rank: 5, note: 'Hadley-Apennine · Jul 1971 · first Lunar Roving Vehicle'},
  {id: 'apollo16', name: 'Apollo 16', lat: -8.97301, lon: 15.50019, kind: 'apollo', rank: 4, note: 'Descartes highlands · Apr 1972'},
  {id: 'apollo17', name: 'Apollo 17', lat: 20.1908, lon: 30.77168, kind: 'apollo', rank: 5, note: 'Taurus-Littrow · Dec 1972 · last crewed landing'},
  // Robotic landers and rovers
  {id: 'luna9', name: 'Luna 9', lat: 7.08, lon: -64.37, kind: 'lander', rank: 3, note: 'First soft landing · Feb 1966'},
  {id: 'surveyor1', name: 'Surveyor 1', lat: -2.47, lon: -43.34, kind: 'lander', rank: 2, note: 'First US soft landing · Jun 1966'},
  {id: 'surveyor3', name: 'Surveyor 3', lat: -3.02, lon: -23.42, kind: 'lander', rank: 2, note: 'Visited by Apollo 12 in 1969'},
  {id: 'surveyor7', name: 'Surveyor 7', lat: -41.01, lon: -11.41, kind: 'lander', rank: 2, note: 'Rim of Tycho · Jan 1968'},
  {id: 'luna16', name: 'Luna 16', lat: -0.51, lon: 56.36, kind: 'lander', rank: 2, note: 'First robotic sample return · Sep 1970'},
  {id: 'lunokhod1', name: 'Lunokhod 1', lat: 38.32, lon: -35.0, kind: 'rover', rank: 3, note: 'First planetary rover · Luna 17, Nov 1970'},
  {id: 'lunokhod2', name: 'Lunokhod 2', lat: 25.83, lon: 30.92, kind: 'rover', rank: 3, note: 'Drove 39 km in Le Monnier crater · 1973'},
  {id: 'luna24', name: 'Luna 24', lat: 12.71, lon: 62.21, kind: 'lander', rank: 2, note: 'Last Soviet sample return · Aug 1976'},
  {id: 'change3', name: "Chang'e 3", lat: 44.12, lon: -19.51, kind: 'lander', rank: 3, note: 'Yutu rover · Mare Imbrium · Dec 2013'},
  {id: 'change4', name: "Chang'e 4", lat: -45.44, lon: 177.6, kind: 'lander', rank: 4, note: 'First far-side landing · Von Kármán crater · Jan 2019'},
  {id: 'change5', name: "Chang'e 5", lat: 43.06, lon: -51.92, kind: 'lander', rank: 3, note: 'Sample return · Oceanus Procellarum · Dec 2020'},
  {id: 'change6', name: "Chang'e 6", lat: -41.63, lon: -153.98, kind: 'lander', rank: 3, note: 'First far-side sample return · Jun 2024'},
  {id: 'chandrayaan3', name: 'Chandrayaan-3', lat: -69.37, lon: 32.32, kind: 'lander', rank: 3, note: 'Vikram and Pragyan · near the south pole · Aug 2023'},
  {id: 'slim', name: 'SLIM', lat: -13.32, lon: 25.25, kind: 'lander', rank: 2, note: 'Japanese pinpoint lander, landed on its nose · Jan 2024'},
  {id: 'odysseus', name: 'Odysseus', lat: -80.13, lon: 1.44, kind: 'lander', rank: 2, note: 'IM-1, first commercial landing · Feb 2024'},
  {id: 'blueghost1', name: 'Blue Ghost 1', lat: 18.56, lon: 61.81, kind: 'lander', rank: 2, note: 'Mare Crisium · Mar 2025'},
  // Maria and basins
  {id: 'imbrium', name: 'Mare Imbrium', lat: 32.8, lon: -15.6, kind: 'mare', rank: 4, note: 'Sea of Showers · 1,150 km impact basin'},
  {id: 'serenitatis', name: 'Mare Serenitatis', lat: 28.0, lon: 17.5, kind: 'mare', rank: 4, note: 'Sea of Serenity'},
  {id: 'tranquillitatis', name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, kind: 'mare', rank: 4, note: 'Sea of Tranquility'},
  {id: 'crisium', name: 'Mare Crisium', lat: 17.0, lon: 59.1, kind: 'mare', rank: 3, note: 'Sea of Crises'},
  {id: 'procellarum', name: 'Oceanus Procellarum', lat: 18.4, lon: -57.4, kind: 'mare', rank: 4, note: 'Ocean of Storms · largest mare'},
  {id: 'spa', name: 'South Pole–Aitken basin', lat: -53.0, lon: -169.0, kind: 'basin', rank: 4, note: '2,500 km across · oldest and deepest known basin'},
  // Craters and mountains
  {id: 'tycho', name: 'Tycho', lat: -43.31, lon: -11.36, kind: 'crater', rank: 4, note: '85 km young crater with bright rays'},
  {id: 'copernicus', name: 'Copernicus', lat: 9.62, lon: -20.08, kind: 'crater', rank: 4, note: '93 km crater, terraced walls'},
  {id: 'aristarchus', name: 'Aristarchus', lat: 23.7, lon: -47.4, kind: 'crater', rank: 3, note: 'Brightest large feature on the near side'},
  {id: 'plato', name: 'Plato', lat: 51.6, lon: -9.4, kind: 'crater', rank: 3, note: 'Dark lava-flooded crater'},
  {id: 'shackleton', name: 'Shackleton', lat: -89.67, lon: 129.78, kind: 'crater', rank: 3, note: 'South pole crater with permanently shadowed ice traps'},
  {id: 'apenninus', name: 'Montes Apenninus', lat: 18.9, lon: -3.7, kind: 'mountain', rank: 3, note: 'Rim of the Imbrium basin, peaks to 5 km'},
];

/** A landform found from the elevation grid near the landing site. */
export interface Landform {name: string; lat: number; lon: number; kind: PlaceKind; note: string; rank: number}

/**
 * Hadley landforms located from the surface itself, so labels sit on the real features of the loaded data:
 * the highest point NE of the site (Mons Hadley), the highest point S (Mons Hadley Delta) and the rille floor W.
 */
export function hadleyLandforms(surveyed: (lat: number, lon: number) => number): Landform[] {
  const extreme = (lat0: number, lat1: number, lon0: number, lon1: number, sign: 1 | -1) => {
    let best = {lat: lat0, lon: lon0, h: -Infinity};
    for (let lat = lat0; lat <= lat1; lat += 0.01) for (let lon = lon0; lon <= lon1; lon += 0.01) {
      const h = sign * surveyed(lat, lon);
      if (h > best.h) best = {lat, lon, h};
    }
    return {...best, h: sign * best.h};
  };
  const hadley = extreme(26.3, 27.1, 3.9, 5.0, 1);
  const delta = extreme(25.55, 25.95, 3.45, 4.1, 1);
  const rille = extreme(26.1, 26.16, 3.48, 3.6, -1);
  return [
    {name: 'Mons Hadley', ...hadley, kind: 'mountain' as const, rank: 4, note: `Summit ${(hadley.h / 1000).toFixed(1)} km above datum · ~4.5 km above the plain`},
    {name: 'Mons Hadley Delta', ...delta, kind: 'mountain' as const, rank: 4, note: 'Apollo 15 crew sampled its flank at St. George crater'},
    {name: 'Rima Hadley', ...rille, kind: 'rille' as const, rank: 4, note: `Sinuous rille ~1.5 km wide · floor ${Math.round(surveyed(26.13, 3.63) - rille.h)} m below the site`},
  ].map(({h: _h, ...rest}) => rest);
}
