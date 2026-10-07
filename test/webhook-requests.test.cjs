const assert = require('node:assert/strict')
const { test } = require('node:test')
const { Readable } = require('node:stream')
const { createWebhookServer } = require('node-telegram-bot-api/node')
const { environment, loadFresh, deferred } = require('./support.cjs')

const TEST_TOKEN = '123:TEST_ONLY_ROUTE_TOKEN'
const WEBHOOK_PATH = `/bot${TEST_TOKEN}`

async function endpoint(t, handleUpdate = async () => {}) {
	environment(t, { CERT: undefined, KEY: undefined })
	const ready = deferred()
	t.mock.method(console, 'log', () => ready.resolve())
	const bot = { handleUpdate: t.mock.fn(handleUpdate), api: { setWebhook: t.mock.fn(async () => {}) } }
	let adapter
	const setup = loadFresh(t, '../dist/bot-post-setup.js', {
		'node-telegram-bot-api/node': {
			createWebhookServer: (client, options) => {
				// Keep the library's real request handling. Simulate only listening
				// and closing so the test needs no port, socket, or network permission.
				adapter = createWebhookServer(client, options)
				t.mock.method(adapter, 'listen', (_port, callback) => { queueMicrotask(callback); return adapter })
				t.mock.method(adapter, 'close', (callback) => {
					queueMicrotask(() => { adapter.emit('close'); callback?.() })
					return adapter
				})
				return adapter
			},
			fromPath: async () => { throw new Error('Unexpected certificate upload') },
		},
	}).default
	const lifetime = setup(bot, TEST_TOKEN, 'https://example.invalid')
	t.after(async () => {
		adapter.emit('close')
		await lifetime
	})
	await ready.promise
	const request = async (url, body, stream = false) => {
		const finished = deferred()
		const req = stream
			? Readable.from([Buffer.from(body.slice(0, 5)), Buffer.from(body.slice(5))])
			: { body }
		Object.assign(req, { url, method: 'POST', headers: { 'content-type': 'application/json' } })
		const res = { statusCode: 200, end: (text) => finished.resolve({ status: res.statusCode, body: text }) }
		adapter.emit('request', req, res)
		return finished.promise
	}
	return { request, bot }
}

for (const suffix of ['', '?retry=1']) {
	test(`configured webhook route${suffix ? ' with a query string' : ''} accepts valid Telegram updates`, async (t) => {
		const { request, bot } = await endpoint(t)
		const update = { update_id: 1, message: { message_id: 2, date: 0, chat: { id: 7, type: 'private' }, text: '/start' } }
		const response = await request(WEBHOOK_PATH + suffix, JSON.stringify(update))
		assert.equal(response.status, 200)
		assert.deepEqual(bot.handleUpdate.mock.calls[0].arguments, [update])
		assert.deepEqual(bot.api.setWebhook.mock.calls[0].arguments, [{ url: `https://example.invalid${WEBHOOK_PATH}` }])
	})
}

for (const url of ['/', '/botOTHER_TEST_TOKEN', `${WEBHOOK_PATH}/extra`, `${WEBHOOK_PATH}/`]) {
	test(`webhook rejects the unmatched route ${url}`, async (t) => {
		const { request, bot } = await endpoint(t)
		assert.deepEqual(await request(url, '{}'), { status: 404, body: 'Not Found' })
		assert.equal(bot.handleUpdate.mock.callCount(), 0)
	})
}

test('configured webhook rejects malformed JSON before dispatching an update', async (t) => {
	const { request, bot } = await endpoint(t)
	assert.deepEqual(await request(WEBHOOK_PATH, '{invalid json'), { status: 400, body: 'Bad Request' })
	assert.equal(bot.handleUpdate.mock.callCount(), 0)
})

test('configured webhook reads JSON arriving in multiple request-stream chunks', async (t) => {
	const { request, bot } = await endpoint(t)
	const update = { update_id: 123, message: { text: '猫 👋' } }
	assert.equal((await request(WEBHOOK_PATH, JSON.stringify(update), true)).status, 200)
	assert.deepEqual(bot.handleUpdate.mock.calls[0].arguments, [update])
})

test('configured webhook accepts an update that a JSON body parser already decoded', async (t) => {
	const { request, bot } = await endpoint(t)
	const update = { update_id: 123 }
	assert.equal((await request(WEBHOOK_PATH, update)).status, 200)
	assert.deepEqual(bot.handleUpdate.mock.calls[0].arguments, [update])
})

test('configured webhook reports failed update handling as HTTP 500', async (t) => {
	const { request } = await endpoint(t, async () => { throw new Error('update handling failed') })
	assert.deepEqual(await request(WEBHOOK_PATH, '{"update_id":1}'), { status: 500, body: 'Internal Server Error' })
})

test('configured webhook waits for update middleware before responding', async (t) => {
	const gate = deferred()
	const handling = deferred()
	const { request } = await endpoint(t, async () => { handling.resolve(); await gate.promise })
	let responded = false
	const response = request(WEBHOOK_PATH, '{"update_id":1}').then((value) => { responded = true; return value })
	await handling.promise
	assert.equal(responded, false)
	gate.resolve()
	assert.equal((await response).status, 200)
})
