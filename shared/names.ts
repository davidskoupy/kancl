export const NAMES = [
  'Pepa', 'Tonda', 'Máňa', 'Vašek', 'Božka', 'Lojza', 'Franta', 'Jarda', 'Květa', 'Zdenda',
  'Milan', 'Jirka', 'Věra', 'Ruda', 'Bohouš', 'Standa', 'Libor', 'Hanka', 'Olda', 'Dáša',
  'Mirek', 'Zuzka', 'Kája', 'Radek', 'Ivana', 'Ota', 'Lenka', 'Honza', 'Blanka', 'Vláďa',
  'Eva', 'Petr', 'Jitka', 'Luboš', 'Alena', 'Fanda', 'Marta', 'Kuba', 'Tereza', 'Míla',
];

/** Pixelový 3×5 font nemá diakritiku: "Máňa" → "Mana". */
export function plainAscii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
