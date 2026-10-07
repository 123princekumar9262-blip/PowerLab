# Rectifier Lab

**Understand the circuit by watching it work.**

An interactive power-electronics laboratory for rectifiers. Move a time cursor
across the waveforms and the circuit diagram, the diode states, the current paths
and a cause → effect explanation all update to that same instant. Every value comes
from a time-domain simulation of the circuit. Nothing is a pre-drawn "expected" waveform.

**Status.** Two sections, chosen with the tabs at the top right:

- **Single-phase** (roadmap phases 1–10): half-wave, center-tap and bridge rectifiers with
  R, RL, RC (capacitor filter) and RLC (choke-input filter) loads, plus an energy view.
- **Three-phase** (phases A–I): a balanced three-phase source, the 3-pulse half-wave
  rectifier, the 6-pulse bridge and the half-controlled bridge, all with the same four loads.
  Diodes or SCRs with firing angle α = 0–180°, an optional freewheeling diode, source R/L
  (commutation overlap), and fault injection.

Modes: Explore, Learn, Experiment, Predict, Challenge and Reverse. 354 unit tests pass, along with
two browser smoke suites (54 single-phase checks and 24 three-phase checks).

## Run it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # physics / theory / limits / lessons / challenges (Vitest)
npm run build        # type-check + production build into dist/
npm run smoke        # browser smoke tests — need the dev server on port 5199:
npm run smoke3       #   npm run dev -- --port 5199     (then, in another terminal)
                     #   npm run smoke && npm run smoke3
```

The smoke test drives Microsoft Edge through Playwright (`PW_CHANNEL=chrome` to use
Chrome instead) and saves screenshots to `scripts/out/`.

## Using the lab

1. **Choose rectifier**: Half-wave, Center-tap or Bridge. 2. **Choose load**: R, RL, RC or RLC.
3. **Run simulation**.
4. **Move the cursor**: drag on the scope, or use ← / →.
5. **Observe the circuit**: each diode shows ON (green) or OFF (red). Charge particles move
   along every branch carrying current, at a speed proportional to that branch's simulated
   current and in its direction. You can watch a capacitor's current reverse as it discharges
   into R. Polarity marks show the actual voltage polarity at that instant.
6. **Press WHY**: the causal chain source → circuit condition → diode states →
   current path → energy → output → waveform, generated from the state at the cursor.

| Control | Action |
|---|---|
| Drag on scope | move the time cursor |
| Wheel / ＋ − | zoom time axis around the pointer |
| Shift + drag, horizontal wheel | pan |
| Double-click, **Fit**, **1 cycle** | whole run / zoom to one cycle |
| **Overlay · Grouped · Separate** | graph layout. Overlay: all traces on one screen (V left axis, A right axis, zeros aligned). Grouped: one graph per quantity. Separate: one graph per signal |
| Legend chips | show / hide each signal |
| ◆ / ○ markers, event chips | jump to an event and read *What happened? / Why?* |
| Space, ←, →, Home | play/pause, step back/forward, reset |
| Step size: Event · 15° · Δt | next detected event · next 15° of θ · one timestep |
| Speed 0.25×–4× | 1× = one source cycle every 4 s (slow motion) |
| ⚡ Energy view | power ledger (who supplies, who absorbs, with a live Σp = 0 check), energy stored in L and C, energy/power channels on the scope |

### Three-phase section

Pick **Three-phase** at the top right. The single-phase circuit and its parameters are
kept and come back when you switch back.

- **Source.** Defaults are 12 V RMS per phase (VLL = 20.78 V), 50 Hz, R = 10 Ω, L = 10 mH.
  VaN = Vm·sin(ωt), VbN lags by 120°, VcN by 240° (sequence abc; **Advanced** offers acb).
- **Device numbering** follows the usual textbook bridge: D1, D3, D5 on top (phases a, b, c),
  D4, D6, D2 below. The conduction sequence is D1D2 → D2D3 → D3D4 → D4D5 → D5D6 → D6D1, one
  pair every 60°. The 3-pulse rectifier uses Da, Db, Dc. SCRs are shown as T1…T6.
- **Angle view** (under the schematic): one steady-state cycle against θ, the phase voltages and
  Vo, the commutation lines, a device timeline with gate pulses, and a phasor diagram. Click or
  drag it to move the same master cursor that drives everything else.
- **Physics Lens**: six stages (source → highest/lowest phase → devices → current path → output
  → waveform). Each stage dims the parts of the schematic it is not talking about.
- **Switching devices**: Diodes or SCRs, firing angle α, freewheeling diode. The half-controlled
  bridge uses SCRs on top and diodes below.
- **Faults** (Experiment mode): a device open or shorted, one device with a different Vf,
  a missing phase, or one phase at reduced amplitude.

L and C fields appear when the chosen load has them. Phase, Vf, Ron, duration and timestep
sit under **Advanced**. Changing any parameter, or the circuit, re-runs the simulation.

### Modes

- **Explore**: free exploration of any circuit and parameter.
- **Learn** (Phase 8): 8 single-phase and 5 three-phase guided lessons. Each step places the cursor on a meaningful instant and
  narrates it with numbers read from the simulation, with short quizzes. Progress is saved in this browser.
- **Experiment**: capture BEFORE, change anything (parameters, devices, a fault), and get a
  before/after table of measured quantities with a WHY for each change. If you change several
  things at once it says so, because their effects mix.
- **Predict** (Phase 9): two tabs. *Sketch the output*: draw Vout for one cycle and estimate
  Vdc / γ / β / ripple *before* seeing anything, then reveal the simulation over your sketch and get
  a score. *What if…?*: 11 questions such as "R doubles: what happens to Idc?". Both circuits are
  simulated and the answer comes from the measured difference (±0.5 % counts as unchanged).
- **Challenge** (Phase 10): 6 single-phase and 3 three-phase design tasks, e.g. "ripple ≤ 1 V without
  oversizing C" or "24 V from a six-pulse bridge". Only some parameters are unlocked. The simulation
  awards ★ for the goal and ★ for each of two bonuses.
- **Reverse**: the circuit is hidden and only the source and output channels are shown.
  Identify the rectifier, the load and the conducting devices at a probe instant.

## Project structure

```
src/
  types/simulation.ts        shared types: params, trace, events, diode bias, signals
  simulation/
    params.ts                defaults, limits, sanitizeParams (validation → SI units)
    source.ts                vin(t) = Vm·sin(ωt + φ); threePhaseSource (sequence, imbalance)
    engine.ts                time stepping with exact switching instants, event detection
  solvers/
    linear.ts                dense Gaussian elimination (singular ⇒ impossible diode combination)
    rootFinding.ts           bisection, golden-section search
  circuits/
    netlist.ts               MNA solver: R, L, C (backward Euler), sources, PWL diodes, SCRs, faults,
                             floating-network reference
    rectifier.ts             builds any topology × load (single- and three-phase); assumed-state search
    circuitModel.ts          CircuitModel interface
    registry.ts              topologies, loads, model cache
  measurements/
    measurements.ts          Vdc, RMS, ripple, RF, γ, θon, β, PIV, powers, η, steady-state check
    theory/index.ts          dispatch; single-phase closed-form theory per load (+ approximations)
    theory/waveform.ts       shared: analytic waveform → measurements by quadrature
    theory/threePhase.ts     three-phase theory: envelopes, firing angle, periodic RL, overlap approx.
    compare.ts               simulation vs theory, tolerance, steady-state gating
  explanations/
    rectifier.ts             WHY engine for every single-phase circuit (state + event explanations)
    threePhase.ts            three-phase WHY: highest/lowest phase, conducting pair, gates, faults
    lens.ts                  Physics Lens stages built from the same explanation
  experiment/                before/after snapshots, measured differences, WHY per change
  reverse/                   reverse-engineering tasks (hidden circuit)
  learning/                  lessons (Phase 8), facts read from the simulation, cursor targets
  prediction/                sketch tasks and scoring (Phase 9); what-if questions
  challenges/                design challenges and evaluation (Phase 10)
  visualization/             scope renderer (overlay/grouped/separate), signals, scales, events
  state/                     reducer, playback, stepping, mode logic (useModes)
  components/                Header, CircuitDiagram, ThreePhaseDiagram (+ circuit/symbols), AngleView,
                             PhysicsLens, Scope, Transport, StatePanel, EnergyPanel, ParameterPanel,
                             MeasurementTable, EventPanels, modes/*
  styles/index.css           design tokens + layout
tests/                       Vitest suites (physics, theory, limits, three-phase, modes, lessons, challenges)
scripts/smoke.mjs            Playwright end-to-end check (single-phase)
scripts/smoke3.mjs           Playwright end-to-end check (three-phase)
docs/simulation.md           the mathematical model
```

## Architecture

```
LabParams ─► sanitizeParams ─► ResolvedParams
          ─► engine: per Δt → netlist solve for the consistent diode combination
                     (switching instants located exactly; storage states continuous)
          ─► SimulationResult { trace (typed arrays), events (refined times) }
          ─► measurements ─► comparison with independent closed-form theory
          ─► explanations (state at cursor, events) ─► lessons / predictions / challenges
          ─► UI (circuit SVG, scope canvas, panels)
```

Rules the code keeps:

- **The simulation is the single source of truth.** Components never compute
  physics. They read `SimulationResult`, `Measurements` and explanations. Lessons and
  challenges only set parameters and place the cursor.
- **One general solver.** Every circuit is a netlist solved by modified nodal analysis, with
  an assumed-state search over diode combinations. There are no per-circuit equations to keep in sync.
- **The cursor indexes the simulation.** The circuit diagram, scope cursor, readings,
  state panel and WHY chain all read the same sample index. Playback and stepping
  only move that index.
- **The engine has no framework dependency.** Everything under `simulation/`, `solvers/`,
  `circuits/`, `measurements/`, `explanations/`, `learning/`, `prediction/` and `challenges/`
  is plain TypeScript and is tested in Node.
- **Typed column storage.** Traces are `Float64Array` columns, so hundreds of thousands of
  samples stay cheap. `sampleAt(result, i)` returns a plain object.

### Diode logic

See `src/circuits/netlist.ts` and [docs/simulation.md §3](docs/simulation.md). For each diode
combination, nearest to the present one first, the network is solved. A combination is kept only
if every ON diode carries forward current and every OFF diode has vD ≤ Vf. The WHY panel's
"circuit condition" step restates this test in words.

### How the waveform engine works

`runSimulation(params, circuitId)` sanitizes the inputs, fits Δt to the duration, and steps the
model. When the diode combination changes inside a step, the engine bisects for the instant the
old combination stops being self-consistent. It advances the old circuit exactly to that instant,
records the events, and continues with the new combination. The scope renders the typed arrays
with per-pixel min/max decimation. That is a rendering optimisation only.

## Adding another circuit

Circuits are netlists. To add, say, a half-wave rectifier with a freewheeling diode:

1. **Netlist**: in `src/circuits/rectifier.ts`, add the topology/load case. Add the extra
   `{ kind: 'D', … }` element and give it the next `DiodeId`. The combination search,
   switching-instant location, events and energy accounting work unchanged.
2. **Registry**: list it in `src/circuits/registry.ts` (`TOPOLOGIES` / `LOADS`).
3. **Signals**: add any new signal to `SignalId`, `signalsFor()` and `visualization/signals.ts`.
   Validate its colour against its scope lane with the dataviz palette validator.
4. **Theory**: add a case to `measurements/theory/index.ts`, or leave it out. The table then
   shows "no closed form" rather than a fake value.
5. **Diagram**: add the drawing in `CircuitDiagram.tsx`, attaching each wire to its branch current.
6. **Explanations**: extend `explanations/rectifier.ts`.
7. **Tests**: add the circuit to `ALL_CIRCUITS` in `tests/helpers.ts`. The theory, energy, limits
   and no-fallback suites then cover it automatically.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Half-wave, R load | ✅ |
| 2 | Full-wave R (center-tap and bridge) | ✅ |
| 3 | RL (extinction angle, continuous / discontinuous) | ✅ |
| 4 | RC capacitor filter (exact theory + textbook approximation) | ✅ |
| 5 | RLC choke-input filter (critical inductance, continuous mode) | ✅ |
| 6 | Energy view (power ledger, stored energy, conservation check) | ✅ |
| 7 | WHY engine for every circuit (inductor hold-on, capacitor hold-up, commutation) | ✅ |
| 8 | Learn mode: 8 guided lessons | ✅ |
| 9 | Predict mode: sketch, estimate, reveal, score | ✅ |
| 10 | Challenge mode: 6 design tasks with stars | ✅ |
| A | Three-phase source (120° displacement, abc / acb, imbalance) | ✅ |
| B | 3-pulse half-wave rectifier, R load | ✅ |
| C | 6-pulse bridge, R load (conducting pair, 6f ripple, 1.35·VLL) | ✅ |
| D | RL load (continuous current, inductor smoothing) | ✅ |
| E | Physics Lens, three-phase WHY engine, angle view | ✅ |
| F | Measurements and theory: phase/line RMS, Vdc, ripple frequency | ✅ |
| G | Experiment (before/after), What-if predictions, Reverse engineering | ✅ |
| H | Faults: device open/short, unequal Vf, missing phase, imbalance | ✅ |
| I | RC/RLC loads, SCRs with α = 0–180°, half-controlled bridge, freewheeling diode, gate pulses | ✅ |

Possible next steps: single-phase controlled rectifiers, a closed-form theory for commutation
overlap (it is shown only as an approximation now), and twelve-pulse arrangements.
