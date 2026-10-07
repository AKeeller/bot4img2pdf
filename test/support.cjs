const fs = require('node:fs/promises')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const childProcess = require('node:child_process')

// All state tests share one fake client. Production startup is tested separately
// with scoped module overrides, so these tests never read a real bot token.
const handlers = new Map()
const api = {
	sendMessage: async () => {},
	sendChatAction: async () => {},
	sendDocument: async () => {},
	getFile: async ({ file_id }) => ({ file_path: file_id }),
}
const fakeBot = {
	__esModule: true,
	default: { api, on: (event, handler) => handlers.set(event, handler) },
	createTelegramFileUrl: (filePath) => `https://example.invalid/${filePath}`,
	startBot: async () => {},
}
const botPath = require.resolve('../dist/bot.js')
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot }

const Chats = require('../dist/chats.js').default
const WaitingPhoto = require('../dist/state/state.waiting-photo.js').default
const StartState = require('../dist/state/state.start.js').StartState
const Files = require('../dist/files.js')

function deferred() {
	let resolve
	let reject
	const promise = new Promise((yes, no) => { resolve = yes; reject = no })
	return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const message = (chatId, text, messageId = 1) => ({
	chat: { id: chatId, type: 'private' }, message_id: messageId, text,
})
const photo = (chatId, fileId, messageId = 1) => ({
	...message(chatId, undefined, messageId),
	photo: [{ file_id: fileId, width: 1, height: 1, file_size: 1 }],
})

function fixture(t, options = {}) {
	const root = mkdtempSync(path.join(tmpdir(), 'bot-test-'))
	t.after(() => fs.rm(root, { recursive: true, force: true }))
	t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request in state test') })
	t.mock.method(Files, 'getTmp', () => root)
	t.mock.method(api, 'sendMessage', async () => {})
	t.mock.method(api, 'sendChatAction', async () => {})
	t.mock.method(api, 'getFile', async ({ file_id }) => ({ file_path: file_id }))
	t.mock.method(Files, 'downloadFromUrl', async (url, destination) => {
		const fileId = new URL(url).pathname.slice(1)
		await options.beforeDownload?.(fileId)
		await fs.writeFile(destination, fileId)
	})
	t.mock.method(childProcess, 'exec', (command, _options, callback) => {
		// Emulate img2pdf file selection; this does not test the converter itself.
		const folder = command.slice('img2pdf '.length, -'/*.jpg'.length)
		void (async () => {
			await options.beforeConvert?.(folder)
			const names = (await fs.readdir(folder)).filter((name) => name.endsWith('.jpg')).sort()
			const contents = await Promise.all(names.map((name) => fs.readFile(path.join(folder, name), 'utf8')))
			callback(null, Buffer.from(contents.join(',')))
		})().catch((error) => callback(error))
	})
	const documents = []
	t.mock.method(api, 'sendDocument', async (document) => {
		documents.push({ chatId: document.chat_id, content: document.document.data.toString() })
		await options.beforeDelivery?.(document.chat_id)
	})
	const deleteFolder = Files.deleteFolder
	t.mock.method(Files, 'deleteFolder', async (folder) => {
		await options.beforeCleanup?.(folder)
		await deleteFolder(folder)
	})
	return { root, documents, chats: new Chats() }
}

// Reload an entrypoint under scoped dependency stubs, then restore every cache
// entry. Unlike a global require hook, this leaves unrelated modules untouched.
function loadFresh(t, filename, overrides = {}) {
	const target = require.resolve(filename)
	const entries = new Map([[target, require.cache[target]]])
	for (const [name, exports] of Object.entries(overrides)) {
		const id = require.resolve(name)
		entries.set(id, require.cache[id])
		require.cache[id] = { id, filename: id, loaded: true, exports }
	}
	t.after(() => {
		for (const [id, entry] of entries) {
			if (entry) require.cache[id] = entry
			else delete require.cache[id]
		}
	})
	delete require.cache[target]
	return require(target)
}

function environment(t, values) {
	const original = new Map()
	for (const [name, value] of Object.entries(values)) {
		original.set(name, process.env[name])
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
	t.after(() => {
		for (const [name, value] of original) {
			if (value === undefined) delete process.env[name]
			else process.env[name] = value
		}
	})
}

module.exports = {
	api, fakeBot, handlers, Chats, WaitingPhoto, StartState, Files,
	deferred, flush, message, photo, fixture, loadFresh, environment,
}
