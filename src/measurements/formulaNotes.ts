import type { MeasureKey } from './theory/index.ts'

/**
 * "Explain formula" — what each compared quantity means and where its formula comes from.
 * Educational text only; the values next to it come from the theory and the simulation.
 */
export const FORMULA_NOTES: Partial<Record<MeasureKey, { concept: string; explain: string }>> = {
  vinPeak: { concept: 'Peak source voltage', explain: 'A sinusoid of RMS value Vrms peaks at Vm = √2·Vrms. Every rectifier output is built from pieces of this sinusoid.' },
  vinRms: { concept: 'Source RMS voltage', explain: 'The RMS value is the DC voltage that would deliver the same power to a resistor. It is the value a meter (and the parameter panel) quotes.' },
  vphRms: { concept: 'Phase voltage (RMS)', explain: 'Each phase of a balanced star source has the same RMS value Vph, measured from the line to the neutral.' },
  vllRms: { concept: 'Line-to-line voltage (RMS)', explain: 'Two phases 120° apart differ by a sinusoid √3 times larger: VLL = √3·Vph. A bridge connects the load between two lines, so VLL sets its output.' },
  voutAvg: { concept: 'Average (DC) output', explain: 'Average the output over one period: Vdc = (1/T)∫vo dt. Only the DC part does useful work in a DC load; for a bridge this is the familiar 1.35·VLL (three-phase) or 2Vm/π (single-phase), reduced by the device drops and, for SCRs, by cos α.' },
  voutRms: { concept: 'RMS output', explain: 'Vo,rms = √((1/T)∫vo² dt): the heating value of the whole output waveform, DC plus ripple.' },
  voutPeak: { concept: 'Peak output', explain: 'The highest instantaneous output: the source peak minus the conducting device drops.' },
  voutMin: { concept: 'Minimum output', explain: 'The lowest instantaneous output. With an inductive load and no freewheeling path it can be negative; a freewheeling diode clamps it at −Vf.' },
  ripplePP: { concept: 'Peak-to-peak ripple', explain: 'The spread between the highest and lowest output. More pulses per cycle, or a filter, make it smaller.' },
  rippleFactor: { concept: 'Ripple factor', explain: 'RF = Vac,rms / Vdc with Vac,rms = √(Vrms² − Vdc²): how much of the output is AC compared with the useful DC.' },
  rippleFrequency: { concept: 'Ripple frequency', explain: 'How often the output pattern repeats: pulses per cycle × f (1 for half-wave, 2 for full-wave, 3 or 6 for three-phase).' },
  ioAvg: { concept: 'Average load current', explain: 'Idc = Vdc / R: an inductor has zero average voltage in steady state, so only R sets the DC current.' },
  ioRms: { concept: 'RMS load current', explain: 'Io,rms = √((1/T)∫io² dt) sets the heating of the load: P = R·Io,rms².' },
  ioPeak: { concept: 'Peak load current', explain: 'The largest instantaneous current — what the devices and wiring must carry.' },
  ioMin: { concept: 'Minimum load current', explain: 'If it reaches zero the current is discontinuous: the load is cut off for part of each cycle.' },
  ioRipplePP: { concept: 'Current ripple', explain: 'Peak minus minimum load current. Inductance (and more pulses) reduce it.' },
  ioRippleFactor: { concept: 'Current ripple factor', explain: 'Iac,rms / Idc for the load current: 0 would be a perfectly smooth DC current.' },
  idPeak: { concept: 'Device peak current', explain: 'The largest current the reference device (D1 or Da) carries — a rating requirement.' },
  idAvg: { concept: 'Device average current', explain: 'Each device carries the load current only for its share of the cycle, so its average is a fraction of Idc (1/2 for full-wave, 1/3 for a three-phase bridge).' },
  piv: { concept: 'Peak inverse voltage', explain: 'The largest reverse voltage any blocking device must withstand — the voltage rating it needs.' },
  ifwAvg: { concept: 'Freewheeling diode average current', explain: 'The share of the load current carried by Dfw while the source path is off.' },
  ifwPeak: { concept: 'Freewheeling diode peak current', explain: 'Dfw inherits the inductor current at the hand-over, so its peak equals the load current at that instant.' },
  fwConductionDeg: { concept: 'Freewheeling interval', explain: 'For how much of each cycle the inductor current circulates through Dfw instead of the source.' },
  wlMax: { concept: 'Maximum inductor energy', explain: 'E_L = ½·L·i² at the current peak: the most energy the magnetic field stores each cycle.' },
  wlMin: { concept: 'Minimum inductor energy', explain: 'E_L at the current minimum. Zero means the inductor empties every cycle (discontinuous current).' },
  conductionAngleDeg: { concept: 'Conduction angle', explain: 'How many degrees per cycle the reference device conducts: 180° for an ideal half-wave on R, 120° in a three-phase bridge, more with an inductor holding it on.' },
  turnOnAngleDeg: { concept: 'Turn-on angle', explain: 'Where conduction starts: when the source exceeds the device drop (diodes) or when the gate fires (SCRs).' },
  turnOffAngleDeg: { concept: 'Turn-off / extinction angle', explain: 'Where conduction ends: the current reaches zero (extinction angle β) or another device takes over.' },
  efficiency: { concept: 'Rectification efficiency', explain: 'η = P_load / P_source: the fraction of the input power that reaches the load; the rest is lost in the devices.' },
}
