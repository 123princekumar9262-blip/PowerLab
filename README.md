# Rectifier Lab

**Understand the circuit by watching it work.**

An interactive power-electronics laboratory for rectifiers. Move a time cursor
across the waveforms and the circuit diagram, the diode states, the current paths
and a cause → effect explanation all update to that same instant. Every value comes
from a time-domain simulation of the circuit. Nothing is a pre-drawn "expected" waveform.

**Status: all ten roadmap phases are built.** That covers three rectifiers (half-wave,
center-tap and bridge full-wave), four loads (R, RL, RC capacitor filter, RLC choke-input filter),
an energy view, and Learn / Predict / Challenge modes. 287 unit tests and a 54-check browser
smoke test pass.

## Run it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # physics / theory / limits / lessons / challenges (Vitest)
npm run build        # type-check + production build into dist/
npm run smoke        # browser smoke test — needs the dev server on port 5199:
                     #   npm run dev -- --port 5199     (then, in another terminal)
                     #   npm run smoke
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

L and C fields appear when the chosen load has them. Phase, Vf, Ron, duration and timestep
sit under **Advanced**. Changing any parameter, or the circuit, re-runs the simulation.

### Modes

- **Lab**: free exploration of any circuit and parameter.
- **Learn** (Phase 8): 8 guided lessons. Each step places the cursor on a meaningful instant and
  narrates it with numbers read from the simulation, with short quizzes. Progress is saved in this browser.
- **Predict** (Phase 9): sketch Vout for one cycle and estimate Vdc / γ / β / ripple *before*
  seeing anything. Then reveal the simulation over your sketch and get a score.
- **Challenge** (Phase 10): 6 design tasks, e.g. "ripple ≤ 1 V without oversizing C" or "keep the choke
  current continuous". Only some parameters are unlocked. The simulation awards ★ for the goal and
  ★ for each of two bonuses.

## Project structure

```
src/
  types/simulation.ts        shared types: params, trace, events, diode bias, signals
  simulation/
    params.ts                defaults, limits, sanitizeParams (validation → SI units)
    source.ts                vin(t) = Vm·sin(ωt + φ)
    engine.ts                time stepping with exact switching instants, event detection
  solvers/
    linear.ts                dense Gaussian elimination (singular ⇒ impossible diode combination)
    rootFinding.ts           bisection, golden-section search
  circuits/
    netlist.ts               MNA solver: R, L, C (backward Euler), sources, PWL diodes, bridge reference
    rectifier.ts             builds any topology × load; assumed-state search over diode combinations
    circuitModel.ts          CircuitModel interface
    registry.ts              topologies, loads, model cache
  measurements/
    measurements.ts          Vdc, RMS, ripple, RF, γ, θon, β, PIV, powers, η, steady-state check
    theory/index.ts          independent closed-form theory per load (+ textbook approximations)
    compare.ts               simulation vs theory, tolerance, steady-state gating
  explanations/rectifier.ts  WHY engine for every circuit (state + event explanations)
  learning/                  lessons (Phase 8), facts read from the simulation, cursor targets
  prediction/                prediction tasks and scoring (Phase 9)
  challenges/                design challenges and evaluation (Phase 10)
  visualization/             scope renderer (overlay/grouped/separate), signals, scales, events
  state/                     reducer, playback, stepping, mode logic (useModes)
  components/                Header, CircuitDiagram (+ circuit/symbols), Scope, Transport, StatePanel,
                             EnergyPanel, ParameterPanel, MeasurementTable, EventPanels, modes/*
  styles/index.css           design tokens + layout
tests/                       Vitest suites (physics, theory, limits, lessons, challenges)
scripts/smoke.mjs            Playwright end-to-end check
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

Possible next steps: a freewheeling diode, source inductance (commutation overlap),
thyristor (phase-controlled) rectifiers, and three-phase bridges. The netlist engine already
supports all of these.
