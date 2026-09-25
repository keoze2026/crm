import { describe, expect, it } from 'vitest'
import {
  addBtnCls, addRowCls, bandCls, cellCls, dateFieldCls, fieldCls, headCls, idxCell, removeBtnCls,
  rowCls, sheetStroke, tableCls, theadCls,
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
