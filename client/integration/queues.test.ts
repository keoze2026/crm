import { beforeEach, describe, expect, it } from 'vitest'
import { api } from '../src/api/client'
import { entryDay, entryTime, parseCodeList } from '../src/lib/queues'
import type { CatalogueResult, QueueAssignment, QueueCode } from '../src/types'
import { deletedShape, queueAssignmentShape, queueCodeShape } from './contracts'
import { resetTables, sql, useServer } from './harness'
import { arrayOf, assertShape, object, rejection } from './shape'

// Queues page: the queue-code catalogue and one record per person per board.

const TABLES = ['queue_assignment_codes', 'queue_assignments', 'queue_codes', 'staff']

const catalogueShape = object<CatalogueResult<QueueCode>>({ created: arrayOf(queueCodeShape), existing: arrayOf(queueCodeShape) })

async function people(...names: string[]): Promise<number[]> {
  const res = await api.createStaff(names)
  const all = [...res.created, ...res.existing]
  return names.map((n) => all.find((s) => s.name === n)!.id)
}

async function codes(raw: string): Promise<Map<string, number>> {
  const res = await api.createQueueCodes(parseCodeList(raw))
  return new Map([...res.created, ...res.existing].map((c) => [c.code.toUpperCase(), c.id]))
}

describe('queue codes', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('a pasted list (parseCodeList) creates the new codes and reports the existing ones', async () => {
    const server = useServer()
    const first = assertShape<CatalogueResult<QueueCode>>(await api.createQueueCodes(parseCodeList('BHS, BOP Q04; bhs')), catalogueShape)
    expect(server.calls.at(-1)?.status).toBe(201)
    expect(first.created.map((c) => c.code)).toEqual(['BHS', 'BOP', 'Q04'])
    expect(first.existing).toEqual([])
    expect(first.created.every((c) => c.usage_count === 0)).toBe(true)

    const second = await api.createQueueCodes(['bop', 'NEW'])
    expect(second.created.map((c) => c.code)).toEqual(['NEW'])
    expect(second.existing.map((c) => c.code)).toEqual(['BOP'])

    const onlyExisting = await api.createQueueCodes(['Q04'])
    expect(server.calls.at(-1)?.status).toBe(200)
    expect(onlyExisting).toMatchObject({ created: [], existing: [{ code: 'Q04' }] })

    const list = assertShape<QueueCode[]>(await api.queueCodes(), arrayOf(queueCodeShape))
    expect(list.map((c) => c.code)).toEqual(['BHS', 'BOP', 'NEW', 'Q04'])
    expect(await rejection(api.createQueueCodes([' ', '']))).toBe('A queue code is required')
  })

  it('rename answers the code; clash → 409, unknown → 404, blank → 422', async () => {
    const ids = await codes('AAA BBB')
    const renamed = assertShape<QueueCode>(await api.updateQueueCode(ids.get('AAA')!, 'A1'), queueCodeShape)
    expect(renamed).toMatchObject({ id: ids.get('AAA'), code: 'A1' })
    expect(await rejection(api.updateQueueCode(ids.get('AAA')!, 'bbb'))).toBe('Another queue is already called that')
    expect(await rejection(api.updateQueueCode(999999, 'ZZZ'))).toBe('Queue not found')
    expect(await rejection(api.updateQueueCode(ids.get('AAA')!, '  '))).toBe('A queue code is required')
  })
})

describe('queue records', () => {
  beforeEach(() => {
    resetTables(...TABLES)
    useServer()
  })

  it('create answers a QueueAssignment with the chips in the order sent', async () => {
    const [anna] = await people('Anna')
    const ids = await codes('BHS BOP Q04')
    const order = [ids.get('Q04')!, ids.get('BHS')!, ids.get('BOP')!]
    const rec = assertShape<QueueAssignment>(await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: order }), queueAssignmentShape)
    expect(rec).toMatchObject({ board: 'forwarding', person_id: anna, name: 'Anna', sort_order: 0 })
    expect(rec.codes.map((c) => c.code)).toEqual(['Q04', 'BHS', 'BOP'])
    expect(sql('SELECT code_id FROM queue_assignment_codes ORDER BY sort_order').map((r) => r.code_id)).toEqual(order)

    // usage_count follows the links.
    expect((await api.queueCodes()).map((c) => c.usage_count)).toEqual([1, 1, 1])

    // No codes at all is still an array, never {} or null.
    const [ben] = await people('Ben')
    const empty = assertShape<QueueAssignment>(await api.createQueueAssignment({ board: 'forwarding', person_id: ben, code_ids: [] }), queueAssignmentShape)
    expect(empty.codes).toEqual([])
    expect(empty.sort_order).toBe(1)
  })

  it('one record per person per board: a second create updates, the other board is separate', async () => {
    const [anna] = await people('Anna')
    const ids = await codes('A B')
    const first = await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: [ids.get('A')!] })
    const again = await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: [ids.get('B')!, ids.get('A')!] })
    expect(again.id).toBe(first.id)
    expect(again.codes.map((c) => c.code)).toEqual(['B', 'A'])
    const camp = await api.createQueueAssignment({ board: 'camp_flow', person_id: anna, code_ids: [] })
    expect(camp.id).not.toBe(first.id)

    const forwarding = assertShape<QueueAssignment[]>(await api.queues('forwarding'), arrayOf(queueAssignmentShape))
    expect(forwarding.map((r) => r.id)).toEqual([first.id])
    expect((await api.queues('camp_flow')).map((r) => r.id)).toEqual([camp.id])
  })

  it('update reorders chips (drag), moves to another name, and refuses a taken name', async () => {
    const [anna, ben, cara] = await people('Anna', 'Ben', 'Cara')
    const ids = await codes('X Y Z')
    const rec = await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: [ids.get('X')!, ids.get('Y')!] })
    await api.createQueueAssignment({ board: 'forwarding', person_id: ben, code_ids: [] })

    const dragged = assertShape<QueueAssignment>(await api.updateQueueAssignment(rec.id, { code_ids: [ids.get('Z')!, ids.get('Y')!, ids.get('X')!] }), queueAssignmentShape)
    expect(dragged.codes.map((c) => c.code)).toEqual(['Z', 'Y', 'X'])

    const moved = await api.updateQueueAssignment(rec.id, { person_id: cara })
    expect(moved).toMatchObject({ person_id: cara, name: 'Cara' })
    expect(moved.codes.map((c) => c.code)).toEqual(['Z', 'Y', 'X'])

    expect(await rejection(api.updateQueueAssignment(rec.id, { person_id: ben }))).toBe('That name already has a record on this sheet — edit that one instead')
    expect(await rejection(api.updateQueueAssignment(rec.id, { person_id: 999999 }))).toBe('Pick a name for this record')
    expect(await rejection(api.updateQueueAssignment(999999, { code_ids: [] }))).toBe('Record not found')
    expect(await rejection(api.createQueueAssignment({ board: 'forwarding', person_id: 0, code_ids: [] }))).toBe('Pick a name for this record')
  })

  it('deleting a queue code drops it from every record; deleting a record works once', async () => {
    const [anna] = await people('Anna')
    const ids = await codes('KEEP DROP')
    const rec = await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: [ids.get('DROP')!, ids.get('KEEP')!] })
    expect(assertShape(await api.deleteQueueCode(ids.get('DROP')!), deletedShape)).toEqual({ deleted: true })
    expect((await api.queues('forwarding'))[0].codes.map((c) => c.code)).toEqual(['KEEP'])
    expect(await api.deleteQueueAssignment(rec.id)).toEqual({ deleted: true })
    expect(await api.deleteQueueAssignment(rec.id)).toEqual({ deleted: false })
    expect(await api.queues('forwarding')).toEqual([])
  })

  it('created_at feeds the History grouping helpers and the ?day filter', async () => {
    const [anna] = await people('Anna')
    const rec = await api.createQueueAssignment({ board: 'forwarding', person_id: anna, code_ids: [] })
    expect(entryDay(rec.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(entryTime(rec.created_at)).toMatch(/^\d{1,2}:\d{2}\s?[AP]M$/)

    // The server filters on the stored date in its own timezone.
    const [{ d }] = sql<{ d: string }>("SELECT to_char(created_at::date, 'YYYY-MM-DD') AS d FROM queue_assignments")
    expect((await api.queues('forwarding', d)).map((r) => r.id)).toEqual([rec.id])
    expect(await api.queues('forwarding', '2001-01-01')).toEqual([])
  })
})
