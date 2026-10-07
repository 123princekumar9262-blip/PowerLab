# Rectifier Lab

**Understand the circuit by watching it work.**

An interactive power-electronics laboratory for rectifiers. Move a time cursor
across the waveforms and the circuit diagram, the diode state, the current path
and a cause → effect explanation all update to that same instant. Every value comes
from a time-domain simulation of the circuit. Nothing is a pre-drawn "expected" waveform.

**Status: Phase 1, half-wave rectifier with R load.** Full-wave, RL, RC and RLC
appear in the UI as "Soon" and are not implemented yet.

## Run it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # physics / measurement / explanation unit tests (Vitest)
npm run build        # type-check + production build into dist/
npm run smoke        # browser smoke test — needs the dev server on port 5199:
                     #   npm run dev -- --port 5199     (then, in another terminal)
                     #   npm run smoke
```

The smoke test drives Microsoft Edge through Playwright (`PW_CHANNEL=chrome` to use
Chrome instead) and saves screenshots to `scripts/out/`.

## Using the lab

1. **Choose rectifier** → Half-wave. 2. **Choose load** → R. 3. **Run simulation**.
4. **Move the cursor**: drag on the scope, or use ← / →.
5. **Observe the circuit**: the diode highlights ON (conducting) or OFF (blocking),
   charge particles move along the conduction path at a speed proportional to the
   current, and the polarity marks show the actual voltage polarity at that instant.
6. **Press WHY**: the causal chain source → circuit condition → diode state →
   current path → energy → output → waveform, generated from the state at the cursor.

| Control | Action |
|---|---|
| Drag on scope | move the time cursor |
| Wheel / ＋ − | zoom time axis around the pointer |
| Shift + drag, horizontal wheel | pan |
| Double-click, **Fit**, **1 cycle** | reset / zoom to one cycle |
| ◆ / ○ markers, event chips | jump to an event and read *What happened? / Why?* |
| Space, ←, →, Home | play/pause, step back/forward, reset |
| Step size: Event · 15° · Δt | next detected event · next 15° of θ · one timestep |
| Speed 0.25×–4× | 1× = one source cycle every 4 s (slow motion) |

Advanced parameters (phase, diode model, Vf, Ron, duration, timestep) sit under
**Advanced** in the parameter panel. Changing any parameter re-runs the simulation.

## Project structure

```
src/
  types/simulation.ts        shared types: params, trace, events, diode bias
  simulation/
    params.ts                defaults, limits, sanitizeParams (validation → SI units)
    source.ts                vin(t) = Vm·sin(ωt + φ)
    engine.ts                time stepping, event detection, sampleAt / indexAt*
  solvers/
    diode.ts                 assumed-state diode solver against a Thévenin network
    rootFinding.ts           bisection, golden-section search (event refinement)
  circuits/
    circuitModel.ts          CircuitModel interface (state vector + step)
    halfWaveR.ts             Phase 1 circuit
    registry.ts              available / planned circuits
  measurements/
    integrate.ts             windowed trapezoidal integration
    measurements.ts          avg / RMS / peak / γ / ripple from the trace
    theory/halfWaveR.ts      closed-form theory (with Vf and Ron)
    compare.ts               simulation vs theory + tolerance flag
  explanations/
    halfWaveR.ts             WHY engine: state explanation + event explanations
    trend.ts                 rising / falling / peak from neighbouring samples
    index.ts                 explainer registry per circuit
  visualization/
    scopeRenderer.ts         canvas oscilloscope (base + overlay layers)
    signals.ts, scales.ts, eventGroups.ts
  state/
    labState.ts              UI reducer (no physics stored here)
    stepping.ts              step-forward / back targets
    usePlayback.ts           slow-motion playback of existing data
  components/                React UI (Header, CircuitDiagram, Scope, Transport,
                             StatePanel, EventPanels, ParameterPanel, MeasurementTable)
  styles/index.css           design tokens + layout
tests/                       Vitest suites
scripts/smoke.mjs            Playwright end-to-end check
docs/simulation.md           the mathematical model
```

## Architecture

```
LabParams ─► sanitizeParams ─► ResolvedParams
          ─► engine: for each Δt → CircuitModel.step → diode solver → circuit equations
          ─► SimulationResult { trace (typed arrays), events (refined times) }
          ─► measurements ─► theory comparison
          ─► explanations (state at cursor, events)
          ─► UI (circuit SVG, scope canvas, panels)
```

Rules the code keeps:

- **The simulation is the single source of truth.** Components never compute
  physics. They read `SimulationResult`, `Measurements` and explanations.
- **The cursor indexes the simulation.** The circuit diagram, scope cursor, readings,
  state panel and WHY chain all read the same sample index. Playback and stepping
  only move that index.
- **The engine has no framework dependency.** Everything under `simulation/`,
  `solvers/`, `circuits/`, `measurements/` and `explanations/` is plain TypeScript and is tested in Node.
- **Typed column storage.** Traces are `Float64Array` columns (hundreds of thousands of
  samples stay cheap). `sampleAt(result, i)` returns a plain object
  `{ time, vin, vout, vd, io, id, diodeState, bias }`.

### Diode logic

See `src/solvers/diode.ts` and [docs/simulation.md §4](docs/simulation.md). Each
instant, the solver tests the ON hypothesis (`i = (vth − Vf)/(Rth + Ron) > 0`?) and the OFF hypothesis (`vD = vth ≤ Vf`?), and
keeps the consistent one. The WHY panel's "circuit condition" step restates this test.

### How the waveform engine works

`runSimulation(params)` sanitizes the inputs, fits Δt to the duration, and calls
`model.step` once per timestep. When a diode changes state (or current starts or stops)
between two samples, the engine re-solves the circuit at fractional steps from the
previous state and bisects to the exact instant. Source zero crossings and peaks are
refined on `vin(t)`. The scope renders the typed arrays with per-pixel min/max
decimation. That is a rendering optimisation only.

## Adding another circuit (e.g. Phase 3, RL)

1. **Model**: create `src/circuits/halfWaveRL.ts` implementing `CircuitModel<{ iL: number }>`.
   In `step`, integrate the state, e.g. with trapezoidal/backward-Euler on
   `L·di/dt = vin − R·i − vD`. The diode turns OFF when `iL` reaches 0 (not when vin
   does), so use `solveDiodeThevenin` with the companion-model Thévenin values. Add
   `vl` (and any new signal) to `SignalId`.
2. **Register** it in `src/circuits/registry.ts` (set `model`). The "Soon" badge
   disappears automatically.
3. **Theory**: add `src/measurements/theory/halfWaveRL.ts` and select it by circuit in `compare.ts`.
4. **Explanations**: add an explainer (stored inductor energy ½·L·i², current
   continuing past the zero crossing) and register it in `src/explanations/index.ts`.
5. **Visuals**: add lanes/signal metadata in `visualization/signals.ts` and the inductor
   symbol in a circuit diagram component.
6. **Tests**: copy the structure of `tests/halfWaveR.*.test.ts`.

The engine, event detection, measurements, scope, cursor sync, playback and stepping
need no changes.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Half-wave, R load | ✅ done |
| 2 | Full-wave, R | planned |
| 3 | RL (di/dt = (vin − Ri)/L, extinction angle) | planned |
| 4 | RC (capacitor filter, ripple) | planned |
| 5 | RLC (state-space model) | planned |
| 6 | Energy visualization | planned |
| 7 | WHY engine expansion | planned |
| 8–10 | Learning, prediction, challenge modes | planned |
