/// <reference types="node" />
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dcdcExact } from '../src/converters/dcdc/theory.ts'
import { DCDC_DEFAULTS, resolveConverter } from '../src/converters/params.ts'
import type { ConverterKind } from '../src/converters/types.ts'

/*
 * BIT-EXACT snapshot of the exact analytic DC-DC solution (dcdcExact), recorded BEFORE the Phase 4
 * performance work (a flow cache inside dcdcExact and an allocation-free expm). Those changes must not
 * move a single bit: every value is compared with Object.is against the recorded doubles.
 * Regenerate only on purpose: UPDATE_DCDC_SNAPSHOT=1 npx vitest run tests/dcdc-exact.snapshot.test.ts
 */
const FILE = new URL('./fixtures/dcdc-exact.snapshot.json', import.meta.url)
const KINDS: ConverterKind[] = ['buck', 'boost', 'buck-boost']
const cases = KINDS.flatMap((kind) => [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((duty) => [6, 30].map((r) => ({ kind, duty, r }))))

function compute(c: (typeof cases)[number]) {
  const p = resolveConverter({ ...DCDC_DEFAULTS[c.kind], duty: c.duty, r: c.r }, c.kind).params
  const ex = dcdcExact(p)
  const samples = [0, 0.13, 0.37, 0.5, 0.81, 0.999].map((f) => ex.at(f * p.ts))
  return { mode: ex.mode, tOn: ex.tOn, tOff: ex.tOff, tIdle: ex.tIdle, x0: ex.x0, metrics: ex.metrics, samples }
}

describe('dcdcExact is bit-identical to its recorded snapshot', () => {
  if (process.env.UPDATE_DCDC_SNAPSHOT === '1' || !existsSync(FILE)) {
    it('records the snapshot', () => {
      writeFileSync(FILE, JSON.stringify(cases.map((c) => ({ case: c, out: compute(c) }))))
    })
    return
  }
  const recorded: Array<{ case: (typeof cases)[number]; out: unknown }> = JSON.parse(readFileSync(FILE, 'utf-8'))
  it.each(recorded.map((r) => [`${r.case.kind} D=${r.case.duty} R=${r.case.r}`, r] as const))('%s', (_name, r) => {
    const got = JSON.parse(JSON.stringify(compute(r.case)))
    // JSON keeps doubles exactly (shortest round-trip form); toEqual on parsed values = bitwise equality here
    expect(got).toStrictEqual(r.out)
  })
})
