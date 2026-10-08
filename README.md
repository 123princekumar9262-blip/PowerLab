# Power Electronics Lab

**Understand the circuit by watching it work.**

An interactive power-electronics laboratory. The top bar holds the modules:
- **Rectifiers**
- **DC-DC:** buck, boost, buck-boost
- **PWM:** the PWM lab
- **Inverters:** single-phase, three-phase, SPWM, SVPWM
- **Devices:** MOSFET double-pulse test
- **Drives:** DC motor on a 1Q/2Q chopper
- **Magnetics:** gapped inductor, saturation
- **Control:** closed-loop buck and boost
- **EV:** drivetrain on a drive cycle, 0–100 km/h
- **Engineering:** switch losses and thermal path

Every module is built. See [DC-DC converters](#dc-dc-converters-buck),
[PWM and inverters](#pwm-lab-and-inverters) and [the other modules](#control-devices-drives-magnetics-ev-engineering).
The design documents are `docs/converters.md`, `docs/pwm-inverters.md` and `docs/modules.md`.

The Rectifiers module is an interactive laboratory for rectifiers. Move a time cursor
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

- **Single-phase controlled rectifiers**: half-wave controlled, semi-controlled bridge (2 SCRs + 2 diodes) and fully controlled bridge, with firing angle α = 0–180°.
- **Freewheeling diode** on every single-phase rectifier (half-wave, center-tap, bridge; R, RL, RLC) and every three-phase one.
- **Commutation overlap μ** (three-phase, source inductance Ls): measured from the switching events, compared with the overlap relation when its assumptions hold.
- **Compare** mode: two rectifiers simulated side by side on a declared basis (same Vph, same VLL, same output or input power).

Modes: Explore, Learn, Experiment, Predict, Challenge and Reverse.

**Tests.** 757 unit tests pass:

| Area | Tests |
|---|---|
| Rectifier | 426 |
| Buck | 55 |
| Boost / buck-boost | 78 |
| PWM | 48 |
| Inverter | 37 |
| Control | 19 |
| Devices | 18 |
| Drives | 22 |
| Magnetics | 17 |
| EV | 18 |
| Engineering | 19 |

**Browser smoke suites.** Seven suites pass (336 checks):

| Suite | Checks |
|---|---|
| Single-phase | 56 |
| Three-phase | 40 |
| Freewheeling diode | 29 |
| Controlled / compare | 36 |
| DC-DC | 55 |
| PWM / inverters | 33 |
| Control, Devices, Drives, Magnetics, EV, Engineering | 87 |

## Run it

Requires Node 20+ (developed on Node 24).

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # physics / theory / limits / lessons / challenges (Vitest)
npm run build        # type-check + production build into dist/
npm run smoke        # browser smoke tests — need the dev server on port 5199:
npm run smoke3       #   npm run dev -- --port 5199     (then, in another terminal)
npm run smoke-fw     #   npm run smoke && npm run smoke3 && npm run smoke-fw && npm run smoke-ctl
npm run smoke-ctl
npm run smoke-dcdc   # DC-DC converters (http://localhost:5199/#dcdc)
npm run smoke-inv    # PWM lab and inverters (#pwm, #inverters)
npm run smoke-modules # Control, Devices, Drives, Magnetics, EV, Engineering
```

The smoke test drives Microsoft Edge through Playwright (`PW_CHANNEL=chrome` to use
Chrome instead) and saves screenshots to `scripts/out/`.

## Using the lab

**Everything is available, but not everything is visible at once.** The screen shows only what
you need to follow the circuit. The rest opens when you ask for it, and nothing in the simulation
changes when you open or close a panel.

| Level | Always visible | On request |
|---|---|---|
| 1 · Essential | the circuit; the state strip (what conducts, Vo, Io, t, θ); playback; one primary view; Basic parameters (V, f, R) | |
| 2 · Context | | **⇢ Current path** (drawer, path highlighted on the circuit) · **WHY?** · **⚡ Energy** · **🔎 Inspect** (click a component) · Events view · Angle view · channel presets and **+ Add channel** |
| 3 · Analysis | | **Measurements** (Summary, Output, Load, Diodes, Timing, Theory vs Simulation) · **Theory & equations** (concept, formula, theory, simulation, error, *Explain formula*) |
| 4 · Learning | | right-panel tabs **State · Why · Learn · Energy**; the Physics Lens inside Why; the modes Learn, Experiment, Predict, Challenge, Reverse |

- **Beginner / Standard / Engineer** (top right) sets how much is shown, never what exists.
  - **Beginner**: the circuit, Vo and Io, the basic waveforms, WHY and the current path.
  - **Standard** (default) adds device states, the angle view, measurements and energy.
  - **Engineer** adds every reading, more channel presets, timing, the theory comparison, and opens the advanced parameters.
- **◎ Focus** hides everything except the circuit, the waveform and the state, with WHY and the current path one click away.
- **What do you want to study?** (above the circuit) sets things up for you: channels, view, highlighting and the panel. Choices include how the diodes switch, how the output is formed, the load current, the firing angle, energy flow, measurements and theory.
- **Primary view**: **Waveforms**, **Angle view** (three-phase), **Events**, or **With / without Dfw** (freewheel circuit), one at a time.
- **Channels**: presets **Basic · Diode analysis · Load analysis · Power electronics · Everything**, or pick channels one by one with **+ Add channel**. Click a channel chip to hide it.
- **Parameters**: Basic shows V, f and R (plus the firing angle α for a controlled rectifier). **Advanced parameters** holds load elements (L, C), devices (diode model, Vf, Ron, diodes/SCRs, freewheeling diode), source (φ, sequence, Rs, Ls) and simulation settings. It opens by itself when a challenge unlocks a field inside it.
- Drawers are non-modal: the cursor and playback keep working behind them, and **Esc** closes them.

| Control | Action |
|---|---|
| Drag on scope | move the time cursor |
| Wheel / ＋ − | zoom time axis around the pointer |
| Shift + drag, horizontal wheel | pan |
| Double-click, **Fit**, **1 cycle** | whole run / zoom to one cycle |
| **Overlay · Grouped · Separate** | graph layout (Standard and up) |
| ◆ / ○ markers, Events view | open an event's *What happened? / Why?* |
| Space, ←, →, Home | play/pause, step back/forward, reset |
| Step size: Event · 15° · Δt | next detected event · next 15° of θ · one timestep |
| Speed 0.25×–4× | 1× = one source cycle every 4 s (slow motion) |

### Controlled rectifiers (SCRs)

The rectifier picker has two groups: **Diode** and **Controlled (SCR)**. Single-phase controlled options are
**Half-wave controlled**, **Semi-controlled** (T1, T2 on top, D3, D4 below) and **Fully controlled** (T1–T4); three-phase adds
**3-pulse controlled**, **Half-controlled** and **Fully controlled bridge**. The firing angle α becomes a main parameter.

An SCR is the same netlist diode element with a gate: it turns ON only while forward biased **and** gated, then latches
until its current falls to zero. Gate pulses are synchronised to the source: each SCR is fired α after its natural turn-on
point (single-phase pulses last to the end of the half-cycle; three-phase pulses are 120° wide). Nothing is scheduled: the
solver decides every switching instant.

The **Why** tab of a controlled rectifier adds a **Firing angle α** panel. It shows the measured conduction start, Vdc, and
the same circuit simulated at α = 0 for reference, plus **Why is the SCR OFF?** and **Why did it turn ON now?**.

### Freewheeling diode

Choose any single-phase rectifier with an R, RL or RLC load and press **Freewheeling diode: OFF**
in the bench bar (or the toggle under Advanced parameters → Devices). Dfw is a real circuit element across the load, with its anode on the − output and its
cathode on the + output. Nothing about its behaviour is scripted: the solver decides at every step whether it conducts.

- **Freewheeling diode card** (State tab): Dfw ON/OFF with its bias, current and voltage, plus Vin,
  Vout, IL and the state of D1 at the cursor. Below that are the inductor energy E_L = ½·L·i² and where
  it is going, and a numbered **"Why is the freewheeling diode ON / OFF?"** written from the simulated state.
- **Schematic**: the rails are split at Dfw's junctions, so each wire carries its own simulated current.
  While the diode freewheels, only the L → R → Dfw loop is lit. The scope shades D1's conduction green
  and Dfw's violet, and offers Ifw, Vfw and E_L (WL) channels.
- **With / without Dfw** (primary view): the same circuit simulated twice, drawn on shared axes (Vout, Io,
  Ifw, E_L), with bands where the outputs differ and a table of measured differences. Drag on it to move the master cursor.
- **⏭ Step through conduction**: seven stops found from the simulation's events (D1 ON → D1 OFF →
  current must continue → Dfw forward biased → freewheel current → energy decreasing → Dfw OFF).
  **Auto** plays and pauses at each one.
- **Physics Lens** (Why tab): ten stages, from the source to the decaying current.
- **Experiment** mode offers five guided experiments, and **Predict → What if…?** puts the freewheel
  questions first (e.g. "what happens to the current ripple when Dfw is added?", A–D).

The architecture is reusable: `supportsFreewheel(topology, load)` in `types/simulation.ts` is the only
rule deciding which circuits accept Dfw. The netlist, solver, events, measurements and explanations are generic
(the three-phase rectifiers already use the same element).

### Commutation overlap μ (three-phase)

Set **Source inductance Ls** (Advanced parameters → Source). The overlap then appears naturally: for μ degrees two devices
of the same group conduct together. Measurements → **Commutation / μ** (or *What do you want to study? → Commutation
overlap μ*) shows:

- **Measured μ** = θ(outgoing device turns OFF) − θ(incoming device turns ON), from the simulation's events.
- **Theoretical μ** from cos α − cos(α + μ) = 2ωLs·Id/(√6·Vph), solved numerically, with Id taken from the
  simulated current during each commutation.
- The difference, every commutation with its current transfer, and the assumptions. When an assumption fails (Rs > 0,
  Ron > 0, a fault, a strongly varying current, Ls = 0) the comparison says *unavailable* and why — never a 0 % error.

The scope shades each overlap in amber, and the Events view lists *commutation begins* and *fully conducting*
next to the natural commutation points.

### Compare mode

**Compare** (top navigation) is its own lab: choose rectifier A and B (only implemented ones are offered) and a
**comparison basis**: same phase RMS voltage, same line-to-line RMS voltage, same output power or same input power. The
power bases re-simulate B until it matches. Load, R, L, C, f, devices and α are held constant and listed.

**Run comparison** simulates both. The results open with summary cards, then tabs: **Output, Current, Power, Stress,
Rectification**. Every value is computed from the two simulations and tagged *Simulated*. The only exception is the textbook
TUF, tagged *Theoretical* and shown only for ideal diodes with an R load. The simulated TUF uses the secondary VA from the
simulated winding currents. Below the tabs: **Why do they differ?** (generated from the results), **Compare waveforms**
(Overlay / Separate / Difference) and **Which should I choose?** (low ripple, high power, battery charging, motor drive,
general supply), each with its trade-offs.

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

## DC-DC converters (buck)

Click **DC-DC** in the top bar (or open `#dcdc`). The converter row is Buck → Boost → Buck-Boost →
Advanced:
- **Buck, Boost and Buck-Boost** are built and validated.
- **Advanced** (Ćuk, SEPIC, flyback…) is planned.

All three converters share the layout below; the boost and buck-boost have their own schematics,
WHY texts ("the inductor voltage ADDS to Vin", "current is pulled OUT of the output"), lessons,
experiments and predictions. The five modes:

- **Explore**:
  - Parameters Vin, D (10–90 %), fs, L, C, R (labelled *SIMULATION VALUES*). Advanced adds real
    devices (Ron, Vf), DCR, ESR, the number of periods shown and the time steps per period.
  - **Steady state** (shooting method) or **Start-up** from a discharged circuit.
  - The schematic animates the conducting loop and shows Q1/D1 ON/OFF. Click any component to
    inspect it.
  - The oscilloscope starts with **Gate, Vsw, iL, Vout**. *+ Add channel* adds iD, iQ, iC, vC,
    iin, iR, vL, vQ, vD, EL, EC, Pin and Pout. Lanes can be Separate or Grouped; the vertical
    scale can be *From 0* or *Zoom to ripple*.
  - The time cursor drives the state card: t, PWM, Q1, D1, iL (with diL/dt), vL, vC, Vout, EL, EC
    and the current path.
  - **Why?** offers What → Why → Equation → Physics → What-if, for the diode, iL, Vout and the
    gate.
  - Energy view: EL, EC and the instantaneous power flow.
  - CCM/DCM is detected from the simulation, with a boundary indicator.
  - ← → step the cursor; Shift + ← → jump between switching events.
- **Learn**: two lessons, *How a buck converter works* (6 steps) and *CCM and DCM* (3 steps).
- **Experiment**: duty, inductance, capacitance, frequency and the DCM transition. Each one runs
  prediction → simulation → before/after table → WHY. There is also a free before/after capture.
- **Predict**: Vout, ΔiL and CCM-or-DCM. The simulation answers first, then the theory is shown.
- **Analyze**:
  - SIMULATION vs THEORY. The theory is either the *textbook* (ideal relations, with assumptions
    and *not applicable* reasons) or the *exact* analytic solution of the same equations, which
    validates the solver.
  - The volt-second derivation, checked on the simulated averages.
  - A duty sweep (17 simulations on the ideal curve).
  - Numerical checks: shooting residual, Δt, and convergence as Δt halves.

## PWM lab and inverters

### PWM lab

Open **PWM** in the top bar (`#pwm`).

- **Signals:** a triangle or sawtooth carrier against a DC or sine reference, with natural,
  regular-symmetric or regular-asymmetric sampling, an optional N-bit counter, dead time and a
  unipolar or bipolar output.
- **Explore:** a block diagram, the comparator state, local duty and moving average at the cursor,
  and a **Spectrum** side tab.
- **Analyze:** every harmonic against its closed form (pulse-train Fourier series, Bessel
  double-Fourier series).
- **Learn:** carrier, comparator, average, spectrum, sampling.
- **Experiment:** mf, M, overmodulation, sampling.
- **Predict.**

### Inverters

Open **Inverters** (`#inverters`). The sub-navigation is Single-phase · Three-phase · SPWM · SVPWM.

- **Circuit:** IGBTs (gated, forward only) with antiparallel diodes, simulated as a circuit. The
  solver decides when a diode carries the returning inductive current, including during dead time.
- **Single-phase:** half or full bridge, square or quasi-square (α).
- **Three-phase:** six-step.
- **SPWM:** bipolar, unipolar or three-phase.
- **SVPWM:** a space-vector hexagon with the sector, the reference vector and the T1/T2/T0 bars of
  the switching period under the cursor.
- **Explore:** the conducting device of every leg, the load current and the DC power (negative when
  energy returns), WHY cards ("Why does D2 conduct?", "Why does van have steps of Vdc/3?", "Which
  vectors are applied now?") and spectra.
- **Analyze:** the simulation against the exact ideal-switch theory (closed-form and Bessel spectra,
  the exact R-L current) and per-device conduction.

## Control, Devices, Drives, Magnetics, EV, Engineering

Each module opens from the top bar (`#control`, `#devices`, `#drives`, `#magnetics`, `#ev`,
`#engineering`) in the same five-mode lab. Details, equations and validation are in `docs/modules.md`.

| Module | What you simulate | THEORY it is checked against |
|---|---|---|
| **Control** | buck/boost with a digital PID: reference step, load step, line step; Bode side tab | averaged model with the same PID; discrete loop gain; spectral-radius stability |
| **Devices** | MOSFET double-pulse test: delay, current rise, Miller plateau, ohmic, turn-off | exact piecewise-linear solution; textbook phase formulas |
| **Drives** | DC motor on a one- or two-quadrant chopper: start-up inrush, soft start, load step, regenerative braking, discontinuous conduction | exact PWL solution (period means, t90); averaged model |
| **Magnetics** | gapped core with saturation on a square-wave bridge: volt-seconds, DC bias, start-up flux doubling; B–i side tab | exact PWL solution; L = N²μ0Ae/(lg + le/μr), ΔB = V·d·T/(N·Ae) |
| **EV** | car + battery + motor envelope on urban/highway cycles; 0–100 km/h; regeneration and friction brakes | Gauss–Legendre energy integrals of the followed cycle; t(v) quadrature; top speed |
| **Engineering** | conduction + switching losses rising with Tj through a Foster thermal network; pulsed load (ΔTj); thermal runaway | exact matrix-exponential solution, periodic state, spectral radius; Ta + P·Rth and Zth(ton) estimates |

The four hybrid-system modules (Devices, Drives, Magnetics, Engineering) share one piecewise-linear
toolkit (`src/converters/pwl.ts`):

- **SIMULATION** is trapezoidal time-stepping with exact event location.
- **THEORY** is the matrix-exponential solution of the same equations.

## Project structure

```
src/
  types/simulation.ts        shared types: params, trace, events, diode bias, signals
  simulation/
    params.ts                defaults, limits, sanitizeParams (validation → SI units)
    source.ts                vin(t) = Vm·sin(ωt + φ); threePhaseSource (sequence, imbalance)
    engine.ts                time stepping with exact switching instants, event detection
    commutation.ts           commutation intervals (start/end events, measured μ) — one detector for engine and measurements
  solvers/
    linear.ts                dense Gaussian elimination (singular ⇒ impossible diode combination)
    rootFinding.ts           bisection, golden-section search
  circuits/
    netlist.ts               MNA solver: R, L, C (backward Euler), sources, PWL diodes, SCRs, faults,
                             floating-network reference
    rectifier.ts             builds any topology × load (single- and three-phase); assumed-state search;
                             shared SCR gate pulses; source windings (for TUF)
    devices.ts               which devices are SCRs, display names (T1…, D1…)
    circuitModel.ts          CircuitModel interface
    registry.ts              topologies, loads, model cache
  measurements/
    measurements.ts          Vdc, RMS, ripple, RF, γ, θon, β, PIV, powers, η, steady-state check
    theory/index.ts          dispatch; single-phase closed-form theory per load (+ approximations)
    theory/waveform.ts       shared: analytic waveform → measurements by quadrature
    theory/threePhase.ts     three-phase theory: envelopes, firing angle, periodic RL, overlap approx.
    theory/freewheel.ts      RL with a clamp path (freewheeling diode / semi-controlled leg), any α
    theory/controlled.ts     single-phase controlled RL (half-wave, center-tap, fully controlled bridge)
    overlap.ts               commutation overlap μ: measured vs the overlap relation, with assumptions
    formulaNotes.ts          concept + explanation per compared quantity
    compare.ts               simulation vs theory, tolerance, steady-state gating
  explanations/
    concise.ts               short WHY (5 steps), current-path card, state line
    rectifier.ts             WHY engine for every single-phase circuit (state + event explanations)
    threePhase.ts            three-phase WHY: highest/lowest phase, conducting pair, gates, faults
    freewheel.ts             freewheeling diode: mode, why Dfw is ON/OFF, freewheel intervals, step-through
    lens.ts                  Physics Lens stages built from the same explanation (10 for the freewheel circuit)
  inspect/                   Inspect mode: one component's values from the trace
  compare/                   Compare mode: two simulations on a declared basis, metrics, why/advice
  experiment/                before/after snapshots, measured differences, WHY per change, freewheel experiments
  reverse/                   reverse-engineering tasks (hidden circuit)
  learning/                  lessons (Phase 8), facts read from the simulation, cursor targets
  prediction/                sketch tasks and scoring (Phase 9); what-if questions
  challenges/                design challenges and evaluation (Phase 10)
  visualization/             scope renderer (overlay/grouped/separate), signals, channel presets, scales, events
  state/                     reducer, playback, stepping, mode logic (useModes)
  components/                Header, CircuitDiagram, ThreePhaseDiagram (+ circuit/symbols), AngleView,
                             ChannelBar, FreewheelPanel, CompareView, StepThrough, ui/Drawer,
                             panels/* (State, Why, Learn, Path, Inspect, Measurements, Theory, Events,
                             Firing, Overlap), compare/CompareLab, PhysicsLens, Scope, Transport,
                             EnergyPanel, ParameterPanel, MeasurementTable, EventPanels, modes/*
  styles/index.css           design tokens + layout
  styles/dcdc.css            platform bar + DC-DC module
  Platform.tsx               module bar (all ten modules); #module deep links
  converters/                generic switched-circuit engine (gate schedules, exact switching, trapezoidal +
                             backward-Euler restarts, shooting steady state), schedule, fourier (+ Bessel), expm;
                             dcdc/ (buck, boost, buck-boost: model, exact + textbook theory, measure, compare,
                             explain, learn; buck/ = aliases), pwm/ (modulator, analysis, content),
                             inverter/ (modulation incl. SVPWM, IGBT bridge model, analysis, content)
  lab/types.ts               the Topic interface every module implements
  converters/pwl.ts          PWL hybrid systems: simulatePwl (trapezoidal + events) and exactPwl (matrix exponential)
  converters/control|devices|drives|magnetics|ev|engineering/  model + simulation, independent theory, content
                             (state, WHY, compare, lessons, experiments, predictions)
  topics/                    dcdc, pwm, inverters, control, devices, drives, magnetics, ev, engineering — topic definitions
  components/lab/            LabShell (five modes, progressive disclosure), LabScope, ParamsPanel, Panels,
                             Analyze, Modes, SpectrumChart
  components/dcdc|pwm|inverter/  schematics (DC-DC, PWM block diagram, bridges + space-vector hexagon), DC-DC views
tests/                       Vitest suites (physics, theory, limits, three-phase, controlled, freewheel, compare, UI, modes)
scripts/smoke.mjs            Playwright end-to-end check (single-phase)
scripts/smoke3.mjs           Playwright end-to-end check (three-phase)
scripts/smoke-fw.mjs         Playwright end-to-end check (freewheeling diode)
scripts/smoke-ctl.mjs        Playwright end-to-end check (controlled rectifiers, μ, Compare)
scripts/smoke-dcdc.mjs       Playwright end-to-end check (platform + DC-DC converters)
scripts/smoke-inv.mjs        Playwright end-to-end check (PWM lab + inverters)
scripts/smoke-modules.mjs    Playwright end-to-end check (Control, Devices, Drives, Magnetics, EV, Engineering)
docs/simulation.md           the mathematical model (rectifiers)
docs/converters.md           switched-circuit engine + DC-DC: equations, steady state, theory, validation, limitations
docs/pwm-inverters.md        PWM lab and inverters: modulators, theory, validation, limitations
docs/modules.md              Control, Devices, Drives, Magnetics, EV, Engineering: models, theory, validation, limitations
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

Freewheeling-diode feature (phases 1–10): topology, switching, RL validation, current-path animation,
waveforms, WHY engine, energy view, with/without comparison, prediction/experiments, tests. ✅

Controlled single-phase rectifiers, single-phase freewheeling, measured commutation overlap and
Compare mode: ✅

Platform milestones, each validated before the next:

| Milestone | Status |
|---|---|
| Buck | ✅ |
| Boost | ✅ |
| Buck-boost | ✅ |
| PWM lab | ✅ |
| Single-phase inverter | ✅ |
| Three-phase inverter | ✅ |
| SPWM | ✅ |
| SVPWM | ✅ |
| Control (closed-loop buck, boost) | ✅ |
| Devices (MOSFET double-pulse test) | ✅ |
| Drives (DC motor chopper drive) | ✅ |
| Magnetics (gapped inductor, saturation) | ✅ |
| EV (drivetrain on a drive cycle) | ✅ |
| Engineering (losses and thermal) | ✅ |

Possible next steps:

- Drives: an induction or PMSM motor on the three-phase inverter, with field-oriented control.
- Magnetics: a transformer, and core loss.
- Devices: IGBT tail current and diode reverse recovery.
- EV: a battery model with SOC-dependent voltage.
- Bundle: code-splitting per module (the build is one 1 MB chunk).

Possible rectifier next steps: a back-EMF load (battery, DC motor), a closed-form theory for commutation
overlap (it is shown only as an approximation now), and twelve-pulse arrangements.
