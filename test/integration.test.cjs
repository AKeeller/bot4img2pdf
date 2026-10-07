const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const {
	fixture, loadFresh, environment, message, photo, deferred, flush,
} = require('./support.cjs')

const TEST_TOKEN = '123:TEST_ONLY_INTEGRATION_TOKEN'

function application(t, options = {}) {
	environment(t, { TOKEN: TEST_TOKEN, WEBHOOK_URL: undefined })
	// Exercise the real downloader, Telegram client, middleware, and multipart
	// encoder together. Only HTTP responses and the PDF converter are simulated.
	const requests = []
	const documents = []
	const fetch = async (url, init) => {
		assert.ok(url.startsWith(`https://api.telegram.org/`))
		if (url.startsWith(`https://api.telegram.org/file/bot${TEST_TOKEN}/`)) {
			const fileId = decodeURIComponent(url.split('/').at(-1))
			await options.beforeDownload?.(fileId)
			return new Response(fileId)
		}
		assert.ok(url.startsWith(`https://api.telegram.org/bot${TEST_TOKEN}/`))
		const method = url.split('/').at(-1)
		const data = await new Response(init.body, { headers: init.headers }).formData()
		const params = Object.fromEntries(data)
		requests.push({ method, params })
		if (method === 'getFile') {
			return Response.json({ ok: true, result: { file_id: params.file_id, file_path: `photos/${params.file_id}.jpg` } })
		}
		if (method === 'sendDocument') {
			documents.push({
				chatId: Number(params.chat_id),
				filename: params.document.name,
				mimeType: params.document.type,
				content: await params.document.text(),
			})
			await options.beforeDelivery?.(Number(params.chat_id))
		}
		assert.ok(['sendMessage', 'sendChatAction', 'sendDocument'].includes(method), `Unexpected API method: ${method}`)
		return Response.json({ ok: true, result: method === 'sendChatAction' ? true : {
			message_id: requests.length, date: 0, chat: { id: Number(params.chat_id), type: 'private' },
		} })
	}
	const { root } = fixture(t, { ...options, fetch, realDownloads: true })
	t.mock.method(console, 'log', () => {})
	const bot = loadFresh(t, '../dist/bot.js', {
		'node-telegram-bot-api/node': { run: async () => {} },
		'../dist/bot-post-setup.js': { __esModule: true, default: async () => { throw new Error('Unexpected webhook startup') } },
	}).default
	loadFresh(t, '../dist/state/state.waiting-photo.js')
	loadFresh(t, '../dist/state/state.start.js')
	const RealChats = loadFresh(t, '../dist/chats.js').default
	const jobs = []
	const handle = RealChats.prototype.handle
	t.mock.method(RealChats.prototype, 'handle', function (input) {
		const job = handle.call(this, input)
		jobs.push(job)
		return job
	})
	loadFresh(t, '../dist/index.js')
	let updateId = 0
	const send = (input) => bot.handleUpdate({ update_id: ++updateId, message: { date: 0, ...input } })
	return { root, bot, send, jobs, requests, documents }
}

test('real Telegram middleware and transport complete a multi-photo job', async (t) => {
	const context = application(t)
	await context.send(message(7, '/start'))
	await context.send(photo(7, 'one', 2))
	await context.send(photo(7, 'two', 3))
	await context.send(message(7, '/done', 4))
	await Promise.all(context.jobs)
	assert.deepEqual(context.documents, [{ chatId: 7, filename: 'file.pdf', mimeType: 'application/pdf', content: 'one.jpg,two.jpg' }])
	assert.deepEqual(await fs.readdir(context.root), [])
	const welcome = context.requests.find((request) => request.method === 'sendMessage').params
	assert.equal(welcome.parse_mode, 'HTML')
	assert.deepEqual(JSON.parse(welcome.reply_markup).keyboard, [[{ text: '/done' }, { text: '/reset' }]])
	assert.deepEqual(context.requests.filter((request) => request.method === 'getFile').map((request) => request.params.file_id), ['one', 'two'])
})

test('real transport supports another PDF job after the first job is cleaned up', async (t) => {
	const context = application(t)
	await context.send(message(7, '/start'))
	for (const [index, fileId] of ['first', 'second'].entries()) {
		await context.send(photo(7, fileId, index + 2))
		await context.send(message(7, '/done', index + 4))
		await Promise.all(context.jobs)
	}
	assert.deepEqual(context.documents.map((document) => document.content), ['first.jpg', 'second.jpg'])
	assert.deepEqual(await fs.readdir(context.root), [])
})

test('real transport keeps simultaneous private and group PDF jobs separate', async (t) => {
	const context = application(t)
	await Promise.all([context.send(message(7, '/start')), context.send(message(-1001, '/start'))])
	await Promise.all([context.send(photo(7, 'private', 2)), context.send(photo(-1001, 'group', 2))])
	await Promise.all([context.send(message(7, '/done', 3)), context.send(message(-1001, '/done', 3))])
	await Promise.all(context.jobs)
	assert.deepEqual(context.documents.sort((a, b) => a.chatId - b.chatId), [
		{ chatId: -1001, filename: 'file.pdf', mimeType: 'application/pdf', content: 'group.jpg' },
		{ chatId: 7, filename: 'file.pdf', mimeType: 'application/pdf', content: 'private.jpg' },
	])
	assert.deepEqual(await fs.readdir(context.root), [])
})

test('real Telegram update dispatch continues while another chat is delivering a PDF', async (t) => {
	const gate = deferred()
	const delivering = deferred()
	const context = application(t, {
		beforeDelivery: (chatId) => {
			if (chatId === 7) { delivering.resolve(); return gate.promise }
		},
	})
	await context.send(message(7, '/start'))
	await context.send(photo(7, 'first', 2))
	await context.send(message(7, '/done', 3))
	await delivering.promise
	await context.send(message(8, '/start'))
	await context.send(photo(8, 'second', 2))
	await context.send(message(8, '/done', 3))
	// Every job from chat 8 is queued after chat 7's three jobs.
	await Promise.all(context.jobs.slice(3))
	assert.equal(await fs.readFile(path.join(context.root, '7', '2.jpg'), 'utf8'), 'first.jpg')
	assert.equal(context.documents.length, 2)
	gate.resolve()
	await Promise.all(context.jobs)
	assert.deepEqual(await fs.readdir(context.root), [])
})

test('real transport reset deletes old photos and returns to the start prompt', async (t) => {
	const context = application(t)
	await context.send(message(7, '/start'))
	await context.send(photo(7, 'old', 2))
	await context.send(message(7, '/reset', 3))
	await context.send(photo(7, 'too-early', 4))
	await Promise.all(context.jobs)
	await flush()
	assert.deepEqual(await fs.readdir(context.root), [])
	assert.equal(context.documents.length, 0)
	assert.deepEqual(context.requests.filter((request) => request.method === 'getFile').map((request) => request.params.file_id), ['old'])
	assert.match(context.requests.filter((request) => request.method === 'sendMessage').at(-1).params.text, /Use \/start/)
})

test('real middleware ignores non-message updates', async (t) => {
	const context = application(t)
	await context.bot.handleUpdate({ update_id: 1, callback_query: { id: 'callback', data: '/start' } })
	await context.bot.handleUpdate({ update_id: 2, channel_post: { date: 0, ...message(-1001, '/start') } })
	await flush()
	assert.equal(context.jobs.length, 0)
	assert.equal(context.requests.length, 0)
})
