# Simulation model

This is the mathematical reference for what the engine computes. Every number on
screen comes from the model below: waveforms, circuit highlighting, explanations,
lesson text, challenge checks and measurements. No waveform is drawn from an
"expected" shape.

## 1. Circuits

Three rectifiers × four loads = 12 circuits, all built from one netlist engine
(`src/circuits/rectifier.ts`).

| Rectifier | Diodes | Source | Path drop |
|---|---|---|---|
| Half-wave | D1 | vin between source + and the return | Vf (+ Ron·i) |
| Center-tap | D1 (upper), D2 (lower) | two half-windings, +vin and −vin vs the center tap | Vf |
| Bridge | D1 a→p, D2 b→p, D3 n→a, D4 n→b | vin between a and b | 2·Vf (diagonal pair) |

| Load | Elements between the + and − outputs | `vout` is |
|---|---|---|
| R | R | the voltage across R |
| RL | L in series with R | the voltage across L + R (it can go negative) |
| RC | C in parallel with R (capacitor-input filter) | vC |
| RLC | series L, then C ∥ R (choke-input / LC filter) | vC (the rectifier output is `vrect`) |

Source: `vin(t) = Vm·sin(ωt + φ)` with `Vm = √2·Vrms` and `ω = 2πf`. The defaults are
12 V RMS (a transformer secondary, not mains) and 50 Hz.

## 2. Diode model

Piecewise linear: **ON** means `vAK = Vf + Ron·i` with `i > 0`; **OFF** means `i = 0` with `vAK ≤ Vf`.
The ideal diode is `Vf = 0, Ron = 0`. Defaults: Vf = 0.7 V, Ron = 0.

## 3. Solving one instant: assumed-state method over the diode network

For a diode combination (each diode assumed ON or OFF), the circuit is linear. It is solved by
**modified nodal analysis** (`src/circuits/netlist.ts`). The unknowns are the node voltages plus a
branch current for each source, inductor, capacitor and ON diode:

```
source       va − vb = V(t+h)
ON diode     va − vb − Ron·i = Vf
OFF diode    (open circuit)
inductor     i − (h/L)·(va − vb) = iL(t)      backward Euler of L·di/dt = v
capacitor    (va − vb) − (h/C)·i = vC(t)      backward Euler of C·dv/dt = i
resistor     i = (va − vb)/R                  (conductance stamp)
```

A combination is **self-consistent** if every ON diode has `i > 0` and every OFF diode has
`v ≤ Vf`. The model tries combinations nearest to the present one first (fewest flips) and
keeps the first consistent one. With one diode this reduces exactly to the Phase 1 test
("assume ON → is i > 0? assume OFF → is vD ≤ Vf?"). Physically impossible combinations,
such as all four ideal bridge diodes ON while vin ≠ 0, give a singular matrix and are rejected.

**Floating bridge.** With all four bridge diodes OFF, the AC source is disconnected and its
potential is undefined. Kirchhoff's current law at node a is then redundant and is replaced
by the constraint `va + vb = vp + vn`, which carries no current. Each blocking diode therefore
takes its share, as in a real bridge. No artificial "gmin" conductances are used: an earlier
version with 1 pS references let single bridge diodes appear ON with about 10⁻¹⁷ A, and was removed.

**Why backward Euler.** It is L-stable: a diode switching an inductor or capacitor never
rings numerically. The trapezoidal rule does ring, for example when a capacitor sits directly
across a voltage source. Its first-order error at Δt = T/2000 is ≲ 0.3 %, which the theory
comparison measures.

## 4. Time stepping with exact switching instants

`src/simulation/engine.ts`:

```
for each step [t₀, t₁]:
  solve at t₁ from the state at t₀ (consistent combination, preferring the present one)
  if the combination changed:
     bisect for tₛ, the first instant the OLD combination is inconsistent
     advance the OLD circuit exactly to tₛ (iL, vC stay continuous)
     record events at tₛ; probe a tiny step to find the NEW combination
     continue from tₛ to t₁ with the new circuit
```

Stepping exactly to the switching instant is what makes, for example, an inductor's current
reach zero precisely when its diode turns off (the extinction angle).
Numerical guards:

- The switching search has a floor of 10⁻⁹·Δt. As h → 0 an inductor becomes a pure current
  source and its voltage is numerically undetermined.
- A switch within that floor of a sample is recorded on the sample.
- With every diode open, the inductor current is pinned to exactly 0.

Events: diode ON/OFF, current start/stop (rectifier begins or stops delivering), vin zero
crossings and peaks (refined on the analytic source), and output crests and valleys (loads with storage).

Auto timestep: Δt = T/2000. A manual timestep is clamped to at least 16 samples/cycle
and at most 400 000 samples. Every adjustment is reported on screen. The scope draws a
min/max envelope per pixel column: only the drawing is decimated, never the data.

## 5. Measurements (from the simulated waveforms)

All values are taken over the **last full cycle**. Steady state is declared when Vdc changes by
< 0.1 % between the last two cycles; until then, steady-state theory rows are not compared.

```
Vdc = (1/T)∫vout dt     Vrms = √((1/T)∫vout² dt)     ripple = max − min
RF  = √(Vrms² − Vdc²)/Vdc       η = P_R / P_source
γ, θon, β    from the refined D1 ON/OFF event times
f_ripple     = (output crests per cycle) × f   (plateau-aware: a crest may span two equal samples)
PIV          = max over all diodes of −vD
```

## 6. Theory: an independent closed-form derivation

`src/measurements/theory/index.ts` writes each steady-state waveform as an **analytic function
of θ** (piecewise, with transcendental angles found by root finding). It then evaluates
averages and RMS values by quadrature of those formulas. It never calls the simulator.

Notation: `n` = pulses per cycle; `Vft`, `Ront` = drop and resistance in the conduction path
(×2 for a bridge); `θ₁ = asin(Vft/Vm)`; `k = R/(R + Ront)`.

**R load**
```
Vdc = n·k/(2π)·[2Vm·cosθ₁ − Vft(π − 2θ₁)]      (ideal: Vm/π, 2Vm/π)
γ = π − 2θ₁ ;  PIV: Vm (half-wave), Vm + Vo,pk (center-tap), Vo,pk + Vf + Ron·Ipk (bridge)
```

**RL load** (Z = √(R² + (ωL)²), φ = atan(ωL/R), ωτ = ωL/R)
```
i(θ) = (Vm/Z)·sin(θ − φ) − Vft/R + A·e^(−(θ−θ₁)/ωτ),   A chosen so i(θ₁) = 0
β: first root of i(β) = 0 (the extinction angle)        Vdc = R·Idc  (avg vL = 0)
full-wave, continuous (no root before π):
i(θ) = (Vm/Z)·sin(θ − φ) − Vft/R + B·e^(−θ/ωτ),   B = 2(Vm/Z)·sinφ / (1 − e^(−π/ωτ))
Idc = (2Vm/π − Vft)/(R + Ront)
```

**RC load** (exact for Ron = 0)
```
charging:  vo = |vin| − Vft,  iD = ωC·Vm·cosθ + (Vm·sinθ − Vft)/R
turn-off:  ωRC·cosθ + sinθ = Vft/Vm           (root in (π/2, π))
hold-up:   vo = vo(θoff)·e^(−(θ−θoff)/ωRC)
turn-on:   Vm·|sinθ| − Vft = vo(θ)             (next pulse)
```
The textbook approximations `ΔV ≈ Vpk/(n·f·R·C)` and `Vdc ≈ Vpk − ΔV/2` are shown as "approx." rows.

**RLC (LC filter).** In full-wave continuous mode, `Vdc = 2Vm/π − Vft − Ront·Idc` exactly (avg vL = 0,
avg iC = 0). The critical inductance `Lc ≈ R/(3ω)` and the ripple from the 2nd harmonic are approximations.
Half-wave or discontinuous operation has no closed form, and the table says so.

## 7. Energy (Phase 6)

`wl = ½·L·iL²`, `wc = ½·C·vC²`, `ps = Σ V·i_out` (sources), `pload = R·io²`, `pd = Σ vD·iD`.
Because the solved network satisfies KCL and KVL at every instant, Tellegen's theorem makes
the signed element powers sum to zero. The Energy view shows this live (Σp = 0 ✓). Over a
steady cycle the tests also check `P_source = P_R + P_diodes + ΔW/T` to 0.5 %.

## 8. Validation

`npm test` runs 287 tests:

- **Physics.** Conduction and blocking, the real-diode dead zone, KVL/KCL/Ohm at every sample,
  periodicity, bridge diode pairing, the symmetric blocking split, PIV for each topology, the RL hold-on and
  extinction, RC charging only when vin − Vf ≥ vC, KCL at the capacitor node, and energy conservation
  for all 24 circuit/diode configurations.
- **Theory agreement.** Every exact row is within 1 % on all 24 configurations (worst observed ≈ 0.3 %).
  The ⚠ flag fires on a deliberately coarse timestep.
- **Limits.** L from 1 µH to 10 H, C from 1 nF to 0.1 F, R from 1 mΩ to 10 MΩ, Vf ≥ Vm, inrush at φ = 90°,
  and NaN/∞/negative inputs, on every circuit. Results stay finite and explainable, with fewer than 5 solver fallbacks.
- **Modes.** Every lesson claim is checked against the simulation. Every challenge starts
  unsolved and has a verified 3-star design. Event landing and stepping are tested.

`npm run smoke` drives the real UI in Edge: 54 checks, plus screenshots in `scripts/out/`.
