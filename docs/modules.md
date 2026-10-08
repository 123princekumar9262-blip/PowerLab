# Control, Devices, Drives, Magnetics, EV, Engineering

These six modules complete the top navigation. Each one follows the platform rules:

- **SIMULATION** is the single source of truth. Every waveform, measurement, WHY card, lesson,
  experiment verdict and prediction answer is read from a time-domain run.
- **THEORY** is computed independently, by a different method, and compared in **Analyze** (tolerance
  0.5 %).
- **Textbook** formulas appear beside the theory, with their assumptions stated.
- Where a model leaves something out (core loss, constant efficiency, synthetic cycles), the page
  says so.

All six use the generic `Topic` interface (`src/lab/types.ts`) and `LabShell`, with the five modes
(Explore, Learn, Experiment, Predict, Analyze) and three information levels.

## The piecewise-linear (PWL) toolkit — `src/converters/pwl.ts`

Devices, Drives, Magnetics and Engineering are **hybrid systems**. In each *mode* (diode on/off, channel
region, core saturated…) the equations are linear, `dx/dt = A·x + b`. The inputs (gate edges, load
steps) are piecewise constant between known *breakpoints*.

| | `simulatePwl` (SIMULATION) | `exactPwl` (THEORY) |
|---|---|---|
| Integration | trapezoidal rule, fixed step; never straddles an input breakpoint | matrix exponential `e^(A·h)` per mode (`expm.ts`, augmented for `b`) |
| After a jump | backward-Euler restart **only where the mode is stiff for that step** (‖A‖∞·h > 2) | — |
| Mode changes | bisection on the step | scan with composed sub-steps, then bisection on the exact flow by halving |
| Output | samples + the state at every breakpoint and mode change ("knots") | the state at requested times + the events |

Both solvers use the same equations and the same mode rules, and every mode test uses the
*segment's* inputs. An input jump can change the mode by itself, so it is tested at the start of each
segment. They differ only in how they solve.

The exact solver caches exponentials by (A, b, step length to 12 digits). Its scan and its bisection
reuse the same step lengths, so periodic inputs hit the cache: a 1 000-period discontinuous-conduction
start-up takes ≈ 0.3 s.

## Control — `src/converters/control/`

Closed-loop buck and boost converters with a digital PID: sampled once per period, derivative on
the error, anti-windup clamping.

- **Simulation:** the switching circuit on the netlist engine. The controller sets each period's
  duty (`periodic` hook).
- **Theory:**
  - the averaged model with the same controller, advanced exactly per period;
  - the discrete loop gain `Gc(z)·Gvd·ZOH`, giving crossover, phase margin and gain margin;
  - exact small-signal stability: the spectral radius of the linearised period map, at the start
    and end operating points.
- **Auto-tuning:** the compensator zeros cancel the LC resonance; Ki sets the target crossover.
- **Validation:** overshoot, rise, settling, load dip, recovery and final duty agree with the averaged
  model. Rows are marked "expected" when the averaged model does not apply (DCM, fc > fs/20,
  unstable loops). Tests: `tests/control.test.ts` (19).

## Devices — `src/converters/devices/`

A MOSFET double-pulse test.

- **Circuit:** gate driver, Rg, Cgs, Cgd, Cds; channel regions cut / saturation / ohmic; a clamped
  inductive load I0 and a freewheeling diode.
- **Theory:**
  - the exact PWL solution;
  - the textbook phase formulas (delay, current rise, Miller plateau, ohmic). The textbook
    deviations are explained: the channel also carries the Cgd current, and Cds is ignored.
- **Validation:** nine cases; the nine phase times and energies agree with the exact solution to
  about five significant digits. Tests: `tests/devices.test.ts` (18).

## Drives — `src/converters/drives/`

A DC motor (Ra, La, k, J, B, constant load torque TL) fed by a one-quadrant (Q + freewheeling diode)
or two-quadrant (half-bridge) PWM chopper.

```
La·dia/dt = va − Ra·ia − k·ω        J·dω/dt = k·ia − B·ω − TL
va = Vdc (gate on) / 0 (gate off) / k·ω (1Q, zero current: the diode blocks)
```

- **Views:**
  - **Start-up from rest.** The window is 8/σ, where σ is the slowest averaged decay rate. It is
    run again over twice the window if the drive has not settled.
  - Optional soft start, load step or duty step.
  - **Periodic steady state**, found by Newton shooting.
- **Theory:**
  1. **Exact PWL:** period means from ∫ia and ∫ω carried as extra states; t90 by bisection on the
     exact flow; the periodic state by Newton on the exact one-period map.
  2. **Averaged model (textbook):**
     - ω = (d·Vdc − Ra·TL/k)/(k + Ra·B/k) and ΔI ≈ Vdc·d·(1 − d)/(La·fs);
     - the start-up advanced exactly per period;
     - it cannot represent discontinuous conduction, so it is shown as N/A there.
- **Physics checked:**
  - In continuous conduction the period means satisfy the averaged equations exactly.
  - With 1Q at light load, the current stops and the speed exceeds d·Vdc/k.
  - The energy balance closes: supply = rotor + Ra + load + friction + La, to < 0.1 %.
  - Only 2Q brakes and regenerates.
  - The load-step droop is Ra·ΔTL/(k² + Ra·B).
- **Validation:** 12 cases agree with the exact solution to about 1e-9 for speed and 1e-5 for ripple.
  Tests: `tests/drives.test.ts` (22).

## Magnetics — `src/converters/magnetics/`

A gapped-core winding on a ±V square-wave bridge (duty d). The core has a piecewise-linear B–H curve
(μr up to Bsat, μsat beyond), and there is a winding resistance R.

```
dλ/dt = v − R·i,  λ = N·B·Ae,   N·i = Hcore·le + B·lg/μ0
L1 = N²·μ0·Ae/(lg + le/μr)   (unsaturated),   L2 = N²·μ0·Ae/(lg + le/μsat)   (saturated)
```

- i(λ) is continuous and piecewise linear. The modes are 'lin', 'sat+' and 'sat−'.
- **Views:** the periodic steady state, and the start-up from zero flux (flux doubling, inrush).
- **Theory:**
  - **Exact PWL:** ∫i and ∫λ are carried as states; the time saturated comes from the exact region
    changes.
  - **Textbook:** L1; ΔB = V·d·T/(N·Ae); Idc = (2d − 1)·V/R; Bpk = L·|Idc|/(N·Ae) + ΔB/2; first
    saturation at N·Ae·Bsat/V. These are N/A once the core saturates.
- **Physics checked:**
  - Ampère's law on both sides of saturation.
  - Δλ/Δi = L1 exactly while linear.
  - The mean current is (2d − 1)·V/R exactly in the steady state, saturated or not.
  - A 2 % duty error, or 60 % of the frequency, saturates the core.
  - The start-up inrush is > 10× the running peak; at half the voltage it does not saturate.
- **Validation:** 10 cases agree with the exact solution to < 1e-4. Tests:
  `tests/magnetics.test.ts` (17).
- **Not modelled:** hysteresis and eddy-current (core) loss. The page says so.

## EV — `src/converters/ev/`

The longitudinal dynamics of a car on a drive cycle:

```
m·dv/dt = F − ½·ρ·Cd·A·v² − Crr·m·g·cos θ − m·g·sin θ
F ≤ min(Tmax·G/r, Pmax/v),   regen ≥ −min(Tmax·G/r, Pregen/v)   (friction brakes take the rest)
Pbatt = F·v/η or F·v·η, + Paux = (Voc − Rb·I)·I
```

The driver uses exact feed-forward (m·a_ref + road load) plus `Kp·m·(v_ref − v)`.

- **Simulation:** classical RK4 at 20 ms, on [v, x, terminal energy, cell energy, regen, brake,
  drivetrain loss, charge]. Every cycle vertex is a step boundary.
- **Theory:**
  1. **Cycle:** the reference speed is piecewise linear, so the wheel power is a cubic per segment.
     Every kink (motoring/braking, regen limit, torque/power corner) is located by bisection. Each
     smooth piece is integrated by 16-point Gauss–Legendre.
  2. **Acceleration:** `t(v) = ∫ m·dv/(F(v) − road load)` by Gauss–Legendre, split at the base speed.
     Top speed is found by bisection.
  3. **Textbook:**
     - ideal regeneration, with no limit and no battery resistance;
     - constant-power acceleration, `m·v²/(2·Pmax)`. It is shown to be too optimistic.
- **Validation:**
  - Energies agree to about 1e-13 and the 0–100 km/h time to 1e-5.
  - A motor too weak for the cycle is reported as an *expected* difference, never as a silent pass.
  - Tests: `tests/ev.test.ts` (18).
- **Simplifications (labelled):** constant drivetrain efficiency and constant open-circuit voltage.
  The cycles are **synthetic** piecewise-linear profiles shaped like ECE-15 and a highway run. They
  are not the official ECE/WLTP data.

## Engineering — `src/converters/engineering/`

The losses and temperature of a power switch.

```
P = D·I²·Ron25·(1 + α·(Tj − 25)) + fs·½·Vdc·I·tsw·(1 + κ·(Tj − 25)) = a + b·(Tj − 25)
Foster: Ci·dθi/dt = P − θi/Ri,  Tj = Ta + Σθi   (three junction–case stages + a heatsink stage)
```

Because P is affine in Tj, the system is linear: piecewise in time for a pulsed load, and solved
by the PWL toolkit.

- **Views:** the periodic steady state (one affine Newton step on the one-cycle map), and heating
  from ambient.
- **Theory:**
  - **Exact:** the matrix exponential, with ∫Σθ and ∫(load on)·Σθ carried as states for the mean
    temperature and mean loss.
  - **Runaway:** the spectral radius of the one-cycle map (≥ 1 ⇔ no stable periodic state).
    Thermal runaway is predicted exactly when b·Rth ≥ 1. The Steady view then shows the heating from
    ambient instead of an unstable fixed point.
  - **Textbook:** Tj = Ta + P25·Rth with no feedback. For a constant load, the self-consistent
    formula is exact. For pulses, the datasheet estimate Ta + δ·P·Rth + (1 − δ)·P·Zth(ton).
- **Physics checked:**
  - Without temperature dependence, Tj = Ta + P·Rth exactly.
  - With feedback, the self-consistent formula is exact.
  - The heatsink barely moves while the junction swings.
  - Shorter pulses shrink ΔTj as Zth(ton) does — not tenfold for tenfold shorter pulses, because the
    millisecond stages still swing.
  - The start-up converges to the periodic state.
- **Validation:** 10 cases agree with the exact solution to about 1e-6 K (relative to the temperature
  rise). Tests: `tests/engineering.test.ts` (19).
- **Caveat:** the Foster stages are a datasheet curve fit. Only Tj is physical; the heatsink stage is
  approximate. Lifetime is discussed qualitatively (Coffin–Manson ∝ ΔTj⁻⁵ is labelled an ESTIMATE),
  never as a number.

## Browser checks

`npm run smoke-modules` (dev server on port 5199) drives Edge through Playwright. It runs 87 checks
over the six modules:

- the route;
- the circuit and the state card;
- the WHY panel;
- the side panel (Bode, B–i, Zth, energy);
- **every Analyze row ✓ against the exact theory**;
- one experiment confirmed by the simulation;
- one lesson and one prediction.

Specifics: 2Q braking, magnetics start-up and the EV 0–100 run. It also confirms the rectifier lab is
unchanged and that there are no console errors.
