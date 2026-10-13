import type { Network } from '../../network/types.ts'

/**
 * The Grid Explorer network: a power station feeding a town through every voltage level of a typical grid.
 *
 *   13.8 kV generator → step-up 13.8/220 kV → 120 km 220 kV transmission line → grid substation 220/33 kV
 *   (a factory is supplied at 33 kV) → 10 km 33 kV sub-transmission line → distribution substation 33/11 kV
 *   → the town's 11 kV feeders.
 *
 * Data are typical textbook values, not a real utility's: 220 kV single-circuit overhead line ≈ 0.06 + j0.41 Ω/km
 * and 2.8 µS/km; 33 kV overhead line ≈ 0.12 + j0.35 Ω/km and 3.2 µS/km (a heavy conductor); transformer impedances 8–12 % with X/R
 * rising with rating. Loads are constant-power; the step-down transformer has a +5 % tap on its 33 kV winding
 * (rated 220/34.65 kV) — the usual way to offset the voltage drop of the line it feeds.
 */
export function gridNetwork(): Network {
  return {
    id: 'grid-explorer',
    name: 'Power station to town',
    baseMva: 100,
    fHz: 50,
    buses: [
      { id: 'gen', name: 'Generator terminals', kv: 13.8, x: 60, y: 160 },
      { id: 'hvA', name: 'Power-station switchyard', kv: 220, x: 210, y: 160 },
      { id: 'hvB', name: 'Grid substation 220 kV', kv: 220, x: 470, y: 160 },
      { id: 'mvA', name: 'Grid substation 33 kV', kv: 33, x: 610, y: 160 },
      {
        id: 'mvB',
        name: 'Distribution substation 33 kV',
        kv: 33,
        x: 790,
        y: 160,
      },
      { id: 'lv', name: 'Town 11 kV feeders', kv: 11, x: 930, y: 160 },
    ],
    components: [
      {
        kind: 'generator',
        id: 'G1',
        name: 'Generator G1',
        bus: 'gen',
        mode: 'slack',
        vPu: 1.02,
        ratedMva: 120,
        x1Pu: 0.2,
        x2Pu: 0.2,
        x0Pu: 0.06,
        grounded: true,
        hS: 4,
      },
      {
        kind: 'transformer',
        id: 'T1',
        name: 'Step-up transformer T1',
        from: 'hvA',
        to: 'gen',
        ratedMva: 120,
        kvFrom: 220,
        kvTo: 13.8,
        zPct: 12,
        xr: 40,
        connFrom: 'YN',
        connTo: 'D',
      },
      {
        kind: 'line',
        id: 'L1',
        name: '220 kV transmission line L1',
        from: 'hvA',
        to: 'hvB',
        lengthKm: 120,
        rOhmPerKm: 0.06,
        xOhmPerKm: 0.41,
        bUsPerKm: 2.8,
        r0OhmPerKm: 0.25,
        x0OhmPerKm: 1.25,
        ratingMva: 250,
      },
      {
        kind: 'transformer',
        id: 'T2',
        name: 'Grid transformer T2',
        from: 'hvB',
        to: 'mvA',
        ratedMva: 60,
        kvFrom: 220,
        kvTo: 34.65,
        zPct: 10,
        xr: 30,
        connFrom: 'YN',
        connTo: 'D',
      },
      {
        kind: 'line',
        id: 'L2',
        name: '33 kV line L2',
        from: 'mvA',
        to: 'mvB',
        lengthKm: 10,
        rOhmPerKm: 0.12,
        xOhmPerKm: 0.35,
        bUsPerKm: 3.2,
        r0OhmPerKm: 0.4,
        x0OhmPerKm: 1.1,
        ratingMva: 40,
      },
      {
        kind: 'transformer',
        id: 'T3',
        name: 'Distribution transformer T3',
        from: 'mvB',
        to: 'lv',
        ratedMva: 20,
        kvFrom: 31.35,
        kvTo: 11,
        zPct: 8,
        xr: 12,
        connFrom: 'D',
        connTo: 'YN',
      },
      {
        kind: 'load',
        id: 'factory',
        name: 'Factory',
        bus: 'mvA',
        pMw: 12,
        qMvar: 7.44,
        type: 'industrial',
      },
      {
        kind: 'load',
        id: 'town',
        name: 'Town',
        bus: 'lv',
        pMw: 16,
        qMvar: 5.26,
        type: 'mixed',
      },
      {
        kind: 'breaker',
        id: 'CB1',
        name: 'Breaker CB1 (line L1)',
        target: 'L1',
        closed: true,
      },
      {
        kind: 'breaker',
        id: 'CB2',
        name: 'Breaker CB2 (line L2)',
        target: 'L2',
        closed: true,
      },
      {
        kind: 'breaker',
        id: 'CB3',
        name: 'Breaker CB3 (factory feeder)',
        target: 'factory',
        closed: true,
      },
      {
        kind: 'breaker',
        id: 'CB4',
        name: 'Breaker CB4 (town feeder)',
        target: 'town',
        closed: true,
      },
    ],
  }
}
