import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveBuyer } from './buyers'

const api = vi.hoisted(() => ({ updateBuyer: vi.fn() }))
vi.mock('../api/client', () => ({ api }))

const conflict = () => Object.assign(new Error('A buyer with that code already exists'), { status: 409 })

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('saveBuyer', () => {
  it('saves a plain edit in one request', async () => {
    api.updateBuyer.mockResolvedValue({})
    await expect(saveBuyer(3, 'test', { code: 'TEST', name: 'TEST' })).resolves.toBe(true)
    expect(api.updateBuyer).toHaveBeenCalledTimes(1)
    expect(api.updateBuyer).toHaveBeenCalledWith(3, { code: 'TEST', name: 'TEST' })
  })

  it('merges into an existing code once confirmed', async () => {
    api.updateBuyer.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({})
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)

    await expect(saveBuyer(3, 'test', { code: 'TEST', name: 'TEST', rate: 5 })).resolves.toBe(true)
    expect(confirm.mock.calls[0][0]).toContain('Merge "test" into it?')
    expect(api.updateBuyer).toHaveBeenLastCalledWith(3, { code: 'TEST', name: 'TEST', rate: 5, merge: true })
  })

  it('saves nothing when the merge is declined', async () => {
    api.updateBuyer.mockRejectedValueOnce(conflict())
    vi.stubGlobal('confirm', vi.fn(() => false))

    await expect(saveBuyer(3, 'test', { code: 'TEST' })).resolves.toBe(false)
    expect(api.updateBuyer).toHaveBeenCalledTimes(1)
  })

  it('passes other failures through without asking', async () => {
    api.updateBuyer.mockRejectedValueOnce(Object.assign(new Error('Buyer not found'), { status: 404 }))
    const confirm = vi.fn()
    vi.stubGlobal('confirm', confirm)

    await expect(saveBuyer(3, 'test', { code: 'TEST' })).rejects.toThrow('Buyer not found')
    expect(confirm).not.toHaveBeenCalled()
  })
})
