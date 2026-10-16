import type { KeyboardEvent, ReactNode } from 'react'
import { fx } from '../../ui/format.ts'
import { SUPPORT_LABEL, xTh } from './calc.ts'
import { qWords } from './notes.ts'
import type { Computed, HfState } from './shared.tsx'

/*
 * The 2D single-line schematic of the same model as the 3D scene (and its fallback): the link from grid A through
 * the rectifier, the DC line and the inverter to grid B, and the weak bus fed through X = 1/SCR with its load and
 * compensator. Symbols and layout are schematic; the arrow width (∝ |P|), the voltage gauge (∝ V) and every number
 * are CALCULATED.
 */

function El({ id, name, selected, onSelect, children }: { id: string; name: string; selected: string | null; onSelect(id: string | null): void; children: ReactNode }) {
  const on = selected === id
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(on ? null : id)
    }
  }
  return (
    <g className={`hf-el ${on ? 'is-selected' : selected ? 'is-dim' : ''}`} role="button" tabIndex={0} aria-pressed={on} aria-label={name} onClick={() => onSelect(on ? null : id)} onKeyDown={key}>
      {children}
    </g>
  )
}

const coil = (x0: number, y: number, n = 4, w = 10) => Array.from({ length: n }, (_, k) => `M${x0 + k * w} ${y} a${w / 2} ${w / 2} 0 0 1 ${w} 0`).join(' ')

export function Schematic({ s, c, selected, onSelect }: { s: HfState; c: Computed; selected: string | null; onSelect(id: string | null): void }) {
  const lcc = s.linkKind === 'lcc'
  const L = c.lcc
  const V = c.vsc
  const ok = lcc ? L.ok : V.ok
  const pSend = lcc ? (L.ok ? L.pr : 0) : V.ok ? V.pDc1Mw : 0
  const pRef = lcc ? 1300 : s.vsc.sMva
  const aw = 3 + 13 * Math.min(Math.abs(pSend) / pRef, 1.3)
  const dir = pSend >= 0 ? 1 : -1
  const b = c.bus
  const w = s.weak
  const top = 120
  const bot = 330
  const gx0 = 560
  const gw = 300
  const vx = (v: number) => gx0 + (Math.min(v, 1.2) / 1.2) * gw
  const station = (x: number, name: string) => (
    <>
      <rect x={x} y={top - 34} width={84} height={68} rx={6} className="hf-sym" />
      <text x={x + 42} y={top - 4} className="hf-sym-text" textAnchor="middle">
        {name}
      </text>
      <text x={x + 42} y={top + 14} className="hf-sym-sub" textAnchor="middle">
        {lcc ? 'thyristors' : 'IGBTs'}
      </text>
    </>
  )
  return (
    <figure className="hf-schematic">
      <svg viewBox="0 0 1000 440" role="group" aria-label="Single-line schematic of the HVDC link and the weak bus">
        {/* ── the link ── */}
        <El id="gridA" name="AC grid A" selected={selected} onSelect={onSelect}>
          {[-14, 0, 14].map((d) => (
            <line key={d} x1={20} x2={64} y1={top + d} y2={top + d} className="hf-wire hf-wire--ac" />
          ))}
          <line x1={66} x2={66} y1={top - 30} y2={top + 30} className="hf-busbar" />
          <text x={20} y={top - 42} className="hf-tag">
            AC grid A
          </text>
        </El>
        <line x1={66} x2={150} y1={top} y2={top} className="hf-wire hf-wire--ac" />
        <El id="filtersR" name="AC filters (rectifier)" selected={selected} onSelect={onSelect}>
          <line x1={104} x2={104} y1={top} y2={top + 40} className="hf-wire hf-wire--ac" />
          <line x1={92} x2={116} y1={top + 40} y2={top + 40} className="hf-wire" />
          <line x1={92} x2={116} y1={top + 48} y2={top + 48} className="hf-wire" />
          <text x={104} y={top + 66} className="hf-tag" textAnchor="middle">
            filters
          </text>
        </El>
        <El id="xfmrR" name="Converter transformers (rectifier)" selected={selected} onSelect={onSelect}>
          <circle cx={160} cy={top} r={12} className="hf-sym" />
          <circle cx={176} cy={top} r={12} className="hf-sym" />
        </El>
        <line x1={188} x2={206} y1={top} y2={top} className="hf-wire hf-wire--ac" />
        <El id="valveR" name={lcc ? 'Rectifier' : 'Converter 1'} selected={selected} onSelect={onSelect}>
          {station(206, lcc ? 'Rectifier' : 'Converter 1')}
        </El>
        <El id="reactorR" name="DC smoothing reactor (rectifier)" selected={selected} onSelect={onSelect}>
          <path d={coil(296, top - 20)} className="hf-coil" />
        </El>
        <El id="dcline" name="DC line" selected={selected} onSelect={onSelect}>
          <line x1={336} x2={664} y1={top - 20} y2={top - 20} className="hf-wire hf-wire--dc" />
          <line x1={290} x2={710} y1={top + 26} y2={top + 26} className="hf-wire hf-wire--dc" strokeDasharray="6 4" />
          <text x={500} y={top + 44} className="hf-tag" textAnchor="middle">
            DC line (pole and return)
          </text>
          {ok && Math.abs(pSend) > 1e-6 && (
            <polygon
              points={
                dir > 0
                  ? `${470},${top - 20 - aw / 2} ${510},${top - 20 - aw / 2} ${510},${top - 20 - aw} ${535},${top - 20} ${510},${top - 20 + aw} ${510},${top - 20 + aw / 2} ${470},${top - 20 + aw / 2}`
                  : `${530},${top - 20 - aw / 2} ${490},${top - 20 - aw / 2} ${490},${top - 20 - aw} ${465},${top - 20} ${490},${top - 20 + aw} ${490},${top - 20 + aw / 2} ${530},${top - 20 + aw / 2}`
              }
              className="hf-flowarrow"
            />
          )}
        </El>
        <El id="reactorI" name="DC smoothing reactor (inverter)" selected={selected} onSelect={onSelect}>
          <path d={coil(664, top - 20)} className="hf-coil" />
        </El>
        <El id="valveI" name={lcc ? 'Inverter' : 'Converter 2'} selected={selected} onSelect={onSelect}>
          {station(710, lcc ? 'Inverter' : 'Converter 2')}
        </El>
        <line x1={794} x2={812} y1={top} y2={top} className="hf-wire hf-wire--ac" />
        <El id="xfmrI" name="Converter transformers (inverter)" selected={selected} onSelect={onSelect}>
          <circle cx={824} cy={top} r={12} className="hf-sym" />
          <circle cx={840} cy={top} r={12} className="hf-sym" />
        </El>
        <line x1={852} x2={934} y1={top} y2={top} className="hf-wire hf-wire--ac" />
        <El id="filtersI" name="AC filters (inverter)" selected={selected} onSelect={onSelect}>
          <line x1={896} x2={896} y1={top} y2={top + 40} className="hf-wire hf-wire--ac" />
          <line x1={884} x2={908} y1={top + 40} y2={top + 40} className="hf-wire" />
          <line x1={884} x2={908} y1={top + 48} y2={top + 48} className="hf-wire" />
          <text x={896} y={top + 66} className="hf-tag" textAnchor="middle">
            filters
          </text>
        </El>
        <El id="gridB" name="AC grid B" selected={selected} onSelect={onSelect}>
          <line x1={934} x2={934} y1={top - 30} y2={top + 30} className="hf-busbar" />
          {[-14, 0, 14].map((d) => (
            <line key={d} x1={936} x2={980} y1={top + d} y2={top + d} className="hf-wire hf-wire--ac" />
          ))}
          <text x={980} y={top - 42} className="hf-tag" textAnchor="end">
            AC grid B
          </text>
        </El>
        {/* values */}
        {ok ? (
          lcc && L.ok ? (
            <>
              <text x={500} y={top - 38} className="hf-val" textAnchor="middle">
                P {fx(L.pr, 0)} MW · I_d {fx(L.id, 3)} kA · loss {fx(L.loss, 1)} MW
              </text>
              <text x={248} y={top + 56} className="hf-val" textAnchor="middle">
                V_dr {fx(L.vdr, 1)} kV · α {fx(L.alphaDeg, 1)}°
              </text>
              <text x={248} y={top + 72} className="hf-val hf-val--q" textAnchor="middle">
                Q drawn {fx(L.qr, 0)} Mvar
              </text>
              <text x={752} y={top + 56} className="hf-val" textAnchor="middle">
                V_di {fx(L.vdi, 1)} kV · γ {fx(L.gammaDeg, 1)}°
              </text>
              <text x={752} y={top + 72} className="hf-val hf-val--q" textAnchor="middle">
                Q drawn {fx(L.qi, 0)} Mvar
              </text>
            </>
          ) : V.ok ? (
            <>
              <text x={500} y={top - 38} className="hf-val" textAnchor="middle">
                P {fx(V.pDc1Mw, 0)} MW · I_dc {fx(V.idc, 3)} kA · loss {fx(V.loss, 1)} MW
              </text>
              <text x={248} y={top + 56} className="hf-val" textAnchor="middle">
                V_c {fx(V.st1.vc, 3)} pu ∠ {fx(V.st1.deltaDeg, 1)}°
              </text>
              <text x={248} y={top + 72} className="hf-val hf-val--q" textAnchor="middle">
                {qWords(s.vsc.q1 * s.vsc.sMva, 'grid A')}
              </text>
              <text x={752} y={top + 56} className="hf-val" textAnchor="middle">
                V_c {fx(V.st2.vc, 3)} pu ∠ {fx(V.st2.deltaDeg, 1)}°
              </text>
              <text x={752} y={top + 72} className="hf-val hf-val--q" textAnchor="middle">
                {qWords(s.vsc.q2 * s.vsc.sMva, 'grid B')}
              </text>
            </>
          ) : null
        ) : (
          <text x={500} y={top - 38} className="hf-val hf-val--bad" textAnchor="middle">
            No operating point — see the message beside the controls
          </text>
        )}

        {/* ── the weak bus ── */}
        <line x1={20} x2={980} y1={232} y2={232} className="hf-divider" />
        <El id="source" name="AC network feeding the weak bus" selected={selected} onSelect={onSelect}>
          <circle cx={70} cy={bot} r={20} className="hf-sym" />
          <path d={`M58 ${bot} q6 -10 12 0 t12 0`} className="hf-coil" />
          <text x={70} y={bot + 40} className="hf-tag" textAnchor="middle">
            E = 1.0 pu
          </text>
          <line x1={90} x2={140} y1={bot} y2={bot} className="hf-wire hf-wire--ac" />
          <rect x={140} y={bot - 10} width={110} height={20} rx={3} className="hf-sym" />
          <text x={195} y={bot - 18} className="hf-tag" textAnchor="middle">
            X = 1/SCR = {fx(xTh(w.scr), 3)} pu
          </text>
          <line x1={250} x2={398} y1={bot} y2={bot} className="hf-wire hf-wire--ac" />
          {b.ok && w.p > 1e-3 && (
            <polygon points={`${300},${bot - 5} ${330},${bot - 5} ${330},${bot - 10} ${346},${bot} ${330},${bot + 10} ${330},${bot + 5} ${300},${bot + 5}`} className="hf-flowarrow" />
          )}
        </El>
        <El id="weakbus" name="Weak bus" selected={selected} onSelect={onSelect}>
          <line x1={400} x2={400} y1={bot - 44} y2={bot + 44} className="hf-busbar" />
          <text x={400} y={bot - 52} className="hf-tag" textAnchor="middle">
            Weak bus
          </text>
          <rect x={gx0} y={bot - 44} width={gw} height={16} rx={3} className="hf-gauge" />
          {b.ok && <rect x={gx0} y={bot - 44} width={vx(b.v) - gx0} height={16} rx={3} className={Math.abs(b.v - 1) <= 0.05 ? 'hf-gauge-fill' : 'hf-gauge-fill is-low'} />}
          <line x1={vx(1)} x2={vx(1)} y1={bot - 50} y2={bot - 22} className="hf-gauge-mark" />
          <text x={vx(1)} y={bot - 54} className="hf-sym-sub" textAnchor="middle">
            1.0 pu
          </text>
          <text x={gx0} y={bot - 10} className="hf-val">
            {b.ok ? `bus voltage V = ${fx(b.v, 3)} pu` : 'no power-flow solution: voltage collapse'}
          </text>
        </El>
        <El id="load" name="Load" selected={selected} onSelect={onSelect}>
          <line x1={400} x2={470} y1={bot + 20} y2={bot + 20} className="hf-wire hf-wire--ac" />
          <line x1={470} x2={470} y1={bot + 20} y2={bot + 56} className="hf-wire hf-wire--ac" />
          <polygon points={`${462},${bot + 56} ${478},${bot + 56} ${470},${bot + 70}`} className="hf-arrowhead" />
          <text x={480} y={bot + 86} className="hf-tag">
            load {fx(w.p, 2)} pu, pf {fx(w.pf, 2)}
          </text>
        </El>
        <El id="comp" name={w.support === 'none' ? 'Compensator (off)' : SUPPORT_LABEL[w.support]} selected={selected} onSelect={onSelect}>
          <line x1={400} x2={340} y1={bot + 20} y2={bot + 20} className="hf-wire hf-wire--ac" />
          <line x1={340} x2={340} y1={bot + 20} y2={bot + 50} className="hf-wire hf-wire--ac" />
          <rect x={300} y={bot + 50} width={80} height={30} rx={5} className={`hf-sym ${w.support === 'none' ? 'is-off' : ''}`} />
          <text x={340} y={bot + 70} className="hf-sym-text" textAnchor="middle">
            {w.support === 'none' ? 'off' : SUPPORT_LABEL[w.support]}
          </text>
          {w.support !== 'none' && b.ok && (
            <text x={gx0} y={bot + 14} className="hf-val hf-val--q">
              Q_c = {fx(b.qc, 3)} pu ({b.state === 'regulating' ? 'regulating' : 'at its limit'})
            </text>
          )}
        </El>
      </svg>
      <figcaption className="small muted">
        Schematic, not to scale. Calculated: the arrows’ width (∝ |P|), the voltage gauge and every number. {s.linkKind === 'lcc' ? 'LCC link' : 'VSC link'} shown.
      </figcaption>
    </figure>
  )
}
