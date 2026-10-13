/**
 * Voltage levels and their colours — the one visual language every Power Systems diagram uses. Colour is never the
 * only cue: every bus also carries its kV in text, and the legend names each level.
 */
export type Level = 'ehv' | 'hv' | 'mv' | 'lv'

export const LEVELS: Array<{
  id: Level
  name: string
  range: string
  role: string
}> = [
  {
    id: 'ehv',
    name: 'Transmission',
    range: '≥ 100 kV',
    role: 'carries bulk power over long distances',
  },
  {
    id: 'hv',
    name: 'Sub-transmission',
    range: '20–100 kV',
    role: 'carries power from grid substations into a region',
  },
  {
    id: 'mv',
    name: 'Generation & distribution',
    range: '1–20 kV',
    role: 'generator terminals and the feeders through a town',
  },
  {
    id: 'lv',
    name: 'Low voltage',
    range: '< 1 kV',
    role: 'the 400/230 V supply to homes',
  },
]

export const levelOf = (kv: number): Level => (kv >= 100 ? 'ehv' : kv >= 20 ? 'hv' : kv >= 1 ? 'mv' : 'lv')
