const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Chats, deferred, message } = require('./support.cjs')

test('large bursts retain per-chat order and create just one state per chat', async () => {
	let created = 0
	const histories = new Map()
	const chats = new Chats(() => {
		created++
		const history = []
		const state = { next: async (msg) => {
			histories.set(msg.chat.id, history)
			await Promise.resolve()
			history.push(msg.message_id)
			return state
		} }
		return state
	})
	const jobs = []
	const ids = [0, 1, -1001234567890, 4503599627370495, ...Array.from({ length: 46 }, (_, i) => i + 2)]
	for (let sequence = 1; sequence <= 30; sequence++) {
		for (const id of ids) jobs.push(chats.handle(message(id, 'photo', sequence)))
	}
	await Promise.all(jobs)
	assert.equal(created, ids.length)
	assert.equal(new Set(histories.values()).size, ids.length)
	for (const id of ids) {
		assert.deepEqual(histories.get(id), Array.from({ length: 30 }, (_, i) => i + 1))
	}
})

test('synchronous state exceptions do not poison subsequent messages', async () => {
	const seen = []
	const state = { next: (msg) => {
		seen.push(msg.text)
		if (msg.text === 'fail') throw new Error('synchronous error')
		return state
	} }
	const chats = new Chats(() => state)
	const failed = chats.handle(message(1, 'fail'))
	const following = chats.handle(message(1, 'ok'))
	await assert.rejects(failed, /synchronous error/)
	await following
	assert.deepEqual(seen, ['fail', 'ok'])
})

test('a failed initial state factory can be retried', async () => {
	let attempts = 0
	const state = { next: () => state }
	const chats = new Chats(() => {
		if (++attempts === 1) throw new Error('cannot initialize')
		return state
	})
	const first = chats.handle(message(1, 'first'))
	const second = chats.handle(message(1, 'second'))
	await assert.rejects(first, /cannot initialize/)
	await second
	await chats.handle(message(1, 'third'))
	assert.equal(attempts, 2)
})

test('an asynchronously failed message releases queued work in arrival order', async () => {
	const gate = deferred()
	const calls = []
	const state = { next: async (msg) => {
		calls.push(msg.text)
		if (msg.text === 'fail') { await gate.promise; throw new Error('async failure') }
		return state
	} }
	const chats = new Chats(() => state)
	const failed = chats.handle(message(1, 'fail'))
	const rejection = assert.rejects(failed, /async failure/)
	const second = chats.handle(message(1, 'second'))
	const third = chats.handle(message(1, 'third'))
	await chats.handle(message(2, 'other'))
	assert.deepEqual(calls, ['fail', 'other'])
	gate.resolve()
	await Promise.all([rejection, second, third])
	assert.deepEqual(calls, ['fail', 'other', 'second', 'third'])
})

test('state remains available after its queue becomes idle', async () => {
	let created = 0
	const seen = []
	const chats = new Chats(() => {
		const id = ++created
		const state = { next: (msg) => { seen.push([id, msg.text]); return state } }
		return state
	})
	await chats.handle(message(1, 'first'))
	await new Promise((resolve) => setImmediate(resolve))
	await chats.handle(message(1, 'second'))
	assert.deepEqual(seen, [[1, 'first'], [1, 'second']])
})

test('a message may enqueue later work without losing or reordering it', async () => {
	const seen = []
	let following
	const state = { next: (msg) => {
		seen.push(msg.text)
		if (msg.text === 'first') following = chats.handle(message(1, 'third'))
		return state
	} }
	const chats = new Chats(() => state)
	const first = chats.handle(message(1, 'first'))
	const second = chats.handle(message(1, 'second'))
	await Promise.all([first, second])
	await following
	assert.deepEqual(seen, ['first', 'second', 'third'])
})

test('reset queued between two messages creates a fresh state for the last message', async () => {
	let created = 0
	const calls = []
	const chats = new Chats(() => {
		const id = ++created
		const state = { next: (msg) => {
			calls.push([id, msg.text])
			return msg.text === '/reset' ? undefined : state
		} }
		return state
	})
	await Promise.all([
		chats.handle(message(1, 'first')),
		chats.handle(message(1, '/reset')),
		chats.handle(message(1, 'last')),
	])
	assert.deepEqual(calls, [[1, 'first'], [1, '/reset'], [2, 'last']])
})
