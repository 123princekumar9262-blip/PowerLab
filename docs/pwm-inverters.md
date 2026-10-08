# PWM lab and inverters: the model

## 1. PWM lab (`converters/pwm/*`, `topics/pwm.tsx`)

**The modulator.** A carrier c(t) ∈ [−1, 1] is compared with a reference r(t) ∈ [−1, 1], and
`g = (r > c)` is the gate command. The output stage turns g into a pulse train: unipolar 0…Vdc or
bipolar ±Vdc/2. The settings:

| Setting | Options |
|---|---|
| Carrier | Triangle (−1 at each period start, +1 in the middle), or sawtooth (trailing-edge PWM) |
| Reference | DC (D = (1 + r)/2), or a sine M·sin(ω1·t) with an integer frequency ratio mf = fc/f1 |
| Sampling | Natural; regular symmetric (sampled at each carrier peak, held peak to peak); regular asymmetric (sampled at every peak and valley) |
| Digital resolution | Optional N-bit counter (a sampled reference quantised to 2^N levels) |
| Dead time | Complementary gates GH and GL; each turns ON td after the command enables it |

**Simulation.** Every edge is an exact comparator crossing, located by bisection on each monotonic
piece of the carrier. State changes at carrier boundaries (a sawtooth reset, a new sample) are
edges too. From those edges:
- **Spectrum:** exact Fourier integrals of the resulting piecewise-constant pulse train.
- **RMS:** exact, from the same pulses.
- **vavg:** the exact moving average over one carrier period.

**Theory (independent closed forms)**

| Case | Result |
|---|---|
| DC reference | average D·Vdc (unipolar) or (2D − 1)·Vdc/2 (bipolar); harmonic h of fc: (2·Vdc/(hπ))·\|sin(hπD)\| |
| Sine-triangle, natural sampling (Holmes & Lipo) | (Vdc/2)·M·cos y + (2Vdc/π)·Σ (1/m)·J_n(mπM/2)·sin((m+n)π/2)·cos(m·x + n·y) |
| Regular symmetric sampling | (2Vdc/π)·(1/q)·J_n(qπM/2)·sin((q+n)π/2) with q = m + n/mf (m = 0: n ≥ 1); the sample leads the pulse centre by Tc/2 |
| Regular asymmetric sampling | (2Vdc/π)·(1/q)·J_n(qπM/2)·sin((m+n)π/2); the effective sample leads by Tc/4 |

In the natural-sampling series x = ωc·t and y = ω0·t + θ0.

Every (m, n) term at the same frequency is added as a phasor, so overlapping sidebands are exact
too. No closed form is given for:
- a sawtooth carrier with a sine reference;
- digital resolution;
- overmodulation.

In those cases the table shows the simulation only.

**How the regular-sampling forms were settled.** The sin((q+n)π/2) and Tc/4 forms were verified
numerically against the simulation's phasors, not assumed. The first form I remembered was the
asymmetric one. It disagreed with the symmetric simulation by exactly cos(π/(2mf)), which pointed
to the correct symmetric form.

**Validation (`tests/pwm.test.ts`, 48 tests)**
- The Bessel and Fourier helpers.
- Every edge is a crossing to 10⁻⁹.
- Duty, average and RMS are exact for both carriers and every sampling.
- Quantisation, dead time and overmodulation behave as expected.
- In 33 configurations (natural, symmetric and asymmetric sampling; M = 0.3, 0.8, 1; mf = 9, 15, 21;
  DC references), **every harmonic** matches its closed form within 10⁻⁶·Vdc. Measured agreement is
  better than 10⁻⁹.
- Content checks.

## 2. Inverters (`converters/inverter/*`, `topics/inverters.tsx`)

**The circuit (`inverter/model.ts`)**
- Every switch is an IGBT: a gated, non-latching device that conducts forward only while gated,
  with its own antiparallel diode. Which of the two carries the current is decided by the solver.
- The bridges:

| Bridge | Arrangement |
|---|---|
| Half bridge | Split DC source; load from leg A to the midpoint |
| Full bridge (H) | Legs A (S1/S2) and B (S3/S4); load between them |
| Three-phase | Legs A, B, C (S1/S4, S3/S6, S5/S2, textbook numbering); balanced star load (R + L per phase) with a floating neutral |

- Leg nodes have 1 MΩ bleed resistors (voltage sensing). They keep a node defined when every device
  of its leg is OFF with zero current, and carry under 10⁻⁴ of the load current.
- Dead time comes from complementary gate pairs. The voltage during it follows from the diodes.

**Modulators (`inverter/modulation.ts`).** Each gives one ON/OFF command per leg over a fundamental
cycle.

| Modulator | Commands |
|---|---|
| Square wave | Half/full bridge |
| Quasi-square | Full bridge: vAB = +Vdc on (α, 180° − α), −Vdc on (180° + α, 360° − α), 0 between |
| Six-step | 180° conduction, legs shifted 120° |
| SPWM | Bipolar (leg B = not A), unipolar (leg B compares −r), three-phase (references 120° apart); natural or regular sampling; one shared triangle carrier |
| SVPWM | Reference sampled once per switching period Ts; sector k; dwell times below; seven-segment sequence 0-1-2-7-2-1-0, each leg ON for T1·b1 + T2·b2 + T0/2, centred; overmodulation scales T1 and T2 to fill Ts |

The SVPWM dwell times are:
```
T1 = √3·Ts·|Vref|/Vdc·sin(60° − θ),  T2 = √3·Ts·|Vref|/Vdc·sin θ,  T0 = Ts − T1 − T2
```

**Theory (`inverter/analysis.ts`)**, independent of the circuit solver:
1. **Ideal output voltage** from the gate commands (ideal switches, no dead time). It is a
   piecewise-constant waveform, so its Fourier series is exact. Closed forms:

   | Modulation | Fundamental and harmonics |
   |---|---|
   | Square | 4Vdc/(hπ) (half bridge: 2Vdc/(hπ)) |
   | Quasi-square | (4Vdc/(hπ))·\|cos hα\| |
   | Six-step line voltage | (2√3·Vdc/π)/h for h = 6k ± 1 |
   | SPWM | The leg Bessel phasors with each leg's reference phase, differenced (bipolar, unipolar, three-phase line voltage) |
   | SVPWM | (√3/2)·m·Vdc as the textbook value, linear to m = 2/√3 |

2. **Exact load current.** On each segment `L·di/dt + R·i = v`, so `i = v/R + (i₀ − v/R)·e^(−t/τ)`.
   - The periodic fixed point is i(0) = c/(1 − e^(−T/τ)).
   - RMS is a closed-form integral.
   - Current harmonics are I_h = V_h/|R + j·h·ω·L|.
   - Diode conduction is where the leg current opposes the commanded switch. Its zero crossing
     within a segment is solved exactly.
   - Balanced star load: van = vaN − (vaN + vbN + vcN)/3.

**With real devices or dead time,** the comparison rows say that the ideal theory leaves those
effects out, instead of failing a tolerance.

**Measurements (SIMULATION)**
- V1, Vrms and THD of vo or vab.
- I1, Irms, Ipeak and THD of io or ia.
- Load power and DC power, and the energy returned to the DC source.
- Per-device conduction fraction, from the exact events, and average current.
- The neutral voltage.

**Performance.**
- The assumed-state iteration turns a three-phase PWM run into about 40 000 solves instead of
  hundreds of thousands.
- At the default settings each topic simulates in tens to a few hundred milliseconds.

**Validation (`tests/inverter.test.ts`, 37 tests)**
- **Device behaviour:**
  - an IGBT conducts only while gated and only forward;
  - no leg ever shoots through;
  - KCL;
  - an R load never makes a diode conduct, while an R-L load does;
  - the shooting steady state and the start-up both work.
- **Dead time:** it changes the voltage only where the current is small or reverses. A
  square wave with a lagging current is unaffected. This is physics, and the test asserts it.
- **Theory agreement:** 15 configurations across square, quasi-square (α = 30°, 18°), half bridge,
  R load, large L, six-step, SPWM (bipolar, unipolar, three-phase, regular sampling) and SVPWM
  (m = 0.9 and 1.1) all agree within tolerance:

  | Quantity | Tolerance |
  |---|---|
  | V1, Vrms, voltage harmonics | 0.2 % |
  | Current | 0.3 % |
  | Power | 0.5 % |
  | Diode fraction | 1 pt |

  Typical measured agreement is 10⁻⁴.
- **Closed forms.**
- **Harmonic structure:**
  - quasi-square at α = 30° has no 3rd harmonic;
  - six-step has only 6k ± 1;
  - unipolar SPWM cancels the mf group.
- **The SPWM Bessel series** against every output harmonic.
- **SVPWM:**
  - the dwell times reproduce the reference vector in every period (volt-second balance, to 10⁻⁹);
  - the leg duties equal min-max zero-sequence injection (an independent derivation, to 10⁻¹²);
  - it stays linear to 2/√3 where SPWM saturates.
- **WHY, lessons, experiments and predictions.**
- **Speed** at the defaults.

**`scripts/smoke-inv.mjs` (33 browser checks)** covers:
- the PWM lab: explanation, Bessel agreement, spectrum, experiment, lesson;
- every inverter topic: diode freewheeling and its WHY, the inspector, the exact-solution column
  all ✓, spectra, the SVPWM hexagon, a prediction.

## 3. Limitations

- **Ideal switching.** No switching transients or losses, no reverse recovery. The IGBT and diode are
  piecewise-linear (Vce or Vf plus Ron).
- **Linear loads only.** R or R-L (no back-EMF or motor model; that is the Drives module). The
  three-phase load is balanced and star-connected.
- **Open loop.** m, mf and α are set directly.
- **Ideal DC link.** The source is ideal (no DC-link capacitor dynamics).
- **Limited closed forms.** SVPWM's spectrum has no closed form here: the ideal-switch Fourier series
  of the commanded waveform is used. The PWM lab has no closed form for a sawtooth carrier with a
  sine reference, for digital resolution, or for overmodulation.
