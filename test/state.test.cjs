const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const childProcess = require('node:child_process')
const { InputFile } = require('node-telegram-bot-api')
const {
	api, StartState, WaitingPhoto, Files, fixture, message, photo, deferred, flush,
} = require('./support.cjs')

for (const [name, input] of [
	['text', message(7, 'hello')],
	['done', message(7, '/done')],
	['reset', message(7, '/reset')],
	['photo', photo(7, 'early')],
	['sticker', { ...message(7), sticker: { file_id: 'sticker' } }],
]) {
	test(`start state prompts for /start when receiving ${name}`, (t) => {
		fixture(t)
		const state = new StartState()
		assert.equal(state.next(input), state)
		assert.deepEqual(api.sendMessage.mock.calls[0].arguments[0], { chat_id: 7, text: 'Use /start to start.' })
		assert.equal(api.getFile.mock.callCount(), 0)
	})
}

test('/start sends welcome instructions and binds the new state to that chat', async (t) => {
	fixture(t)
	const next = new StartState().next(message(-7, '/start'))
	assert.ok(next instanceof WaitingPhoto)
	const reply = api.sendMessage.mock.calls[0].arguments[0]
	assert.equal(reply.chat_id, -7)
	assert.equal(reply.parse_mode, 'HTML')
	assert.match(reply.text, /Welcome!/)
	assert.match(reply.text, /\/done/)
	assert.deepEqual(reply.reply_markup, {
		keyboard: [[{ text: '/done' }, { text: '/reset' }]],
		one_time_keyboard: false, resize_keyboard: true,
	})
	await assert.rejects(next.next(photo(7, 'wrong')), /different chat/)
})

for (const [name, extra] of [
	['text', { text: 'hello' }],
	['document', { document: { file_id: 'image.png', mime_type: 'image/png' } }],
	['video', { video: { file_id: 'video' } }],
	['empty message', {}],
	['another /start', { text: '/start' }],
]) {
	test(`photo state explains unsupported ${name} without downloading`, async (t) => {
		fixture(t)
		const state = new WaitingPhoto(7)
		assert.equal(await state.next({ ...message(7), ...extra }), state)
		const reply = api.sendMessage.mock.calls[0].arguments[0]
		assert.equal(reply.chat_id, 7)
		assert.equal(reply.parse_mode, 'HTML')
		assert.match(reply.text, /expecting a photo/)
		assert.equal(api.getFile.mock.callCount(), 0)
		assert.equal(childProcess.execFile.mock.callCount(), 0)
	})
}

test('stickers receive the sticker-specific reply', async (t) => {
	fixture(t)
	const state = new WaitingPhoto(7)
	assert.equal(await state.next({ ...message(7), sticker: { file_id: 'sticker' } }), state)
	assert.match(api.sendMessage.mock.calls[0].arguments[0].text, /only accept photos/)
	assert.equal(api.getFile.mock.callCount(), 0)
})

for (const folderExists of [false, true]) {
	test(`/done prompts for photos when the folder is ${folderExists ? 'empty' : 'missing'}`, async (t) => {
		const { root } = fixture(t)
		if (folderExists) await fs.mkdir(path.join(root, '7'))
		const state = new WaitingPhoto(7)
		assert.equal(await state.next(message(7, '/done')), state)
		assert.match(api.sendMessage.mock.calls[0].arguments[0].text, /Send me some photos/)
		assert.equal(childProcess.execFile.mock.callCount(), 0)
		assert.equal(api.sendDocument.mock.callCount(), 0)
		assert.equal(api.sendChatAction.mock.callCount(), 0)
	})
}

test('photo download uses the largest Telegram variant and message-specific path', async (t) => {
	const { root } = fixture(t)
	const state = new WaitingPhoto(-7)
	const input = photo(-7, 'small', 42)
	input.photo.push({ file_id: 'large', width: 1000, height: 1000 })
	assert.equal(await state.next(input), state)
	await state.next(message(-7, '/done'))
	assert.deepEqual(api.getFile.mock.calls[0].arguments[0], { file_id: 'large' })
	assert.deepEqual(Files.downloadFromUrl.mock.calls[0].arguments, [
		'https://example.invalid/large', `${root}/-7/42.jpg`,
	])
})

test('/done sends all photos with PDF metadata and removes only its own folder', async (t) => {
	const { root, documents } = fixture(t)
	await fs.mkdir(path.join(root, '8'))
	await fs.writeFile(path.join(root, '8', 'keep.jpg'), 'other chat')
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'one', 1))
	await state.next(photo(7, 'two', 2))
	assert.equal(await state.next(message(7, '/done')), state)
	assert.deepEqual(documents, [{ chatId: 7, content: 'one,two' }])
	const upload = api.sendDocument.mock.calls[0].arguments[0]
	assert.ok(upload.document instanceof InputFile)
	assert.deepEqual(upload.document.meta, { filename: 'file.pdf', contentType: 'application/pdf' })
	assert.deepEqual(api.sendChatAction.mock.calls[0].arguments[0], { chat_id: 7, action: 'upload_document' })
	assert.deepEqual(await fs.readdir(root), ['8'])
	assert.equal(await fs.readFile(path.join(root, '8', 'keep.jpg'), 'utf8'), 'other chat')
})

test('/done waits for every download, including downloads finishing out of order', async (t) => {
	const slow = deferred()
	const fast = deferred()
	const { documents } = fixture(t, {
		beforeDownload: (id) => id === 'slow' ? slow.promise : fast.promise,
	})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'slow', 1))
	await state.next(photo(7, 'fast', 2))
	const done = state.next(message(7, '/done'))
	fast.resolve()
	await flush()
	assert.equal(childProcess.execFile.mock.callCount(), 0)
	slow.resolve()
	await done
	assert.deepEqual(documents, [{ chatId: 7, content: 'slow,fast' }])
})

for (const [name, setup, expected] of [
	['missing file path', (t) => t.mock.method(api, 'getFile', async () => ({})), /did not return a file path/],
	['Telegram failure', (t) => t.mock.method(api, 'getFile', async () => { throw new Error('Telegram unavailable') }), /Telegram unavailable/],
	['download failure', (t) => t.mock.method(Files, 'downloadFromUrl', async () => { throw new Error('download failed') }), /download failed/],
]) {
	test(`${name} is logged and /done handles the empty result`, async (t) => {
		fixture(t)
		t.mock.method(console, 'error', () => {})
		setup(t)
		const state = new WaitingPhoto(7)
		await state.next(photo(7, 'broken'))
		await flush()
		assert.equal(await state.next(message(7, '/done')), state)
		assert.match(console.error.mock.calls[0].arguments[1].message, expected)
		assert.equal(api.sendDocument.mock.callCount(), 0)
		assert.match(api.sendMessage.mock.calls[0].arguments[0].text, /Send me some photos/)
	})
}

test('successful downloads remain usable when another photo fails', async (t) => {
	const { documents } = fixture(t, {
		beforeDownload: (id) => { if (id === 'broken') throw new Error('download failed') },
	})
	t.mock.method(console, 'error', () => {})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'good', 1))
	await state.next(photo(7, 'broken', 2))
	await state.next(message(7, '/done'))
	assert.deepEqual(documents, [{ chatId: 7, content: 'good' }])
})

test('a second queued /done does not send the previous PDF again', async (t) => {
	const { chats, documents } = fixture(t)
	await chats.handle(message(7, '/start'))
	await chats.handle(photo(7, 'one'))
	await Promise.all([chats.handle(message(7, '/done')), chats.handle(message(7, '/done'))])
	assert.equal(documents.length, 1)
	assert.match(api.sendMessage.mock.calls.at(-1).arguments[0].text, /Send me some photos/)
})

test('conversion errors preserve photos for a successful retry', async (t) => {
	let fail = true
	const { root, documents } = fixture(t, {
		beforeConvert: () => { if (fail) throw new Error('conversion failed') },
	})
	t.mock.method(console, 'error', () => {})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'retry'))
	await state.next(message(7, '/done'))
	assert.equal(documents.length, 0)
	assert.equal(await fs.readFile(path.join(root, '7', '1.jpg'), 'utf8'), 'retry')
	fail = false
	await state.next(message(7, '/done'))
	assert.deepEqual(documents, [{ chatId: 7, content: 'retry' }])
	assert.deepEqual(await fs.readdir(root), [])
})

test('delivery errors preserve photos, log the failure, and allow retry', async (t) => {
	let fail = true
	const { root } = fixture(t, {
		beforeDelivery: () => { if (fail) throw new Error('delivery failed') },
	})
	t.mock.method(console, 'error', () => {})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'retry'))
	await state.next(message(7, '/done'))
	assert.equal(Files.deleteFolder.mock.callCount(), 0)
	assert.match(console.error.mock.calls[0].arguments[1].message, /delivery failed/)
	assert.equal(await fs.readFile(path.join(root, '7', '1.jpg'), 'utf8'), 'retry')
	fail = false
	await state.next(message(7, '/done'))
	assert.equal(api.sendDocument.mock.callCount(), 2)
	assert.deepEqual(await fs.readdir(root), [])
})

test('cleanup errors after delivery are logged and reset can remove the files', async (t) => {
	let fail = true
	const { root } = fixture(t, {
		beforeCleanup: () => { if (fail) throw new Error('cleanup failed') },
	})
	t.mock.method(console, 'error', () => {})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'one'))
	assert.equal(await state.next(message(7, '/done')), state)
	assert.match(console.error.mock.calls[0].arguments[1].message, /cleanup failed/)
	fail = false
	assert.equal(await state.next(message(7, '/reset')), undefined)
	assert.deepEqual(await fs.readdir(root), [])
})

test('folder creation failure rejects without attempting a Telegram download', async (t) => {
	fixture(t)
	t.mock.method(Files, 'createFolder', async () => { throw new Error('disk unavailable') })
	await assert.rejects(new WaitingPhoto(7).next(photo(7, 'one')), /disk unavailable/)
	assert.equal(api.getFile.mock.callCount(), 0)
})

test('folder inspection failure rejects /done without running conversion', async (t) => {
	fixture(t)
	t.mock.method(Files, 'isEmpty', async () => { throw new Error('cannot inspect folder') })
	await assert.rejects(new WaitingPhoto(7).next(message(7, '/done')), /cannot inspect folder/)
	assert.equal(childProcess.execFile.mock.callCount(), 0)
})

test('/reset on an empty job sends the start keyboard and ends the state', async (t) => {
	const { root } = fixture(t)
	assert.equal(await new WaitingPhoto(7).next(message(7, '/reset')), undefined)
	assert.deepEqual(await fs.readdir(root), [])
	assert.deepEqual(api.sendMessage.mock.calls[0].arguments[0], {
		chat_id: 7, text: 'Bot reset completed.',
		reply_markup: { keyboard: [[{ text: '/start' }]], one_time_keyboard: false, resize_keyboard: true },
	})
})

test('/reset confirms completion only after cleanup finishes', async (t) => {
	const gate = deferred()
	const cleaning = deferred()
	fixture(t, { beforeCleanup: () => { cleaning.resolve(); return gate.promise } })
	const reset = new WaitingPhoto(7).next(message(7, '/reset'))
	await cleaning.promise
	assert.equal(api.sendMessage.mock.callCount(), 0)
	gate.resolve()
	assert.equal(await reset, undefined)
	assert.equal(api.sendMessage.mock.callCount(), 1)
})

test('failed reset cleanup retains chat state and can be retried', async (t) => {
	let fail = true
	const { chats } = fixture(t, {
		beforeCleanup: () => { if (fail) throw new Error('cannot reset') },
	})
	await chats.handle(message(7, '/start'))
	await assert.rejects(chats.handle(message(7, '/reset')), /cannot reset/)
	assert.equal(api.sendMessage.mock.callCount(), 1)
	fail = false
	await chats.handle(message(7, '/reset'))
	await chats.handle(photo(7, 'too-early'))
	assert.match(api.sendMessage.mock.calls.at(-1).arguments[0].text, /Use \/start/)
})

test('reset also completes after one of its downloads fails', async (t) => {
	const gate = deferred()
	const { root } = fixture(t, { beforeDownload: () => gate.promise })
	t.mock.method(console, 'error', () => {})
	const state = new WaitingPhoto(7)
	await state.next(photo(7, 'broken'))
	const reset = state.next(message(7, '/reset'))
	gate.reject(new Error('download failed'))
	assert.equal(await reset, undefined)
	assert.deepEqual(await fs.readdir(root), [])
})
