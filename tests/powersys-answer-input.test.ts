import { describe, expect, it } from 'vitest'
import { checkNumberAnswer } from '../src/powersys/ui/kit.tsx'

/*
 * The typed numeric answer used by every Power Systems practice and "your turn" question (the shared Quiz). An
 * empty or non-numeric entry is reported as invalid with a reason; a number is judged right within ±tol.
 */
const ANSWER = 73.8
const TOL = 1.5
const check = (text: string) => checkNumberAnswer(text, ANSWER, TOL, 'A')

describe('Practice answer input — validation', () => {
  it('alphabetic input such as "abc" is invalid, with a message naming it and the unit', () => {
    const r = check('abc')
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') expect(r.message).toBe('“abc” is not a number. Enter a value in A, for example 12.5.')
    for (const t of ['12abc', '1..2', 'Infinity', '−', 'NaN']) expect(check(t).status, t).toBe('invalid')
  })
  it('empty or blank input is invalid, asking for a number', () => {
    for (const t of ['', '   ']) {
      const r = check(t)
      expect(r.status, JSON.stringify(t)).toBe('invalid')
      if (r.status === 'invalid') expect(r.message).toBe('Enter a number in A first.')
    }
    // without a unit the message still reads naturally
    const r = checkNumberAnswer('', 1, 0.1, '')
    expect(r.status === 'invalid' && r.message).toBe('Enter a number first.')
  })
  it('a long invalid entry is shortened in the message', () => {
    const r = check('x'.repeat(60))
    expect(r.status === 'invalid' && r.message.startsWith(`“${'x'.repeat(24)}…”`)).toBe(true)
  })
  it('a valid numeric answer is right — with the same parsing as before (decimal comma, typographic minus, spaces)', () => {
    expect(check('73.8')).toEqual({ status: 'right', value: 73.8 })
    expect(check(' 73,8 ')).toEqual({ status: 'right', value: 73.8 })
    expect(checkNumberAnswer('−0.238', -0.238, 0.005, 'Hz')).toEqual({ status: 'right', value: -0.238 })
    expect(check('7.38e1')).toEqual({ status: 'right', value: 73.8 })
  })
  it('the tolerance is unchanged: right within ±tol (inclusive), wrong outside', () => {
    expect(check(String(ANSWER + TOL)).status).toBe('right')
    expect(check(String(ANSWER - TOL)).status).toBe('right')
    expect(check(String(ANSWER + TOL + 0.01)).status).toBe('wrong')
  })
  it('a valid but incorrect number is wrong (not invalid)', () => {
    expect(check('60')).toEqual({ status: 'wrong', value: 60 })
    expect(check('-73.8')).toEqual({ status: 'wrong', value: -73.8 })
  })
  it('an out-of-range number is wrong, not invalid and not an error', () => {
    expect(check('1e9')).toEqual({ status: 'wrong', value: 1e9 })
    expect(check('-1e12')).toEqual({ status: 'wrong', value: -1e12 })
  })
  it('correcting an invalid entry and submitting again is judged normally', () => {
    expect(check('abc').status).toBe('invalid')
    expect(check('').status).toBe('invalid')
    expect(check('74').status).toBe('right')
    expect(check('80').status).toBe('wrong')
  })
})
