const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const syncFs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { Files, loadFresh, deferred } = require('./support.cjs')

function directory(t) {
	const root = syncFs.mkdtempSync(path.join(tmpdir(), 'files-test-'))
	t.after(() => fs.rm(root, { recursive: true, force: true }))
	return root
}

test('getTmp creates an existing directory and reuses it for that module lifetime', async (t) => {
	const files = loadFresh(t, '../dist/files.js')
	const first = files.getTmp()
	t.after(() => fs.rm(first, { recursive: true, force: true }))
	assert.equal(files.getTmp(), first)
	assert.ok((await fs.stat(first)).isDirectory())
	assert.equal(path.dirname(first), tmpdir())
	assert.match(path.basename(first), /^bot4img2pdf-/)
})

test('separate module lifetimes use distinct temporary roots', async (t) => {
	const first = loadFresh(t, '../dist/files.js').getTmp()
	const second = loadFresh(t, '../dist/files.js').getTmp()
	t.after(() => Promise.all([first, second].map((folder) => fs.rm(folder, { recursive: true, force: true }))))
	assert.notEqual(first, second)
})

test('failed temporary directory creation can be retried', async (t) => {
	const files = loadFresh(t, '../dist/files.js')
	const original = syncFs.mkdtempSync
	let fail = true
	t.mock.method(syncFs, 'mkdtempSync', (...args) => {
		if (fail) throw new Error('temporary storage unavailable')
		return original(...args)
	})
	assert.throws(() => files.getTmp(), /temporary storage unavailable/)
	fail = false
	const root = files.getTmp()
	t.after(() => fs.rm(root, { recursive: true, force: true }))
	assert.ok((await fs.stat(root)).isDirectory())
})

test('createFolder recursively creates nested directories and is idempotent', async (t) => {
	const nested = path.join(directory(t), 'chat', 'job')
	await Files.createFolder(nested)
	await Files.createFolder(nested + path.sep)
	assert.ok((await fs.stat(nested)).isDirectory())
})

test('createFolder rejects when a path component is a file', async (t) => {
	const file = path.join(directory(t), 'file')
	await fs.writeFile(file, 'keep')
	await assert.rejects(Files.createFolder(path.join(file, 'job')))
	assert.equal(await fs.readFile(file, 'utf8'), 'keep')
})

test('deleteFolder recursively removes its contents without touching siblings', async (t) => {
	const root = directory(t)
	const job = path.join(root, 'job')
	await fs.mkdir(path.join(job, 'nested'), { recursive: true })
	await fs.writeFile(path.join(job, 'nested', 'photo.jpg'), 'remove')
	await fs.writeFile(path.join(root, 'neighbor.jpg'), 'keep')
	await Files.deleteFolder(job)
	await assert.rejects(fs.stat(job), { code: 'ENOENT' })
	assert.equal(await fs.readFile(path.join(root, 'neighbor.jpg'), 'utf8'), 'keep')
})

test('deleteFolder succeeds when the target is missing or already deleted', async (t) => {
	const folder = path.join(directory(t), 'missing')
	await Files.deleteFolder(folder)
	await Files.deleteFolder(folder)
})

for (const kind of ['missing', 'empty', 'file', 'subdirectory']) {
	test(`isEmpty classifies a ${kind} directory correctly`, async (t) => {
		const folder = path.join(directory(t), 'chat')
		if (kind !== 'missing') await fs.mkdir(folder)
		if (kind === 'file') await fs.writeFile(path.join(folder, 'photo.jpg'), 'image')
		if (kind === 'subdirectory') await fs.mkdir(path.join(folder, 'nested'))
		assert.equal(await Files.isEmpty(folder), kind === 'missing' || kind === 'empty')
	})
}

test('isEmpty propagates filesystem inspection errors', async (t) => {
	const folder = directory(t)
	t.mock.method(fs, 'readdir', async () => { throw new Error('permission denied') })
	await assert.rejects(Files.isEmpty(folder), /permission denied/)
})

for (const bytes of [Buffer.from([0, 255, 137, 80, 78, 71, 0, 10]), Buffer.alloc(0)]) {
	test(`downloadFromUrl preserves ${bytes.length ? 'binary' : 'empty'} response bytes`, async (t) => {
		const destination = path.join(directory(t), 'photo.jpg')
		t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
		await Files.downloadFromUrl('https://example.invalid/image', destination)
		assert.deepEqual(await fs.readFile(destination), bytes)
		assert.deepEqual(globalThis.fetch.mock.calls[0].arguments, ['https://example.invalid/image'])
	})
}

test('a successful download replaces the destination contents completely', async (t) => {
	const destination = path.join(directory(t), 'photo.jpg')
	await fs.writeFile(destination, 'old long content')
	t.mock.method(globalThis, 'fetch', async () => new Response('new'))
	await Files.downloadFromUrl('https://example.invalid/image', destination)
	assert.equal(await fs.readFile(destination, 'utf8'), 'new')
})

for (const status of [400, 403, 404, 429, 500, 503]) {
	test(`HTTP ${status} rejects the download and removes its destination`, async (t) => {
		const destination = path.join(directory(t), 'photo.jpg')
		await fs.writeFile(destination, 'stale bytes')
		const arrayBuffer = t.mock.fn(async () => new ArrayBuffer(0))
		t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status, arrayBuffer }))
		await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), {
			message: 'Failed to download the Telegram file.',
		})
		assert.equal(arrayBuffer.mock.callCount(), 0)
		await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
	})
}

for (const exists of [false, true]) {
	test(`network failure cleans up a ${exists ? 'preexisting' : 'missing'} destination`, async (t) => {
		const destination = path.join(directory(t), 'photo.jpg')
		if (exists) await fs.writeFile(destination, 'stale bytes')
		t.mock.method(globalThis, 'fetch', async () => { throw new Error('network disconnected') })
		await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), /Failed to download/)
		await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
	})
}

test('response body failures remove stale files', async (t) => {
	const destination = path.join(directory(t), 'photo.jpg')
	await fs.writeFile(destination, 'stale')
	t.mock.method(globalThis, 'fetch', async () => ({
		ok: true, arrayBuffer: async () => { throw new Error('body interrupted') },
	}))
	await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), /Failed to download/)
	await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
})

test('download rejects when the destination parent does not exist', async (t) => {
	const destination = path.join(directory(t), 'missing', 'photo.jpg')
	t.mock.method(globalThis, 'fetch', async () => new Response('bytes'))
	await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), /Failed to download/)
	await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
})

test('a partially written download is removed when the write fails', async (t) => {
	const destination = path.join(directory(t), 'photo.jpg')
	const writeFile = fs.writeFile
	t.mock.method(globalThis, 'fetch', async () => new Response('complete bytes'))
	t.mock.method(fs, 'writeFile', async (filename) => {
		await writeFile(filename, 'partial bytes')
		throw new Error('disk full')
	})
	await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), /Failed to download/)
	await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
})

test('download errors do not expose URLs or credentials from fetch failures', async (t) => {
	const destination = path.join(directory(t), 'photo.jpg')
	const url = 'https://example.invalid/botTEST_ONLY_SECRET/image'
	t.mock.method(globalThis, 'fetch', async () => { throw new Error(`Failed request: ${url}`) })
	await assert.rejects(Files.downloadFromUrl(url, destination), (error) => {
		assert.equal(error.message, 'Failed to download the Telegram file.')
		assert.doesNotMatch(error.stack, /TEST_ONLY_SECRET/)
		return true
	})
})

test('concurrent downloads finish independently and do not overwrite each other', async (t) => {
	const root = directory(t)
	const gate = deferred()
	t.mock.method(globalThis, 'fetch', async (url) => {
		if (url.endsWith('/slow')) await gate.promise
		return new Response(url.endsWith('/slow') ? 'slow bytes' : 'fast bytes')
	})
	const slow = Files.downloadFromUrl('https://example.invalid/slow', path.join(root, 'slow.jpg'))
	await Files.downloadFromUrl('https://example.invalid/fast', path.join(root, 'fast.jpg'))
	assert.equal(await fs.readFile(path.join(root, 'fast.jpg'), 'utf8'), 'fast bytes')
	gate.resolve()
	await slow
	assert.equal(await fs.readFile(path.join(root, 'slow.jpg'), 'utf8'), 'slow bytes')
})

test('a failed download leaves another destination untouched', async (t) => {
	const root = directory(t)
	const neighbor = path.join(root, 'keep.jpg')
	await fs.writeFile(neighbor, 'keep')
	t.mock.method(globalThis, 'fetch', async () => new Response('failure', { status: 500 }))
	await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', path.join(root, 'broken.jpg')))
	assert.equal(await fs.readFile(neighbor, 'utf8'), 'keep')
})

test('failed destination cleanup propagates the filesystem failure', async (t) => {
	const destination = path.join(directory(t), 'photo.jpg')
	await fs.writeFile(destination, 'stale')
	const remove = fs.rm
	t.mock.method(globalThis, 'fetch', async () => { throw new Error('network failure') })
	t.mock.method(fs, 'rm', async (target, options) => {
		if (target === destination) throw new Error('cannot remove destination')
		return remove(target, options)
	})
	await assert.rejects(Files.downloadFromUrl('https://example.invalid/image', destination), /cannot remove destination/)
})
