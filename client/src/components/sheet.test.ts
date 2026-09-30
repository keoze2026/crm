import { describe, expect, it } from 'vitest'
import {
  addBtnCls, addRowCls, bandCls, cellCls, dateFieldCls, fieldCls, headCls, idxCell, removeBtnCls,
  isEnterSubmit, rowCls, sheetStroke, tableCls, theadCls,
} from './sheet'

const classes = (s: string): string[] => s.split(/\s+/).filter(Boolean)

describe('sheet class strings', () => {
  it('makes the table fixed-layout so colgroup widths bind', () => {
    expect(classes(tableCls)).toContain('table-fixed')
    expect(classes(tableCls)).toContain('border-collapse')
  })

  it('joins the multi-line strings with a space, not run together', () => {
    for (const s of [tableCls, fieldCls, addBtnCls, removeBtnCls]) {
      expect(s).not.toMatch(/\S\[&/)
      expect(s).not.toMatch(/ {2}/)
    }
    expect(classes(tableCls)).toContain('[&_th]:border')
    expect(classes(fieldCls)).toContain('placeholder:text-slate-400')
    expect(classes(addBtnCls)).toContain('hover:bg-[#24466b]')
    expect(classes(removeBtnCls)).toContain('transition-colors')
  })

  it('builds the Sr. No. cell from the base cell padding plus the darker band', () => {
    expect(idxCell.startsWith(cellCls + ' ')).toBe(true)
    expect(classes(idxCell)).toContain('bg-[#bfdeeb]')
    expect(classes(idxCell)).toContain('font-bold')
  })

  it('builds the date field on top of the ordinary field control', () => {
    expect(dateFieldCls.startsWith(fieldCls + ' ')).toBe(true)
    expect(classes(dateFieldCls)).toContain('tabular-nums')
    expect(classes(dateFieldCls)).toContain('[&::-webkit-calendar-picker-indicator]:opacity-60')
  })

  it('shares the navy between the head row and the band', () => {
    expect(classes(theadCls)).toContain('bg-[#1a3654]')
    expect(classes(bandCls)).toContain('bg-[#1a3654]')
    expect(classes(headCls)).toContain('uppercase')
  })

  it('shades the add row lighter than a saved row', () => {
    expect(rowCls).toContain('bg-[#d4e9f2]')
    expect(addRowCls).toContain('bg-[#eaf5fa]')
    expect(rowCls).not.toBe(addRowCls)
  })
})

describe('sheetStroke', () => {
  it('is an outline stroke that follows the text colour', () => {
    expect(sheetStroke).toEqual({
      fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    })
  })
})

describe('isEnterSubmit', () => {
  // Just the fields the check reads, shaped like a React keyboard event.
  const press = (key: string, target: Element, over: { defaultPrevented?: boolean; isComposing?: boolean } = {}) => {
    let prevented = over.defaultPrevented ?? false
    const e = {
      key, target, defaultPrevented: prevented,
      nativeEvent: { isComposing: over.isComposing ?? false },
      preventDefault: () => { prevented = true },
    } as unknown as Parameters<typeof isEnterSubmit>[0]
    return { ok: isEnterSubmit(e), prevented: () => prevented }
  }

  it('submits on Enter in a field and stops the default', () => {
    const r = press('Enter', document.createElement('input'))
    expect(r.ok).toBe(true)
    expect(r.prevented()).toBe(true)
  })

  it('ignores other keys', () => {
    expect(press('a', document.createElement('input')).ok).toBe(false)
  })

  it('leaves a focused button to its own click, so the row is not added twice', () => {
    const btn = document.createElement('button')
    const icon = btn.appendChild(document.createElement('span'))
    expect(press('Enter', btn).ok).toBe(false)
    expect(press('Enter', icon).ok).toBe(false)
  })

  it('leaves text areas their new line', () => {
    expect(press('Enter', document.createElement('textarea')).ok).toBe(false)
  })

  it('skips a key a nested field already handled, and IME composition', () => {
    const input = document.createElement('input')
    expect(press('Enter', input, { defaultPrevented: true }).ok).toBe(false)
    expect(press('Enter', input, { isComposing: true }).ok).toBe(false)
  })
})
