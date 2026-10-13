# Switched circuits: engine, DC-DC converters

This document covers the shared engine used by every switched circuit after the rectifiers, and
the three DC-DC converters: **buck**, **boost** and **inverting buck-boost**. The PWM lab and the
inverters are in `docs/pwm-inverters.md`.

## 1. Architecture

| Piece | File |
|---|---|
| MNA netlist solver: R, L, C, sources, PWL diodes, SCRs, gated switch `S`, non-latching gated diode (IGBT) | `circuits/netlist.ts` |
| Generic switched-circuit engine: gate schedules, exact switching, shooting steady state | `converters/engine.ts` |
| Gate schedules (periodic edge lists, complementary pairs with dead time) | `converters/schedule.ts` |
| Exact Fourier integrals, Bessel J_n | `converters/fourier.ts` |
| Matrix exponential | `converters/expm.ts` |
| DC-DC family: model, theory, measurements, comparison, explanations, learning content | `converters/dcdc/*` (`converters/buck/*` are aliases) |
| Topic definitions the lab shell renders | `topics/dcdc.tsx`, `topics/pwm.tsx`, `topics/inverters.tsx` |
| Generic lab shell: parameters, schematic, scope, state, WHY, five modes, Analyze | `components/lab/*` |

**The rectifier path is unchanged.** The rectifier engine (`simulation/engine.ts`) calls the
netlist solver exactly as before:
- backward Euler (the solver's default);
- latching SCRs;
- no `S` elements.

All 426 rectifier tests and the four rectifier browser suites still pass.

**Every later topic is a `Topic`** (`lab/types.ts`). A topic supplies its physics:
- parameters;
- `simulate`, `measure` and `state`;
- WHY cards;
- a schematic;
- `compare` and the theory view;
- lessons, experiments and predictions.

The universal workspace shell (`workspace/TopicShell.tsx` around `workspace/WorkspaceShell.tsx`) supplies the same layout, modes and progressive
disclosure for all of them. It never computes a physical value.

## 2. The engine (`converters/engine.ts`)

A model (`CircuitModel`) resolves its parameters and builds a netlist whose controlled devices read
their gates from **schedules**: periodic, sorted edge lists. The engine then integrates.

**Breakpoints**
- Every gate edge is a breakpoint: a step never straddles one, even when the edge is off the time grid.
- Edges closer than 10⁻⁹·Δt (for example two SVPWM legs switching "together") are treated as simultaneous.

**Diode and IGBT states (assumed-state iteration)**
- Solve with the present combination.
- If the solution violates its own assumption, flip exactly the violating devices:
  - ON with reverse current → OFF;
  - an IGBT ON without its gate → OFF;
  - OFF with forward voltage above Vf and allowed to conduct → ON.
- Usually one or two solves suffice, even when several inverter legs switch at once.
- Only if the iteration cycles does it enumerate combinations, nearest first. This never happens in
  the validated runs.

**Switching instants**
- A transition inside a step is located by bisection on the self-consistency of the old state.
- A transition **forced** at a gate edge, for example when the inductor current must move to a diode
  NOW, switches at that instant without advancing the storage through the impossible circuit.

**Integrator: trapezoidal rule, with one backward-Euler step after every switching instant and gate edge**
- The trapezoidal rule is second order and has no numerical dissipation.
- Pure backward Euler dissipates ½·L·Δi² per step. In a buck the load pins the inductor current,
  so this is harmless there. In a boost or buck-boost the dissipated energy is drawn through the
  inductor and shifts its DC level by about 0.75 % at 200 steps per period.
- The backward-Euler step after a discontinuity prevents trapezoidal ringing.

**Steady state: the shooting method**
- Find x₀ with Φ(x₀) = x₀, where Φ integrates one steady-state period with exactly the displayed
  discretisation.
- Newton with a finite-difference Jacobian: one or two iterations for an affine period map, a few more
  in DCM. Period-by-period integration is the fallback.
- The periodicity residual is reported (typically below 10⁻¹⁰).
- The **start-up** view instead runs from rest for about five time constants.

**Event-aware quadrature** (`segmentAverage`, `runSegments`)
- Between samples: the trapezoid rule (the integrator's own quadrature).
- Where a switching event falls at the start of or inside an interval, the interval is split there.

## 3. DC-DC converters

```
BUCK         Vin+ ─Q1─ sw ─L─ out          D1: ground → sw       (step-down)
BOOST        Vin+ ─L─ sw ─D1→ out          Q1: sw → ground       (step-up)
BUCK-BOOST   Vin+ ─Q1─ sw ─L─ ground       D1: out → sw          (inverting: Vout < 0)
```
Every converter has C (behind its ESR) and R at the output. L has a series DCR. Q1 is the
PWM-gated switch `S`, and D1 is a PWL diode.

### 3.1 Exact theory (validates the solver)

The state is x = [iL, vC]. i_feed is the current the converter pushes into the output node:
`vout = k·(vC + ESR·i_feed)`, with `k = R/(R + ESR)`, and `C·dvC/dt = (R·i_feed − vC)/(R + ESR)`.

```
BUCK        ON:  L·diL/dt = Vin − (RonQ + DCR)·iL − vout          i_feed = iL
            OFF: L·diL/dt = −Vf − (RonD + DCR)·iL − vout          i_feed = iL
BOOST       ON:  L·diL/dt = Vin − (RonQ + DCR)·iL                 i_feed = 0
            OFF: L·diL/dt = Vin − Vf − (RonD + DCR)·iL − vout     i_feed = iL
BUCK-BOOST  ON:  L·diL/dt = Vin − (RonQ + DCR)·iL                 i_feed = 0
            OFF: L·diL/dt = vout − Vf − (RonD + DCR)·iL           i_feed = −iL
IDLE (DCM): iL = 0
```

Each interval is solved with the matrix exponential of the augmented system. The periodic steady
state is found as follows:
- **CCM:** the fixed point of the period map (a 2×2 linear solve).
- **DCM:** the diode-off instant is the exact zero of iL. The start voltage is found by bisection,
  bracketed around the textbook DCM value.
- Metrics are evaluated on 4000 points per interval of the exact solution.

### 3.2 Textbook relations (ideal, with their assumptions)

| | Buck | Boost | Buck-boost |
|---|---|---|---|
| CCM | Vout = D·Vin | Vin/(1 − D) | −D·Vin/(1 − D) |
| IL | Iout | Iout/(1 − D) | \|Iout\|/(1 − D) |
| ΔiL | Vout(1 − D)/(L·fs) | Vin·D/(L·fs) | Vin·D/(L·fs) |
| ΔVout | ΔiL/(8·C·fs) | Iout·D/(C·fs) | \|Iout\|·D/(C·fs) |
| Kcrit (CCM ⇔ K = 2L/(R·Ts) > Kcrit) | 1 − D | D(1 − D)² | (1 − D)² |
| DCM Vout/Vin | 2/(1 + √(1 + 4K/D²)) | (1 + √(1 + 4D²/K))/2 | −D/√K |

Each relation is shown only where its assumptions hold; otherwise the table says why it does not
apply:
- the boost ripple formula is not used where iL dips below Iout;
- an ESR invalidates the purely capacitive ripple formula;
- non-ideal devices invalidate the ideal laws.

An ESTIMATED Vout with device drops (first-order volt-second balance) is shown for real devices.

### 3.3 Measurements (SIMULATION)

All averages are over the steady-state window. Timing (D, fs, D2, D3) comes from the switching
events, and DCM is detected from the `il-zero` event.

| Quantity | How it is computed |
|---|---|
| Pin | Vin·avg(iQ) for the buck and buck-boost; Vin·avg(iL) for the boost |
| Losses | Q1, D1, DCR and ESR |
| Efficiency | η = Pout/(Pout + losses) |

### 3.4 Validation

**`tests/buck.test.ts` (55 tests)**
- **Physics:** KCL, L and C equations, gate following, the diode never conducting backwards.
- **Timing:** exact PWM edges off the grid, forced commutation.
- **Steady state:** the shooting steady state and the start-up both agree.
- **Exact theory:** agreement over 29 operating points.
- **Convergence** with Δt.
- **Textbook:** the CCM and DCM laws and the CCM/DCM boundary.
- **Explanations and content.**

**`tests/dcdc.test.ts` (78 tests): the same for the boost and the buck-boost**
- KCL at the switch node and the output.
- Polarity.
- 26 operating points each against the exact theory.
- Second-order convergence: the error falls ×4 or more when Δt halves.
- The ideal CCM laws within 0.2 %.
- DCM relations and the boundary.
- The ESTIMATED Vout within 1 %.
- Pin = Pout + losses.
- WHY, lessons, experiments and predictions for both converters.

**Simulation vs exact theory at 200 steps per period**
- Averages: about 10⁻⁴ relative.
- Ripples: below 0.1 %.

The tolerances (`TOL` in `converters/dcdc/compare.ts`) keep margin:

| Quantity | Tolerance |
|---|---|
| Averages | 0.2 % |
| Ripples | 3 % |
| Peaks | 1 % of the current scale |
| η | 0.2 pt |
| Timing | 0.5 % of Ts |

**`scripts/smoke-dcdc.mjs` (55 browser checks)** covers:
- the platform navigation;
- the buck in all five modes;
- the boost and buck-boost: schematic polarity, the freewheeling WHY, the exact-solution column all ✓,
  the textbook law, a lesson.

### 3.5 Limitations

- **Ideal switching.** No switching transitions or losses, no reverse recovery, no parasitic ringing
  (in DCM the switch node rests exactly at Vout, Vin or 0).
- **Linear components.** L and C are linear (no saturation, no ESL).
- **Open loop.** D is set directly.
- **Asynchronous converters only.** There is no synchronous rectifier.
- **Ideal source.** Vin has no source impedance.
