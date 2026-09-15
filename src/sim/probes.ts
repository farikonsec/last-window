/**
 * Real robotic and crewed missions on the lunar surface, at their published coordinates, so the buggy can navigate to
 * any of them — near side and far side. Coordinates are landing/impact sites from mission records (degrees, east-
 * positive longitude). `kind` picks a representative model and a marker colour; models are generic stand-ins, not
 * museum-accurate reconstructions of each spacecraft.
 */
export type ProbeKind = 'lander' | 'rover' | 'crewed' | 'impact' | 'crash';

export interface Probe {
  id: string;
  name: string;
  agency: string;
  year: number;
  lat: number;
  lon: number;
  kind: ProbeKind;
  note: string;
}

/** Curated for coverage: first-of-kind, rovers, both poles, and the far side. Not exhaustive. */
export const PROBES: Probe[] = [
  // Apollo crewed landings (near side).
  {id: 'apollo11', name: 'Apollo 11 · Eagle', agency: 'NASA', year: 1969, lat: 0.674, lon: 23.473, kind: 'crewed', note: 'First crewed landing, Mare Tranquillitatis'},
  {id: 'apollo12', name: 'Apollo 12 · Intrepid', agency: 'NASA', year: 1969, lat: -3.013, lon: -23.422, kind: 'crewed', note: 'Landed beside Surveyor 3'},
  {id: 'apollo14', name: 'Apollo 14 · Antares', agency: 'NASA', year: 1971, lat: -3.645, lon: -17.472, kind: 'crewed', note: 'Fra Mauro highlands'},
  {id: 'apollo16', name: 'Apollo 16 · Orion', agency: 'NASA', year: 1972, lat: -8.973, lon: 15.501, kind: 'crewed', note: 'Descartes highlands'},
  {id: 'apollo17', name: 'Apollo 17 · Challenger', agency: 'NASA', year: 1972, lat: 20.191, lon: 30.772, kind: 'crewed', note: 'Last crewed landing, Taurus-Littrow'},
  // Luna / Lunokhod (USSR).
  {id: 'luna2', name: 'Luna 2', agency: 'USSR', year: 1959, lat: 29.1, lon: 0.0, kind: 'impact', note: 'First human-made object to reach the Moon'},
  {id: 'luna9', name: 'Luna 9', agency: 'USSR', year: 1966, lat: 7.08, lon: -64.37, kind: 'lander', note: 'First soft landing and surface images'},
  {id: 'lunokhod1', name: 'Lunokhod 1 (Luna 17)', agency: 'USSR', year: 1970, lat: 38.28, lon: -34.99, kind: 'rover', note: 'First roving vehicle on another world'},
  {id: 'lunokhod2', name: 'Lunokhod 2 (Luna 21)', agency: 'USSR', year: 1973, lat: 25.85, lon: 30.45, kind: 'rover', note: 'Drove ~39 km, a record for decades'},
  {id: 'luna24', name: 'Luna 24', agency: 'USSR', year: 1976, lat: 12.71, lon: 62.21, kind: 'lander', note: 'Last Luna sample return until 2020s'},
  // Surveyor (NASA, 1960s).
  {id: 'surveyor1', name: 'Surveyor 1', agency: 'NASA', year: 1966, lat: -2.47, lon: -43.34, kind: 'lander', note: 'First US soft landing'},
  {id: 'surveyor6', name: 'Surveyor 6', agency: 'NASA', year: 1967, lat: 0.49, lon: -1.4, kind: 'lander', note: 'First liftoff-and-hop on the Moon'},
  // China (Chang'e / Yutu) — including the far side.
  {id: 'change3', name: "Chang'e 3 · Yutu", agency: 'CNSA', year: 2013, lat: 44.12, lon: -19.51, kind: 'rover', note: 'First Chinese landing, Mare Imbrium'},
  {id: 'change4', name: "Chang'e 4 · Yutu-2", agency: 'CNSA', year: 2019, lat: -45.44, lon: 177.6, kind: 'rover', note: 'First far-side landing, Von Kármán crater'},
  {id: 'change5', name: "Chang'e 5", agency: 'CNSA', year: 2020, lat: 43.06, lon: -51.92, kind: 'lander', note: 'Sample return, Mons Rümker'},
  {id: 'change6', name: "Chang'e 6", agency: 'CNSA', year: 2024, lat: -41.63, lon: -153.98, kind: 'lander', note: 'First far-side sample return'},
  // India, Japan, UAE, Israel — the recent wave.
  {id: 'chandrayaan3', name: 'Chandrayaan-3 · Vikram/Pragyan', agency: 'ISRO', year: 2023, lat: -69.37, lon: 32.32, kind: 'rover', note: 'Southernmost landing, near the south pole'},
  {id: 'slim', name: 'SLIM (Moon Sniper)', agency: 'JAXA', year: 2024, lat: -13.31, lon: 25.25, kind: 'lander', note: 'Pinpoint landing, came to rest nose-down'},
  {id: 'rashid', name: 'Rashid (Hakuto-R M1)', agency: 'UAE / ispace', year: 2023, lat: 47.58, lon: 44.53, kind: 'crash', note: 'Atlas crater; lander crashed on final descent'},
  {id: 'beresheet', name: 'Beresheet', agency: 'SpaceIL', year: 2019, lat: 32.6, lon: 19.3, kind: 'crash', note: 'Mare Serenitatis; crashed on landing'},
  {id: 'luna25', name: 'Luna 25', agency: 'Roscosmos', year: 2023, lat: -57.5, lon: 61.4, kind: 'crash', note: 'Impacted near the south pole'},
  {id: 'im1', name: 'IM-1 · Odysseus', agency: 'Intuitive Machines', year: 2024, lat: -80.13, lon: 1.44, kind: 'lander', note: 'Nearest the south pole, tipped on landing'},
];

/** The specific stand-in model shown when you visit a mission — a distinct, roughly-accurate model per spacecraft
 * family, each carrying its country's flag. Returns the site-model key (the hardware object named `site-<key>`). */
export function siteModel(id: string): string {
  const map: Record<string, string> = {
    apollo11: 'apollo', apollo12: 'apollo', apollo14: 'apollo', apollo16: 'apollo', apollo17: 'apollo',
    luna2: 'luna', luna9: 'luna', luna24: 'luna',
    lunokhod1: 'lunokhod', lunokhod2: 'lunokhod',
    surveyor1: 'surveyor', surveyor6: 'surveyor',
    change3: 'yutu', change4: 'yutu', change5: 'change', change6: 'change',
    chandrayaan3: 'vikram', slim: 'slim', rashid: 'rashid', beresheet: 'beresheet', im1: 'odysseus',
  };
  return map[id] ?? 'luna';
}

const DEG = Math.PI / 180;

/** Great-circle distance in metres between two lat/lon points on the Moon. */
export function surfaceDistance(aLat: number, aLon: number, bLat: number, bLon: number, radius = 1_737_400) {
  const dLat = (bLat - aLat) * DEG, dLon = (bLon - aLon) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * DEG) * Math.cos(bLat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing in radians clockwise from north, from A toward B. */
export function bearing(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLon = (bLon - aLon) * DEG, la = aLat * DEG, lb = bLat * DEG;
  const y = Math.sin(dLon) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLon);
  return (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
}
