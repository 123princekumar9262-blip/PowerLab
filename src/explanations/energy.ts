import type { Measurements } from '../measurements/measurements.ts'
import type { SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatPercent, formatW } from '../utils/format.ts'
import type { EnergyModel } from '../workspace/contract.ts'

/**
 * ENERGY at the cursor (moved unchanged out of the old EnergyPanel view, so it is pure and tested).
 * Every element either SUPPLIES power (source, a discharging L or C) or ABSORBS it (resistor, diodes, a
 * charging L or C). Each power is v·i of the same simulated sample; by energy conservation the signed
 * powers sum to zero at every instant — reported as a check on the simulation.
 */
export function rectifierEnergy(result: SimulationResult, sample: SimulationSample, m: Measurements): EnergyModel {
  const p = result.params
  const x = sample.values
  const hasL = p.load === 'RL' || p.load === 'RLC'
  const hasC = p.load === 'RC' || p.load === 'RLC'
  const vC = hasC ? (x.vout ?? 0) : 0
  // RL loads have no separate il channel: the inductor carries the load current.
  const il = x.il ?? (p.load === 'RL' ? (x.io ?? 0) : 0)
  // Positive = absorbing energy, negative = supplying.
  const fw = sample.diodes.find((d) => d.id === 'Dfw')
  const pFw = fw ? fw.voltage * fw.current : 0
  const ledger: EnergyModel['ledger'] = [
    { id: 'src', label: 'Source', watts: -(x.ps ?? 0), note: 'supplies energy while a diode conducts' },
    // With a freewheeling diode, show where the inductor's energy goes: D1 and Dfw separately.
    { id: 'd', label: fw ? 'Diode D1' : 'Diodes', watts: (x.pd ?? 0) - pFw, note: 'lose Vf·i (+ Ron·i²) as heat' },
  ]
  if (fw) ledger.push({ id: 'fw', label: 'Freewheel Dfw', watts: pFw, note: 'loses Vf·i while the inductor freewheels' })
  if (hasL) ledger.push({ id: 'l', label: 'Inductor L', watts: (x.vl ?? 0) * il, note: 'stores ½·L·i² in its magnetic field' })
  if (hasC) ledger.push({ id: 'c', label: 'Capacitor C', watts: vC * (x.ic ?? 0), note: 'stores ½·C·v² in its electric field' })
  ledger.push({ id: 'r', label: 'Resistor R', watts: x.pload ?? 0, note: 'turns energy into heat (always absorbing)' })

  const absMax = (arr?: Float64Array) => {
    let v = 0
    if (arr) for (let k = 0; k < arr.length; k++) v = Math.max(v, Math.abs(arr[k]))
    return v || 1
  }
  const stores: EnergyModel['stores'] = []
  const pl = ledger.find((r) => r.id === 'l')?.watts ?? 0
  const pc = ledger.find((r) => r.id === 'c')?.watts ?? 0
  if (hasL) stores.push({ id: 'l', label: 'Stored in L', joules: x.wl ?? 0, fraction: (x.wl ?? 0) / absMax(result.trace.signals.wl), detail: `${pl >= 0 ? 'storing' : 'releasing'} ${formatW(Math.abs(pl))}` })
  if (hasC) stores.push({ id: 'c', label: 'Stored in C', joules: x.wc ?? 0, fraction: (x.wc ?? 0) / absMax(result.trace.signals.wc), detail: `${pc >= 0 ? 'charging' : 'discharging'} ${formatW(Math.abs(pc))}` })

  const scale = Math.max(1e-12, ...ledger.map((r) => Math.abs(r.watts)))
  return {
    ledger,
    stores,
    balance: ledger.reduce((a, r) => a + r.watts, 0),
    // as the old panel: a millionth of the larger of 4·P(source) and the largest element power
    tolerance: 1e-6 * Math.max(1e-12, m.sourcePower * 4, scale) + 1e-9,
    summary: `Per cycle (steady state): the source delivers ${formatW(m.sourcePower)} on average; ${formatW(m.loadPower)} reaches R and ${formatW(m.diodeLoss)} is lost in the diodes${m.efficiency !== null ? ` — efficiency ${formatPercent(m.efficiency, 1).replace('+', '')}` : ''}. Stored energy returns to its starting value each cycle, so L and C only borrow and repay.`,
  }
}
