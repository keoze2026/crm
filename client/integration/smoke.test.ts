import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { createEnrolledUser, loginAs, resetTables, sql, useServer } from './harness'

describe('integration harness', () => {
  beforeEach(() => resetTables('buyers', 'users', 'sessions'))

  it('round-trips a buyer through the real api client and database', async () => {
    useServer()
    const created = await api.createBuyer({ code: 'INT', name: 'Integration Buyer' })
    expect(created.code).toBe('INT')
    expect((await api.buyers()).map((b) => b.name)).toEqual(['Integration Buyer'])
    expect(sql('SELECT name FROM buyers')).toEqual([{ name: 'Integration Buyer' }])
  })

  it('logs in on the auth-on server and keeps the session cookie', async () => {
    const server = useServer({ auth: true })
    await loginAs(createEnrolledUser('intadmin', 'admin'))
    expect(server.cookies.has('crm_session')).toBe(true)
    const { user } = await api.me()
    expect(user.username).toBe('intadmin')
    await api.logout()
    await expect(api.me()).rejects.toThrow()
  })
})
