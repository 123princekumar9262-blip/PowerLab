import type { ControlRun, ControlState } from '../../converters/control/content.ts'
import type { LoopGain } from '../../converters/control/theory.ts'
import { formatA, formatSI, formatV } from '../../utils/format.ts'

/**
 * The feedback loop as a block diagram: reference → comparison → PID → PWM → converter → output,
 * and the sampled measurement back. Every value is the simulated one at the cursor.
 */
export function ControlDiagram({ st, r, selected, onSelect, values, live = true }: { st: ControlState; r: ControlRun; selected: string | null; onSelect: (s: string) => void; values: boolean; live?: boolean }) {
  const p = r.params
  const part = (id: string, label: string) => ({
    'data-part': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    className: `cpart ${selected === id ? 'cpart--sel' : ''}`,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  })
  const box = (x: number, y: number, w: number, h: number, id: string, title: string, sub: string, active = false) => (
    <g {...part(id, title)}>
      <rect x={x} y={y} width={w} height={h} rx={10} className={`pblock ${active ? 'pblock--on' : ''}`} />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" className="clabel">
        {title}
      </text>
      <text x={x + w / 2} y={y + 40} textAnchor="middle" className="cvalue">
        {sub}
      </text>
    </g>
  )
  const closed = p.loop === 'closed'
  return (
    <svg className="buck-diagram pwm-diagram" viewBox="0 0 690 270" role="group" aria-label={`Control loop: duty ${(st.d * 100).toFixed(1)} %`}>
      <path d="M100 90 H140" className="wire wire--sig" />
      <path d="M180 90 H215" className={`wire ${closed ? 'wire--hi' : 'wire--sig'}`} />
      <path d="M345 90 H380" className="wire wire--hi" />
      <path d="M470 90 H505" className="wire wire--hi" />
      <path d="M625 90 H660 V200 H160 V110" className={`wire ${closed ? 'wire--sig' : 'wire--thin'}`} strokeDasharray={closed ? undefined : '4 4'} />
      {box(10, 64, 90, 52, 'ref', 'Vref', formatV(st.vref, false))}
      <g {...part('sum', 'Error')}>
        <circle cx={160} cy={90} r={20} className="pblock" />
        <text x={160} y={95} textAnchor="middle" className="clabel">
          Σ
        </text>
        <text x={136} y={78} className="cvalue">
          +
        </text>
        <text x={166} y={125} className="cvalue">
          −
        </text>
      </g>
      {values && (
        <text x={160} y={52} textAnchor="middle" className="cvalue cvalue--strong">
          e = {formatV(st.e)}
        </text>
      )}
      {box(215, 56, 130, 70, 'pid', closed ? 'PID' : 'Feed-forward', closed ? (live ? `d = ${(st.d * 100).toFixed(2)} %` : 'sets the duty') : 'loop open', closed && !st.sat)}
      {closed && values && (
        <text x={280} y={142} textAnchor="middle" className="cvalue">
          P {(st.pTerm * 100).toFixed(2)} · I {(st.iTerm * 100).toFixed(2)} · D {(st.dTerm * 100).toFixed(2)} %
        </text>
      )}
      {st.sat && (
        <text x={280} y={160} textAnchor="middle" className="cvalue" fill="#fab219">
          saturated at {st.sat === 'high' ? 'Dmax' : 'Dmin'}
        </text>
      )}
      {box(380, 64, 90, 52, 'pwm', 'PWM', `fs ${formatSI(p.fs, 'Hz')}`, st.gate)}
      {box(505, 56, 120, 70, 'plant', p.kind === 'buck' ? 'Buck' : 'Boost', live ? `Vout ${formatV(st.vout)}` : 'converter')}
      {live && (
        <text x={565} y={142} textAnchor="middle" className="cvalue cvalue--il">
          iL {formatA(st.il)}
        </text>
      )}
      {box(520, 210, 130, 46, 'load', p.loadStep === 'on' ? (st.t >= p.tload ? 'Load (stepped)' : 'Load') : 'Load', formatSI(st.rload, 'Ω'))}
      <path d="M580 126 V210" className="wire wire--load" />
      <g {...part('sensor', 'Sampler')}>
        <rect x={260} y={186} width={200} height={28} rx={8} className="pblock" />
        <text x={360} y={205} textAnchor="middle" className="cvalue">
          {live ? `sample every Ts: ${formatV(st.sampled)}` : 'measures Vout every Ts'}
        </text>
      </g>
      <text x={345} y={256} className="path-caption" textAnchor="middle">
        {closed ? 'Closed loop' : 'Open loop'}
        {live && ` · period ${st.m + 1} · THEORY (averaged model) now ${formatV(st.vmodel)}`}
      </text>
    </svg>
  )
}

/** Bode plot of the loop gain: magnitude and phase, crossover and phase margin marked. */
export function BodePlot({ lg }: { lg: LoopGain }) {
  const W = 620
  const H = 150
  const L = 50
  const xs = (f: number) => L + ((Math.log10(f) - Math.log10(lg.f[0])) / (Math.log10(lg.f[lg.f.length - 1]) - Math.log10(lg.f[0]))) * (W - L - 10)
  const magMin = Math.max(-80, Math.min(...lg.mag))
  const magMax = Math.min(100, Math.max(...lg.mag))
  const ym = (v: number) => 10 + ((magMax - Math.min(magMax, Math.max(magMin, v))) / Math.max(1e-9, magMax - magMin)) * (H - 30)
  const phMin = Math.max(-360, Math.min(...lg.phase))
  const phMax = Math.max(...lg.phase)
  const yp = (v: number) => 10 + ((phMax - v) / Math.max(1e-9, phMax - phMin)) * (H - 30)
  const decades = []
  for (let e = Math.ceil(Math.log10(lg.f[0])); e <= Math.floor(Math.log10(lg.f[lg.f.length - 1])); e++) decades.push(10 ** e)
  const line = (ys: (v: number) => number, data: number[]) => lg.f.map((f, i) => `${i ? 'L' : 'M'}${xs(f).toFixed(1)} ${ys(data[i]).toFixed(1)}`).join(' ')
  return (
    <div className="bode">
      <svg viewBox={`0 0 ${W} ${H}`} className="spectrum-chart" role="img" aria-label="Loop gain magnitude in dB versus frequency">
        {decades.map((d) => (
          <g key={d}>
            <line x1={xs(d)} x2={xs(d)} y1={10} y2={H - 20} className="grid" />
            <text x={xs(d)} y={H - 6} textAnchor="middle" className="tick">
              {formatSI(d, 'Hz', { digits: 0 })}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - 10} y1={ym(0)} y2={ym(0)} className="grid" strokeDasharray="4 4" />
        <text x={L - 6} y={ym(0) + 4} textAnchor="end" className="tick">
          0 dB
        </text>
        <path d={line(ym, lg.mag)} className="bode-line" />
        {lg.fc && <circle cx={xs(lg.fc)} cy={ym(0)} r={4} className="bode-mark" />}
        <text x={L} y={14} className="tick">
          |T(jω)| [dB]
        </text>
      </svg>
      <svg viewBox={`0 0 ${W} ${H}`} className="spectrum-chart" role="img" aria-label="Loop gain phase versus frequency">
        {decades.map((d) => (
          <line key={d} x1={xs(d)} x2={xs(d)} y1={10} y2={H - 20} className="grid" />
        ))}
        {phMin < -180 && phMax > -180 && (
          <>
            <line x1={L} x2={W - 10} y1={yp(-180)} y2={yp(-180)} className="grid" strokeDasharray="4 4" />
            <text x={L - 6} y={yp(-180) + 4} textAnchor="end" className="tick">
              −180°
            </text>
          </>
        )}
        <path d={line(yp, lg.phase)} className="bode-line bode-line--phase" />
        {lg.fc && lg.pm !== null && (
          <>
            <line x1={xs(lg.fc)} x2={xs(lg.fc)} y1={yp(-180)} y2={yp(lg.pm - 180)} className="bode-pm" />
            <text x={xs(lg.fc) + 6} y={yp(lg.pm - 180) + 14} className="tick">
              PM {lg.pm.toFixed(1)}°
            </text>
          </>
        )}
        <text x={L} y={14} className="tick">
          ∠T(jω) [deg]
        </text>
      </svg>
      <p className="small muted">
        THEORY (small-signal, averaged): crossover {lg.fc ? formatSI(lg.fc, 'Hz') : '—'}, phase margin {lg.pm !== null ? `${lg.pm.toFixed(1)}°` : '—'}, gain margin {lg.gm !== null ? `${lg.gm.toFixed(1)} dB` : '—'}, LC resonance {formatSI(lg.f0, 'Hz')}
        {lg.fRhp ? `, RHP zero ${formatSI(lg.fRhp, 'Hz')}` : ''}. Linearised at the starting operating point (without the inductor's DCR): if the
        reference or the load moves the converter far from it, trust the exact stability test |λ|max in the badge.
      </p>
    </div>
  )
}
