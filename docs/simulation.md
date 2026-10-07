# Simulation model — Phase 1: half-wave rectifier, R load

This document is the mathematical reference for what the engine computes. Every
number on screen — waveforms, circuit state, explanations, measurements — comes
from the model below. Nothing is drawn from an "expected waveform".

## 1. Circuit

```
            D1
   ┌──────┤>|──────┐ +
   │ +    A    K   │
  (~) vin          R   vout
   │ −             │
   └───────────────┘ −   (return, 0 V reference)
```

A single series loop: source → D1 (anode → cathode) → R → back to the source.

## 2. Source

```
vin(t) = Vm · sin(ωt + φ)
Vm = √2 · Vrms          (peak of a sinusoid with RMS value Vrms)
ω  = 2πf                (angular frequency, rad/s)
T  = 1/f                (period)
θ  = ωt + φ             (electrical angle, shown on screen wrapped to 0–360°)
```

Defaults: Vrms = 12 V (a transformer secondary, not mains), f = 50 Hz, φ = 0°.

## 3. Diode model

Piecewise-linear ("constant voltage drop + on-resistance"):

| State | Constitutive law             | Validity condition |
|-------|------------------------------|--------------------|
| ON    | vD = Vf + Ron · iD           | iD > 0             |
| OFF   | iD = 0                       | vD ≤ Vf            |

- **Ideal diode**: Vf = 0, Ron = 0 (a perfect switch).
- **Real diode**: default Vf = 0.7 V (silicon), Ron = 0 Ω (adjustable).

`vD` is always anode minus cathode.

## 4. How the diode state is decided (assumed-state method)

Seen from the diode terminals, the rest of the circuit is a Thévenin source
`vth = vin` in series with `Rth = R`. At every instant the solver
(`src/solvers/diode.ts`) tests both hypotheses:

1. **Assume ON.** KVL around the loop: `vin = R·i + Vf + Ron·i`, so
   `i = (vin − Vf) / (R + Ron)`. The hypothesis holds only if `i > 0`
   (a diode cannot conduct backwards).
2. **Assume OFF.** `i = 0`, so there is no drop across R and the diode sees
   the full source: `vD = vin`. The hypothesis holds only if `vD ≤ Vf`.

Exactly one hypothesis is self-consistent. At the boundary `vin = Vf` both give
`i = 0`, and the solver reports OFF.

The resulting **bias classification** drives the explanations:

| Condition            | Bias                      | State |
|----------------------|---------------------------|-------|
| vin > Vf             | forward-conducting        | ON    |
| 0 < vin ≤ Vf         | forward-below-threshold   | OFF (real-diode "dead zone") |
| vin < 0              | reverse                   | OFF   |
| vin = 0              | zero                      | OFF   |

The state comes from the circuit conditions, not from the sign of the source.
A unit test proves this by shifting φ by 90°, which makes the diode start ON at t = 0.

## 5. Circuit equations

Once the diode state is known:

```
io   = iD                         (KCL: one series loop → one current)
vout = R · io                     (Ohm's law across the load)
vD   = vin − vout                 (KVL; equals Vf + Ron·io when ON, vin when OFF)
```

The tests check all three at every sample, together with `io ≥ 0`.

## 6. Time simulation

`src/simulation/engine.ts` steps a `CircuitModel` through time:

```
Δt   = duration / N          (N steps fitted so the last sample lands exactly on the duration)
x₀   = model.initialState()
for k = 1 … N:
    (solutionₖ, xₖ) = model.step(xₖ₋₁, tₖ₋₁, Δt)
```

`x` is the energy-storage state vector. The R load has none (`{}`), so each
instant is solved algebraically. Later phases put `iL` / `vC` here and
integrate them inside `step`.

- **Auto timestep**: Δt = T / 2000 (10 µs at 50 Hz).
- **Manual timestep**: user-set, but tightened to at least 16 samples/cycle and
  capped at 400 000 samples total. Every adjustment is reported on screen.
- **Simulation vs rendering**: the scope draws a min/max envelope per pixel
  column when there are more samples than pixels. Only the drawing is decimated;
  measurements always use every sample.

### Event detection

Between two samples the engine watches for:

| Event                                  | Detection                    | Refinement |
|----------------------------------------|------------------------------|------------|
| Diode ON / OFF                         | state differs between samples | bisection on `model.step` from the previous state |
| Current starts / stops                 | `|io|` crosses 1 fA           | bisection on `model.step` |
| Vin zero crossing (rising / falling)   | sign change of vin            | bisection on `vin(t)` |
| Vin positive / negative peak           | local extremum of samples     | golden-section search on `vin(t)` |

Bisection runs 60 iterations, which brackets the event to machine precision. Event times
are therefore exact rather than quantised to Δt (e.g. real-diode turn-on is
found at θ₁ = asin(Vf/Vm) to ~10⁻¹² rad).

## 7. Measurements (from the simulated data)

All measurements use the **last full source cycle** `[tend − T, tend]`:

```
X_avg = (1/T) ∫ x dt          (trapezoidal rule, linear interpolation at window edges)
X_rms = √( (1/T) ∫ x² dt )
X_pk  = max over the window's samples
PIV   = max(−vD)
γ     = 360° · (time D1 is ON in the window) / T      (using refined event times)
f_ripple = (pulses − 1) / (t_last pulse − t_first pulse) (from current-start events)
P     = (1/T) ∫ vout · io dt
```

## 8. Theory (closed form) used for comparison

With θ₁ = asin(Vf/Vm), θ₂ = π − θ₁ and k = R/(R + Ron), the diode conducts for
θ₁ < θ < θ₂, where `vout = k·(Vm·sinθ − Vf)`:

```
Vdc     = (k/2π) · [ 2·Vm·cosθ₁ − Vf·(π − 2θ₁) ]
Vo,rms² = (k²/2π) · [ Vm²·((π − 2θ₁)/2 + sin2θ₁/2) − 4·Vm·Vf·cosθ₁ + Vf²·(π − 2θ₁) ]
Vo,pk   = k·(Vm − Vf)
Idc = Vdc/R,   Io,rms = Vo,rms/R,   Io,pk = Vo,pk/R
γ   = π − 2θ₁          (180° for the ideal diode)
PIV = Vm,   f_ripple = f
```

For the ideal diode these reduce to the textbook results `Vdc = Vm/π` and
`Vo,rms = Vm/2`. If Vf ≥ Vm the diode never conducts and every output quantity is 0.

**Tolerance**: a row is flagged ⚠ when |simulated − theory| / |theory| > 1 %. With
the auto timestep the observed error is ~10⁻⁶. Trapezoidal integration over a whole
period of a periodic signal is very accurate, so the flag mainly fires when a coarse
grid misses the waveform's crest. For example, 16 samples/cycle with φ = 11.25° gives a
peak error of 1 − cos(11.25°) ≈ 1.9 %. The test suite reproduces this case.

## 9. Validation

`npm test` runs the suite in `tests/`:

- conduction in the positive half-cycle, blocking in the negative half-cycle
- Vout = 0, Io = Id = 0 whenever OFF; Vout = Vin (ideal) / Vin − Vf (real) when ON
- the real-diode dead zone, θ₁ / θ₂ switching angles, and the Ron drop
- KVL / KCL / Ohm / io ≥ 0 at every sample, plus periodicity
- agreement with theory to < 10⁻⁴ for five parameter sets, and the ⚠ flag on a coarse grid
- R changes the current (∝ 1/R) but not the ON/OFF pattern; f sets the period; Vrms scales the output
- limiting cases: R = 1 mΩ, R = 10 MΩ, Vf = 0 ≡ ideal, Vf ≥ Vm, frequency/amplitude extremes
- invalid inputs (NaN, ∞, 0 Hz, negative R, undefined, absurd Δt): clamped, reported, no NaN anywhere
- the WHY engine (state, trend, headline), event landing, and step navigation

`npm run smoke` drives the real UI in a browser (see README).
