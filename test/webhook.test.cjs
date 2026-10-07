const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const https = require('node:https')
const { deferred, loadFresh, environment } = require('./support.cjs')

const TEST_TOKEN = '123:TEST_ONLY_WEBHOOK_TOKEN'

function server(t, options = {}) {
	const result = new EventEmitter()
	result.listen = t.mock.fn((port, callback) => {
		queueMicrotask(() => options.listenError ? result.emit('error', options.listenError) : callback())
		return result
	})
	result.close = t.mock.fn((callback) => {
		queueMicrotask(() => {
			if (!options.closeError) result.emit('close')
			callback?.(options.closeError)
		})
		return result
	})
	return result
}

function webhook(t, options = {}) {
	environment(t, { CERT: options.cert, KEY: options.key })
	const ready = deferred()
	t.mock.method(console, 'log', () => ready.resolve())
	const adapter = server(t, options)
	const tls = server(t, options)
	const createWebhookServer = t.mock.fn(() => adapter)
	const fromPath = t.mock.fn(options.fromPath ?? (async () => ({ uploadedCertificate: true })))
	const setWebhook = t.mock.fn(options.register ?? (async () => {}))
	const bot = { api: { setWebhook } }
	t.mock.method(fs, 'readFile', options.readFile ?? (async (filename) => Buffer.from(filename)))
	t.mock.method(https, 'createServer', () => tls)

	// Capture signal callbacks instead of emitting real process signals in tests.
	const signals = new Map()
	const once = process.once
	const off = process.off
	t.mock.method(process, 'once', function (event, listener) {
		if (event === 'SIGINT' || event === 'SIGTERM') {
			signals.set(event, listener)
			return this
		}
		return once.call(this, event, listener)
	})
	t.mock.method(process, 'off', function (event, listener) {
		if (event === 'SIGINT' || event === 'SIGTERM') {
			if (signals.get(event) === listener) signals.delete(event)
			return this
		}
		return off.call(this, event, listener)
	})
	const setup = loadFresh(t, '../dist/bot-post-setup.js', {
		'node-telegram-bot-api/node': { createWebhookServer, fromPath },
	}).default
	return { setup, bot, adapter, tls, signals, ready, createWebhookServer, fromPath, setWebhook }
}

test('webhook configuration rejects KEY without CERT before creating a server', async (t) => {
	const context = webhook(t, { key: 'private.pem' })
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /CERT must be set/)
	assert.equal(context.createWebhookServer.mock.callCount(), 0)
	assert.equal(context.setWebhook.mock.callCount(), 0)
})

for (const [base, expected] of [
	['https://example.invalid', 'https://example.invalid'],
	['https://example.invalid/', 'https://example.invalid'],
	['https://example.invalid///', 'https://example.invalid'],
	['https://example.invalid:8443/telegram/', 'https://example.invalid:8443/telegram'],
]) {
	test(`webhook registration normalizes the base URL ${base}`, async (t) => {
		const context = webhook(t)
		const work = context.setup(context.bot, TEST_TOKEN, base)
		await context.ready.promise
		assert.deepEqual(context.setWebhook.mock.calls[0].arguments[0], { url: `${expected}/bot${TEST_TOKEN}` })
		context.adapter.close()
		await work
	})
}

test('plain webhook listens on port 8443 and mounts the bot token path', async (t) => {
	const context = webhook(t)
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	await context.ready.promise
	assert.deepEqual(context.createWebhookServer.mock.calls[0].arguments, [
		context.bot, { path: `/bot${TEST_TOKEN}`, allowUnauthenticated: true },
	])
	assert.equal(context.adapter.listen.mock.calls[0].arguments[0], 8443)
	assert.equal(context.adapter.listenerCount('error'), 1)
	assert.equal(https.createServer.mock.callCount(), 0)
	assert.equal(fs.readFile.mock.callCount(), 0)
	assert.equal(context.fromPath.mock.callCount(), 0)
	context.adapter.close()
	await work
	assert.equal(context.signals.size, 0)
})

test('webhook registration starts only after the listener is ready', async (t) => {
	const context = webhook(t)
	let listening
	t.mock.method(context.adapter, 'listen', (_port, callback) => { listening = callback })
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	assert.equal(context.setWebhook.mock.callCount(), 0)
	listening()
	await context.ready.promise
	assert.equal(context.setWebhook.mock.callCount(), 1)
	context.adapter.close()
	await work
})

test('CERT without KEY uploads a certificate while using the plain adapter', async (t) => {
	const context = webhook(t, { cert: 'public.pem' })
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	await context.ready.promise
	assert.deepEqual(context.fromPath.mock.calls[0].arguments, ['public.pem'])
	assert.deepEqual(context.setWebhook.mock.calls[0].arguments[0].certificate, { uploadedCertificate: true })
	assert.equal(https.createServer.mock.callCount(), 0)
	assert.equal(fs.readFile.mock.callCount(), 0)
	context.adapter.close()
	await work
})

test('CERT and KEY create an HTTPS server with the loaded certificate bytes', async (t) => {
	const context = webhook(t, { cert: 'public.pem', key: 'private.pem' })
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	await context.ready.promise
	assert.deepEqual(fs.readFile.mock.calls.map((call) => call.arguments[0]), ['public.pem', 'private.pem'])
	assert.deepEqual(https.createServer.mock.calls[0].arguments[0], {
		cert: Buffer.from('public.pem'), key: Buffer.from('private.pem'),
	})
	assert.equal(context.tls.listen.mock.calls[0].arguments[0], 8443)
	assert.equal(context.adapter.listen.mock.callCount(), 0)
	assert.ok(context.setWebhook.mock.calls[0].arguments[0].certificate)
	context.tls.close()
	await work
})

test('HTTPS request forwarding preserves the request and response objects', async (t) => {
	const context = webhook(t, { cert: 'public.pem', key: 'private.pem' })
	const request = { method: 'POST', url: `/bot${TEST_TOKEN}` }
	const response = { end: t.mock.fn() }
	const receive = t.mock.fn()
	context.adapter.on('request', receive)
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	await context.ready.promise
	const forward = https.createServer.mock.calls[0].arguments[1]
	forward(request, response)
	assert.deepEqual(receive.mock.calls[0].arguments, [request, response])
	context.tls.close()
	await work
})

for (const failingPath of ['public.pem', 'private.pem']) {
	test(`failure to read ${failingPath} rejects HTTPS startup before listening`, async (t) => {
		const context = webhook(t, {
			cert: 'public.pem', key: 'private.pem',
			readFile: async (filename) => {
				if (filename === failingPath) throw new Error('cannot read TLS file')
				return Buffer.from(filename)
			},
		})
		await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /cannot read TLS file/)
		assert.equal(context.setWebhook.mock.callCount(), 0)
		assert.equal(context.adapter.listen.mock.callCount(), 0)
		assert.equal(context.tls.listen.mock.callCount(), 0)
	})
}

test('HTTPS server construction failures reject startup before registration', async (t) => {
	const context = webhook(t, { cert: 'public.pem', key: 'private.pem' })
	t.mock.method(https, 'createServer', () => { throw new Error('invalid TLS certificate') })
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /invalid TLS certificate/)
	assert.equal(context.setWebhook.mock.callCount(), 0)
})

for (const tls of [false, true]) {
	test(`${tls ? 'HTTPS' : 'plain'} listener failures reject without webhook registration`, async (t) => {
		const error = new Error('port in use')
		const context = webhook(t, {
			listenError: error,
			...(tls ? { cert: 'public.pem', key: 'private.pem' } : {}),
		})
		await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), error)
		assert.equal(context.setWebhook.mock.callCount(), 0)
		assert.equal(context.signals.size, 0)
	})
}

test('failed webhook registration closes the server and hides the original token-bearing error', async (t) => {
	const context = webhook(t, {
		register: async () => { throw new Error(`request failed for ${TEST_TOKEN}`) },
	})
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), (error) => {
		assert.equal(error.message, 'Failed to register the Telegram webhook.')
		assert.doesNotMatch(error.stack, /TEST_ONLY_WEBHOOK_TOKEN/)
		return true
	})
	assert.equal(context.adapter.close.mock.callCount(), 1)
	assert.equal(context.signals.size, 0)
})

test('certificate upload failures close the listening server before rejecting', async (t) => {
	const context = webhook(t, {
		cert: 'public.pem',
		fromPath: async () => { throw new Error('cannot upload certificate') },
	})
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /Failed to register/)
	assert.equal(context.adapter.close.mock.callCount(), 1)
	assert.equal(context.setWebhook.mock.callCount(), 0)
})

test('failed HTTPS registration closes the HTTPS server rather than its adapter', async (t) => {
	const context = webhook(t, {
		cert: 'public.pem', key: 'private.pem',
		register: async () => { throw new Error('registration failed') },
	})
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /Failed to register/)
	assert.equal(context.tls.close.mock.callCount(), 1)
	assert.equal(context.adapter.close.mock.callCount(), 0)
})

test('close failures during rejected registration propagate to the caller', async (t) => {
	const context = webhook(t, {
		register: async () => { throw new Error('registration failed') },
		closeError: new Error('server close failed'),
	})
	await assert.rejects(context.setup(context.bot, TEST_TOKEN, 'https://example.invalid'), /server close failed/)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
	for (const tls of [false, true]) {
		test(`${signal} shuts down the ${tls ? 'HTTPS' : 'plain'} webhook and removes signal handlers`, async (t) => {
			const context = webhook(t, tls ? { cert: 'public.pem', key: 'private.pem' } : {})
			const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
			await context.ready.promise
			assert.equal(context.signals.size, 2)
			context.signals.get(signal)()
			await work
			assert.equal((tls ? context.tls : context.adapter).close.mock.callCount(), 1)
			assert.equal(context.signals.size, 0)
		})
	}
}

test('runtime webhook server errors reject the pending startup promise', async (t) => {
	const context = webhook(t)
	const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
	const rejection = assert.rejects(work, /server runtime failure/)
	await context.ready.promise
	context.adapter.emit('error', new Error('server runtime failure'))
	await rejection
	context.adapter.close()
	await new Promise((resolve) => queueMicrotask(resolve))
	assert.equal(context.signals.size, 0)
})

test('successive webhook lifetimes do not retain signal handlers', async (t) => {
	const context = webhook(t)
	for (let i = 0; i < 3; i++) {
		const work = context.setup(context.bot, TEST_TOKEN, 'https://example.invalid')
		// Wait for each registration's own completion, not a timer.
		await new Promise((resolve) => {
			const original = console.log
			console.log = (...args) => { console.log = original; original(...args); resolve() }
		})
		assert.equal(context.signals.size, 2)
		context.adapter.close()
		await work
		assert.equal(context.signals.size, 0)
	}
})
