# Simulation model

This is the mathematical reference for what the engine computes. Every number on
screen comes from the model below: waveforms, circuit highlighting, explanations,
lesson text, challenge checks and measurements. No waveform is drawn from an
"expected" shape.

## 1. Circuits

Single-phase: three rectifiers × four loads = 12 circuits. Three-phase: §8. All are built from
one netlist engine (`src/circuits/rectifier.ts`).

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
f_ripple     = k·f for the largest k ∈ {12, 6, 4, 3, 2, 1} such that vout(t) ≈ vout(t + T/k)
               over the last cycle (interpolated shift; ≤ 2 % of samples may differ, which
               tolerates the jumps at an SCR firing instant)
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

## 8. Three-phase circuits

Same netlist engine, same assumed-state search, same event-located stepping. Only the
netlist builder (`buildThreePhase` in `src/circuits/rectifier.ts`) is new.

**Source.** Three star-connected sources from a neutral bus N, each optionally with a series
Rs and Ls (Advanced):

```
VaN = Vm·sin(ωt + φ)    VbN = Vm·sin(ωt + φ − 120°)    VcN = Vm·sin(ωt + φ − 240°)   (abc)
acb swaps the signs of the 120° shifts.   Vm = √2·Vph,  VLL = √3·Vph
```

| Topology | Devices | Output |
|---|---|---|
| 3-pulse half-wave | Da, Db, Dc from each phase to the + bus; the load returns to N | highest phase − Vf |
| 6-pulse bridge | D1, D3, D5 (a, b, c) to the + rail; D4, D6, D2 from the − rail | highest − lowest phase − 2Vf |
| Half-controlled | T1, T3, T5 (SCRs) on top, D4, D6, D2 below | |

In the bridge the neutral is not connected to the load, so the network floats whenever the
neutral is not involved (see "floating networks" below).

**SCR model.** An SCR is a diode element with a gate signal `g(t)`:

```
ON   allowed only if i > 0 and (g(t) or it was already ON)       (latching)
OFF  with forward voltage allowed only if g(t) is low and it was OFF before
```

The previous combination is passed to the solver so that latching is explicit. Gate pulses are
120° wide and start α after each device's natural commutation instant. That instant is the
phase angle 30° for the upper (and 3-pulse) devices and 210° for the lower ones, i.e. where that
phase becomes the highest (lowest). At α = 0 every SCR is fired exactly when the equivalent diode would
turn on, so the output is the diode rectifier's. The optional freewheeling diode Dfw sits across the load.

**Floating networks.** When the conducting devices leave part of the circuit connected to the
rest only through OFF devices, that part's potential is undefined. The solver replaces one KCL row
with a reference constraint (as for the single-phase bridge) and then shifts the floating part by
the common δ that keeps every OFF device blocking. Without this shift, idle SCRs at large α (and
the freewheeling and RC cases) looked forward biased and forced thousands of solver fallbacks. It
now produces none.

**Faults** (`LabParams.faults`):

| Fault | Model |
|---|---|
| device open | the device can never be ON |
| device short | a 1 mΩ conductance in both directions (a warning appears if Rs < 0.05 Ω, since that is a phase-to-phase short) |
| unequal Vf | that device's Vf overridden |
| missing phase | that phase's source removed and its line tied to N through 1 GΩ; devices on that line are forced open so nA leakage never reads as "conduction" |
| imbalance | that phase's amplitude scaled |

## 9. Three-phase theory

`src/measurements/theory/threePhase.ts` is again independent of the simulator. It writes vout(θ)
analytically and integrates by quadrature.

```
3-pulse, R, α = 0:   Vdc = (3√3/2π)·Vm = 1.17·Vph              f_ripple = 3f
6-pulse, R, α = 0:   Vdc = (3√3/π)·Vm = (3/π)·√2·VLL = 1.35·VLL   f_ripple = 6f
controlled, continuous:  Vdc = Vdc0·cos α
```

With real devices the waveform is `envelope − path drop` (Vf for 3-pulse, 2Vf for the bridge).
For SCRs each 60° (bridge) or 120° (3-pulse) segment starts α late. With an R load or a
freewheeling diode the output is clamped at 0 (or at −Vf) when the segment voltage goes negative.

**RL.** The load current is the periodic solution of `L·di/dt + R·i = vo(θ)`. It is obtained by
exact exponential integration over the segment waveform (`periodicRL`), and discontinuity is
detected when that solution would go negative. The conduction angle of each device is then
measured on the theory current, not assumed to be 120°.

**Approximations, not compared** (shown as "approx."):

```
source impedance:  Vdc ≈ Vdc0 / (1 + (3ωLs/π + 2Rs)/R)    (overlap voltage loss 3ωLs·Idc/π)
```

RC and RLC filters, and every fault, have no closed form here, so the table says so. Source rows
(VaN RMS, VLL RMS) are compared only for a balanced, healthy source, and the ripple frequency only
when no phase is missing or unbalanced.

## 10. Validation

`npm test` runs 354 tests:

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
- **Three-phase.** 120° displacement and a balanced source (Σv = 0), both sequences; the D1D2 → … →
  D6D1 sequence with each pair for 60°; Vo equal to the highest-minus-lowest line voltage; six-pulse
  output with f_ripple = 6f; Vdc = 1.35·VLL; diode current conservation (upper sum = lower sum = io);
  RL current continuity, and larger L giving smaller current ripple; SCR Vdc = Vdc0·cos α for R and RL
  across α; an SCR turning on only during its gate pulse; the freewheeling clamp; the half-controlled bridge; each fault's physical signature
  (D1 open → 50 Hz ripple, missing phase → 100 Hz); theory agreement within 1 %; no solver fallbacks.
- **Three-phase modes.** Experiment diffs and explanations, every what-if answer derived from
  simulation, reverse-engineering tasks, three-phase lessons and challenges.

`npm run smoke` and `npm run smoke3` drive the real UI in Edge: 54 + 24 checks, plus screenshots in
`scripts/out/`.
