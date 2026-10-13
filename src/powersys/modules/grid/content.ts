/**
 * The Grid Explorer's words: what each part of the network is, what it does and what it looks like. Numbers are
 * never written here — every value on screen comes from the solved network.
 */
export interface PartInfo {
  title: string
  /** One line: what it is. */
  what: string
  /** What it does in this network, and why it is there. */
  does: string
  /** What you would see if you stood next to it. */
  looks: string
}

export const PARTS: Record<string, PartInfo> = {
  G1: {
    title: 'Generator G1',
    what: 'A three-phase synchronous generator driven by a turbine.',
    does: 'Converts the turbine’s mechanical power into electrical power at 13.8 kV. Here it is the reference (slack) source: it holds its terminal voltage and supplies whatever the network needs — the loads plus every loss on the way.',
    looks: 'A large cylinder in the turbine hall, coupled to the turbine shaft; heavy bus ducts carry its kiloamperes out to the step-up transformer.',
  },
  T1: {
    title: 'Step-up transformer T1',
    what: 'A generator transformer, 13.8 kV to 220 kV (delta on the generator side, earthed star on the 220 kV side).',
    does: 'Raises the voltage 16-fold so the same power flows with one-sixteenth of the current — and losses, which grow with current squared, become tiny.',
    looks: 'An oil-filled tank the size of a small house, with radiators along its sides and tall porcelain bushings on top for the 220 kV connections.',
  },
  L1: {
    title: '220 kV transmission line L1',
    what: 'A 120 km overhead line on lattice steel towers.',
    does: 'Carries the station’s output across the country. Its series resistance causes I²R loss; its reactance makes the voltage angle fall along it; its capacitance to earth produces reactive power (line charging).',
    looks: 'Steel towers 40–50 m tall every 300–400 m, each holding three conductors (one per phase) on long insulator strings, with an earth wire on top.',
  },
  T2: {
    title: 'Grid transformer T2',
    what: 'A 220/33 kV transformer at the grid substation, with an off-load tap set to +5 % on the 33 kV side.',
    does: 'Steps the voltage down for sub-transmission. The +5 % tap raises the 33 kV voltage to make up for the voltage that will be lost along the 33 kV line.',
    looks: 'A large transformer inside a fenced switchyard, among gantries, isolators and breakers.',
  },
  L2: {
    title: '33 kV line L2',
    what: 'A 10 km sub-transmission overhead line on concrete or steel poles.',
    does: 'Carries power from the grid substation to the town’s distribution substation. At 33 kV the current is much larger than at 220 kV, so a shorter line loses a bigger share of the power.',
    looks: 'Poles about 11–13 m tall with three conductors on pin or disc insulators.',
  },
  T3: {
    title: 'Distribution transformer T3',
    what: 'A 33/11 kV substation transformer (delta/earthed star), its 33 kV winding set on the −5 % tap.',
    does: 'Steps down to 11 kV for the town’s feeders. The −5 % tap on its 33 kV winding raises the 11 kV voltage by about 5 %.',
    looks: 'A medium transformer in a small fenced substation at the edge of the town, with 11 kV cables leaving for each feeder.',
  },
  factory: {
    title: 'Factory',
    what: 'A large industrial consumer supplied directly at 33 kV.',
    does: 'Draws a constant 12 MW at 0.85 power factor (lagging) — motors make its demand partly reactive. Large consumers are supplied at higher voltage to keep their currents and losses down.',
    looks: 'Its own 33 kV intake substation and transformers inside the factory site.',
  },
  town: {
    title: 'The town',
    what: 'Homes, shops and offices, supplied at 11 kV.',
    does: 'Draws 16 MW at 0.95 power factor (lagging). In reality pole-mounted 11 kV/400 V transformers near the houses supply 230 V to each home — that last step is not modelled here.',
    looks: '11 kV feeders along the streets, small transformers on poles or in kiosks, and low-voltage cables to every building.',
  },
  gen: {
    title: 'Generator terminals (13.8 kV)',
    what: 'The bus where the generator connects to its step-up transformer.',
    does: 'Generator voltages are kept at 10–25 kV because the insulation of a rotating machine’s windings limits how high they can go.',
    looks: 'Isolated-phase bus ducts between the generator and the transformer.',
  },
  hvA: {
    title: 'Power-station switchyard (220 kV)',
    what: 'The high-voltage bus at the power station.',
    does: 'Where the step-up transformer meets the transmission line; its breakers connect and disconnect them.',
    looks: 'Rows of gantries, breakers, isolators and instrument transformers on a gravel yard.',
  },
  hvB: {
    title: 'Grid substation (220 kV)',
    what: 'The 220 kV bus at the receiving end of the transmission line.',
    does: 'Receives the transmitted power. Its voltage is a little lower than the sending end, and its angle lags further behind.',
    looks: 'A switchyard much like the one at the power station.',
  },
  mvA: {
    title: 'Grid substation (33 kV)',
    what: 'The 33 kV bus of the grid substation.',
    does: 'Distributes power to the factory and to the 33 kV line towards the town.',
    looks: 'Indoor or outdoor 33 kV switchgear with one breaker per outgoing feeder.',
  },
  mvB: {
    title: 'Distribution substation (33 kV)',
    what: 'The 33 kV bus at the end of line L2.',
    does: 'Its voltage is the lowest in the network: everything lost along the 33 kV line shows up here.',
    looks: 'A small fenced substation.',
  },
  lv: {
    title: 'Town feeders (11 kV)',
    what: 'The 11 kV bus that supplies the town.',
    does: 'The voltage the town receives. Utilities must keep it close to nominal (typically within about ±6 %).',
    looks: '11 kV switchgear with a breaker for each feeder leaving the substation.',
  },
  CB1: {
    title: 'Breaker CB1',
    what: 'The circuit breaker of the 220 kV line.',
    does: 'Can switch the line out — for maintenance, or automatically when protection detects a fault. This network is radial: with the line open, nothing beyond it has a supply.',
    looks: 'An SF₆ breaker: three porcelain columns with a mechanism cabinet at the base.',
  },
  CB2: {
    title: 'Breaker CB2',
    what: 'The circuit breaker of the 33 kV line.',
    does: 'Switches the 33 kV line, and so the whole town. The factory, fed from the 33 kV bus before the line, is not affected.',
    looks: 'A vacuum or SF₆ breaker in the 33 kV switchgear.',
  },
  CB3: {
    title: 'Breaker CB3',
    what: 'The factory feeder’s breaker.',
    does: 'Connects or disconnects the factory.',
    looks: 'A panel in the 33 kV switchgear.',
  },
  CB4: {
    title: 'Breaker CB4',
    what: 'The town feeder’s breaker.',
    does: 'Connects or disconnects the town’s load.',
    looks: 'A panel in the 11 kV switchgear.',
  },
}

export const TAGS: Record<string, string> = {
  G1: 'G1',
  T1: 'T1  13.8/220 kV',
  L1: 'L1  220 kV · 120 km',
  T2: 'T2  220/33 kV',
  L2: 'L2  33 kV · 10 km',
  T3: 'T3  33/11 kV',
  factory: 'Factory',
  town: 'Town',
  gen: 'Generator',
  hvA: 'Switchyard',
  hvB: 'Grid substation',
  mvA: 'Grid substation',
  mvB: 'Distribution s/s',
  lv: 'Town feeders',
}
