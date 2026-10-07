const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const {
	api, handlers, Chats, WaitingPhoto, Files,
	deferred, flush, message, photo, fixture, loadFresh,
} = require('./support.cjs')

test('messages in one chat wait for the previous state transition', async () => {
	const gate = deferred()
	const started = deferred()
	const calls = []
	const following = { next: async (msg) => { calls.push(msg.text); return following } }
	const chats = new Chats(() => ({ next: async (msg) => {
		calls.push(msg.text)
		started.resolve()
		await gate.promise
		return following
	} }))
	const first = chats.handle(message(1, 'first'))
	const second = chats.handle(message(1, 'second'))
	await started.promise
	assert.deepEqual(calls, ['first'])
	gate.resolve()
	await Promise.all([first, second])
	assert.deepEqual(calls, ['first', 'second'])
})

test('a blocked chat does not block another chat or share its state', async () => {
	const gate = deferred()
	const calls = []
	let count = 0
	const chats = new Chats(() => {
		const id = ++count
		const state = { next: async (msg) => {
			calls.push([msg.chat.id, id])
			if (msg.chat.id === 1) await gate.promise
			return state
		} }
		return state
	})
	const first = chats.handle(message(1, 'blocked'))
	await chats.handle(message(2, 'free'))
	await chats.handle(message(2, 'again'))
	assert.deepEqual(calls, [[1, 1], [2, 2], [2, 2]])
	gate.resolve()
	await first
})

test('a failed message releases the queue and reset removes only its chat state', async () => {
	let created = 0
	const calls = []
	const chats = new Chats(() => {
		const id = ++created
		const state = { next: async (msg) => {
			calls.push([msg.chat.id, id])
			if (msg.text === 'fail') throw new Error('expected failure')
			return msg.text === '/reset' ? undefined : state
		} }
		return state
	})
	await chats.handle(message(1, '/start'))
	await chats.handle(message(2, '/start'))
	const failed = chats.handle(message(1, 'fail'))
	const reset = chats.handle(message(1, '/reset'))
	await assert.rejects(failed, /expected failure/)
	await reset
	await chats.handle(message(1, '/start'))
	await chats.handle(message(2, 'photo'))
	assert.deepEqual(calls, [[1, 1], [2, 2], [1, 1], [1, 1], [1, 3], [2, 2]])
})

test('photo state rejects messages belonging to another chat', async (t) => {
	fixture(t)
	await assert.rejects(new WaitingPhoto(1).next(photo(2, 'wrong-chat')), /different chat/)
	assert.equal(api.getFile.mock.callCount(), 0)
})

test('concurrent chats keep downloads, PDF contents, and recipients separate', async (t) => {
	const gate = deferred()
	const { root, documents, chats } = fixture(t, {
		beforeDownload: (fileId) => fileId === 'chat-one' ? gate.promise : undefined,
	})
	await Promise.all([chats.handle(message(1, '/start')), chats.handle(message(-2, '/start'))])
	await Promise.all([chats.handle(photo(1, 'chat-one')), chats.handle(photo(-2, 'chat-two'))])
	const first = chats.handle(message(1, '/done'))
	await chats.handle(message(-2, '/done'))
	assert.deepEqual(documents, [{ chatId: -2, content: 'chat-two' }])
	assert.deepEqual(await fs.readdir(root), ['1'])
	gate.resolve()
	await first
	assert.deepEqual(documents, [{ chatId: -2, content: 'chat-two' }, { chatId: 1, content: 'chat-one' }])
	assert.deepEqual(await fs.readdir(root), [])
})

test('reset waits for its download and leaves another chat intact', async (t) => {
	const gate = deferred()
	const otherDownloaded = deferred()
	const { root, chats } = fixture(t, {
		beforeDownload: (fileId) => fileId === 'slow' ? gate.promise : undefined,
		afterDownload: (fileId) => { if (fileId === 'keep') otherDownloaded.resolve() },
	})
	await Promise.all([chats.handle(message(1, '/start')), chats.handle(message(2, '/start'))])
	await Promise.all([chats.handle(photo(1, 'slow')), chats.handle(photo(2, 'keep'))])
	await otherDownloaded.promise
	let resetFinished = false
	const reset = chats.handle(message(1, '/reset')).then(() => { resetFinished = true })
	const restart = chats.handle(message(1, '/start'))
	const newPhoto = chats.handle(photo(1, 'new', 2))
	await flush()
	assert.equal(resetFinished, false)
	assert.equal(await fs.readFile(path.join(root, '2', '1.jpg'), 'utf8'), 'keep')
	gate.resolve()
	await Promise.all([reset, restart, newPhoto])
	await chats.handle(message(1, '/done'))
	assert.equal(resetFinished, true)
	assert.equal(await fs.readFile(path.join(root, '2', '1.jpg'), 'utf8'), 'keep')
	assert.deepEqual(await fs.readdir(root), ['2'])
})

test('later photos wait for conversion, delivery, and cleanup without being deleted', async (t) => {
	const conversion = deferred()
	const converting = deferred()
	const delivery = deferred()
	const delivering = deferred()
	const cleanup = deferred()
	const cleaning = deferred()
	const { documents, chats } = fixture(t, {
		beforeConvert: () => { converting.resolve(); return conversion.promise },
		beforeDelivery: () => { delivering.resolve(); return delivery.promise },
		beforeCleanup: () => { cleaning.resolve(); return cleanup.promise },
	})
	await chats.handle(message(1, '/start'))
	await chats.handle(photo(1, 'first'))
	const done = chats.handle(message(1, '/done'))
	const nextPhoto = chats.handle(photo(1, 'second', 2))
	const checkPending = () => assert.equal(Files.downloadFromUrl.mock.callCount(), 1)
	await converting.promise
	checkPending()
	conversion.resolve()
	await delivering.promise
	checkPending()
	delivery.resolve()
	await cleaning.promise
	checkPending()
	cleanup.resolve()
	await Promise.all([done, nextPhoto])
	await chats.handle(message(1, '/done'))
	assert.deepEqual(documents, [{ chatId: 1, content: 'first' }, { chatId: 1, content: 'second' }])
})

test('conversion failure releases its chat queue so reset can complete', async (t) => {
	const { root, chats } = fixture(t, {
		beforeConvert: () => { throw new Error('conversion failed') },
	})
	t.mock.method(console, 'error', () => {})
	await chats.handle(message(1, '/start'))
	await chats.handle(photo(1, 'first'))
	await Promise.all([chats.handle(message(1, '/done')), chats.handle(message(1, '/reset'))])
	assert.deepEqual(await fs.readdir(root), [])
	assert.match(console.error.mock.calls[0].arguments[1].message, /conversion failed/)
})

test('failed downloads can settle before reset without an unhandled rejection', async (t) => {
	const { root, chats } = fixture(t, {
		beforeDownload: () => { throw new Error('download failed') },
	})
	t.mock.method(console, 'error', () => {})
	await chats.handle(message(1, '/start'))
	await chats.handle(photo(1, 'broken'))
	await flush()
	await chats.handle(message(1, '/reset'))
	assert.deepEqual(await fs.readdir(root), [])
})

test('the polling message handler returns while a chat job is running', async (t) => {
	const gate = deferred()
	const started = deferred()
	fixture(t)
	t.mock.method(Chats.prototype, 'handle', (msg) => {
		if (msg.chat.id === 1) { started.resolve(); return gate.promise }
		return Promise.resolve()
	})
	loadFresh(t, '../dist/index.js')
	const handle = handlers.get('message')
	assert.equal(handle({ message: message(1, 'blocked') }), undefined)
	await started.promise
	assert.equal(handle({ message: message(2, 'free') }), undefined)
	assert.equal(Chats.prototype.handle.mock.callCount(), 2)
	gate.resolve()
	await flush()
})
