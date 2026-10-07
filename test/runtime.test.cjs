const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
	api, fakeBot, handlers, Chats, fixture, message, deferred, flush, loadFresh, environment,
} = require('./support.cjs')

const TEST_TOKEN = '123:TEST_ONLY_TOKEN'

function runtime(t, options = {}) {
	environment(t, { TOKEN: TEST_TOKEN, WEBHOOK_URL: options.webhook })
	t.mock.method(console, 'log', () => {})
	const construct = t.mock.fn()
	class Bot {
		constructor(token) { construct(token) }
	}
	const run = t.mock.fn(options.run ?? (async () => {}))
	const setup = t.mock.fn(options.setup ?? (async () => {}))
	const module = loadFresh(t, '../dist/bot.js', {
		'node-telegram-bot-api': { Bot },
		'node-telegram-bot-api/node': { run },
		'../dist/bot-post-setup.js': { __esModule: true, default: setup },
	})
	return { module, construct, run, setup }
}

for (const token of [undefined, '']) {
	test(`bot initialization rejects a ${token === undefined ? 'missing' : 'blank'} token`, (t) => {
		environment(t, { TOKEN: token })
		const construct = t.mock.fn()
		assert.throws(() => loadFresh(t, '../dist/bot.js', {
			'node-telegram-bot-api': { Bot: construct },
			'node-telegram-bot-api/node': {},
			'../dist/bot-post-setup.js': { __esModule: true, default: async () => {} },
		}), /Token not found/)
		assert.equal(construct.mock.callCount(), 0)
	})
}

test('bot initialization constructs one client with the configured token', (t) => {
	const { module, construct } = runtime(t)
	assert.ok(module.default)
	assert.equal(construct.mock.callCount(), 1)
	assert.deepEqual(construct.mock.calls[0].arguments, [TEST_TOKEN])
})

for (const [input, encoded] of [
	['photos/file.jpg', 'photos/file.jpg'],
	['photos/my photo.jpg', 'photos/my%20photo.jpg'],
	['photos/猫.png', 'photos/%E7%8C%AB.png'],
	['photos/a?b#c&d%.jpg', 'photos/a%3Fb%23c%26d%25.jpg'],
	['photos/a+b.jpg', 'photos/a%2Bb.jpg'],
	['photos/already%20encoded.jpg', 'photos/already%2520encoded.jpg'],
]) {
	test(`Telegram file URL encodes the path ${input}`, (t) => {
		const { module } = runtime(t)
		assert.equal(module.createTelegramFileUrl(input), `https://api.telegram.org/file/bot${TEST_TOKEN}/${encoded}`)
	})
}

test('Telegram file URLs retain the token captured during initialization', (t) => {
	const { module } = runtime(t)
	process.env.TOKEN = '456:ANOTHER_TEST_TOKEN'
	assert.equal(module.createTelegramFileUrl('photo.jpg'), `https://api.telegram.org/file/bot${TEST_TOKEN}/photo.jpg`)
})

for (const webhook of [undefined, '']) {
	test(`startup uses polling when the webhook URL is ${webhook === undefined ? 'missing' : 'empty'}`, async (t) => {
		const { module, run, setup } = runtime(t, { webhook })
		await module.startBot()
		assert.deepEqual(run.mock.calls[0].arguments, [module.default])
		assert.equal(setup.mock.callCount(), 0)
		assert.equal(console.log.mock.calls[0].arguments[0], 'Bot started.')
	})
}

test('polling startup stays pending until the runner finishes', async (t) => {
	const gate = deferred()
	const { module } = runtime(t, { run: () => gate.promise })
	let finished = false
	const startup = module.startBot().then(() => { finished = true })
	await flush()
	assert.equal(finished, false)
	gate.resolve()
	await startup
	assert.equal(finished, true)
})

test('polling startup propagates runner failures', async (t) => {
	const { module } = runtime(t, { run: async () => { throw new Error('polling failed') } })
	await assert.rejects(module.startBot(), /polling failed/)
})

test('webhook startup receives the bot, token, and configured URL without polling', async (t) => {
	const webhook = 'https://example.invalid/telegram/'
	const { module, run, setup } = runtime(t, { webhook })
	await module.startBot()
	assert.deepEqual(setup.mock.calls[0].arguments, [module.default, TEST_TOKEN, webhook])
	assert.equal(run.mock.callCount(), 0)
	assert.equal(console.log.mock.callCount(), 0)
})

test('webhook startup stays pending until server setup finishes', async (t) => {
	const gate = deferred()
	const { module } = runtime(t, { webhook: 'https://example.invalid', setup: () => gate.promise })
	let finished = false
	const startup = module.startBot().then(() => { finished = true })
	await flush()
	assert.equal(finished, false)
	gate.resolve()
	await startup
})

test('webhook startup propagates setup failures', async (t) => {
	const { module } = runtime(t, {
		webhook: 'https://example.invalid',
		setup: async () => { throw new Error('webhook failed') },
	})
	await assert.rejects(module.startBot(), /webhook failed/)
})

function entrypoint(t, startup = async () => {}) {
	fixture(t)
	t.mock.method(console, 'error', () => {})
	const originalExitCode = process.exitCode
	t.after(() => { process.exitCode = originalExitCode })
	const startBot = t.mock.fn(startup)
	loadFresh(t, '../dist/index.js', { '../dist/bot.js': { ...fakeBot, startBot } })
	return { handle: handlers.get('message'), startBot }
}

test('entrypoint registers one message handler and starts the bot once', async (t) => {
	const { handle, startBot } = entrypoint(t)
	assert.equal(typeof handle, 'function')
	assert.equal(startBot.mock.callCount(), 1)
	await flush()
	assert.equal(console.error.mock.callCount(), 0)
})

test('entrypoint ignores updates without a message', (t) => {
	const { handle } = entrypoint(t)
	t.mock.method(Chats.prototype, 'handle', async () => {})
	assert.equal(handle({}), undefined)
	assert.equal(Chats.prototype.handle.mock.callCount(), 0)
})

test('entrypoint sends the exact message object to the chat dispatcher', async (t) => {
	const { handle } = entrypoint(t)
	t.mock.method(Chats.prototype, 'handle', async () => {})
	const input = message(-1001, '/start')
	assert.equal(handle({ message: input }), undefined)
	await flush()
	assert.equal(Chats.prototype.handle.mock.calls[0].arguments[0], input)
})

test('entrypoint catches rejected chat jobs and redacts every token occurrence', async (t) => {
	environment(t, { TOKEN: TEST_TOKEN })
	const { handle } = entrypoint(t)
	t.mock.method(Chats.prototype, 'handle', async () => {
		throw new Error(`failure ${TEST_TOKEN} repeated ${TEST_TOKEN}`)
	})
	handle({ message: message(1, '/done') })
	await flush()
	assert.deepEqual(console.error.mock.calls[0].arguments, ['failure [redacted] repeated [redacted]'])
})

for (const token of [undefined, '']) {
	test(`entrypoint logs ordinary chat errors with ${token === undefined ? 'no' : 'an empty'} token`, async (t) => {
		environment(t, { TOKEN: token })
		const { handle } = entrypoint(t)
		t.mock.method(Chats.prototype, 'handle', async () => { throw new Error('ordinary failure') })
		handle({ message: message(1, '/done') })
		await flush()
		assert.deepEqual(console.error.mock.calls[0].arguments, ['ordinary failure'])
	})
}

test('entrypoint uses a safe fallback when a chat rejects with a non-Error value', async (t) => {
	const { handle } = entrypoint(t)
	t.mock.method(Chats.prototype, 'handle', async () => { throw 'TEST_ONLY_PRIVATE_VALUE' })
	handle({ message: message(1, '/done') })
	await flush()
	assert.deepEqual(console.error.mock.calls[0].arguments, ['Error handling chat message.'])
})

test('entrypoint logs startup failures, redacts the token, and sets a failing exit code', async (t) => {
	environment(t, { TOKEN: TEST_TOKEN })
	entrypoint(t, async () => { throw new Error(`startup failed for ${TEST_TOKEN}`) })
	await flush()
	assert.deepEqual(console.error.mock.calls[0].arguments, ['startup failed for [redacted]'])
	assert.equal(process.exitCode, 1)
})

test('entrypoint uses a safe fallback when startup rejects with a non-Error value', async (t) => {
	entrypoint(t, async () => { throw { secret: 'TEST_ONLY_PRIVATE_VALUE' } })
	await flush()
	assert.deepEqual(console.error.mock.calls[0].arguments, ['Bot stopped due to an error.'])
	assert.equal(process.exitCode, 1)
})

test('entrypoint continues dispatching after an earlier chat job fails', async (t) => {
	const { handle } = entrypoint(t)
	t.mock.method(Chats.prototype, 'handle', async (msg) => {
		if (msg.chat.id === 1) throw new Error('first failed')
	})
	handle({ message: message(1, '/done') })
	await flush()
	handle({ message: message(2, '/start') })
	await flush()
	assert.equal(Chats.prototype.handle.mock.callCount(), 2)
	assert.equal(console.error.mock.callCount(), 1)
	assert.equal(api.getFile.mock.callCount(), 0)
})
