const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const { mkdtempSync } = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const childProcess = require('node:child_process')
const { convertImagesToPdf } = require('../dist/pdf.js')
const { api, fixture, message, photo, flush } = require('./support.cjs')

const nativeExecFile = childProcess.execFile

function directory(t) {
	const root = mkdtempSync(path.join(tmpdir(), 'pdf-test-'))
	t.after(() => fs.rm(root, { recursive: true, force: true }))
	return root
}

function converter(t, implementation = (_file, _args, _options, callback) => callback(null, Buffer.from('PDF bytes'))) {
	t.mock.method(childProcess, 'exec', () => { throw new Error('Conversion must not invoke a shell') })
	return t.mock.method(childProcess, 'execFile', implementation)
}

test('conversion passes explicit absolute paths after an option terminator', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'one')
	await fs.writeFile(path.join(folder, '2.jpg'), 'two')
	const execute = converter(t)
	const pdf = await convertImagesToPdf(folder)
	assert.deepEqual(pdf, Buffer.from('PDF bytes'))
	assert.equal(execute.mock.callCount(), 1)
	assert.deepEqual(execute.mock.calls[0].arguments.slice(0, 3), [
		'img2pdf', ['--', path.join(folder, '1.jpg'), path.join(folder, '2.jpg')],
		{ encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, shell: false },
	])
	assert.equal(childProcess.exec.mock.callCount(), 0)
})

test('conversion resolves relative folders to absolute image arguments', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'one')
	const execute = converter(t)
	await convertImagesToPdf(path.relative(process.cwd(), folder))
	const args = execute.mock.calls[0].arguments[1]
	assert.deepEqual(args, ['--', path.join(folder, '1.jpg')])
	assert.ok(path.isAbsolute(args[1]))
})

test('conversion preserves lexicographic filename order without relying on filesystem order', async (t) => {
	const folder = directory(t)
	for (const name of ['2.jpg', '10.jpg', '1.jpg']) await fs.writeFile(path.join(folder, name), name)
	const execute = converter(t)
	await convertImagesToPdf(folder)
	assert.deepEqual(execute.mock.calls[0].arguments[1], [
		'--', ...['1.jpg', '10.jpg', '2.jpg'].map((name) => path.join(folder, name)),
	])
})

for (const name of [
	'photo with spaces.jpg',
	'photo;echo injected.jpg',
	'photo & echo injected.jpg',
	'$(echo injected).jpg',
	'`echo injected`.jpg',
	"photo 'quoted'.jpg",
	'-option.jpg',
	'猫.jpg',
]) {
	test(`conversion passes the filename ${name} literally`, async (t) => {
		const folder = directory(t)
		await fs.writeFile(path.join(folder, name), 'image')
		const execute = converter(t)
		await convertImagesToPdf(folder)
		assert.deepEqual(execute.mock.calls[0].arguments[1], ['--', path.join(folder, name)])
		assert.equal(execute.mock.calls[0].arguments[2].shell, false)
	})
}

test('conversion ignores unrelated file extensions and directories named like images', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, 'photo.jpg'), 'image')
	for (const name of ['notes.txt', 'old.pdf', 'photo.jpeg', 'photo.png', 'photo.JPG']) {
		await fs.writeFile(path.join(folder, name), 'ignore')
	}
	await fs.mkdir(path.join(folder, 'directory.jpg'))
	const execute = converter(t)
	await convertImagesToPdf(folder)
	assert.deepEqual(execute.mock.calls[0].arguments[1], ['--', path.join(folder, 'photo.jpg')])
})

test('conversion excludes nonregular image entries such as symlinks', async (t) => {
	const folder = directory(t)
	t.mock.method(fs, 'readdir', async () => [
		{ name: 'file.jpg', isFile: () => true },
		{ name: 'link.jpg', isFile: () => false },
		{ name: 'directory.jpg', isFile: () => false },
	])
	const execute = converter(t)
	await convertImagesToPdf(folder)
	assert.deepEqual(execute.mock.calls[0].arguments[1], ['--', path.join(folder, 'file.jpg')])
})

for (const contents of [[], ['notes.txt'], ['directory.jpg']]) {
	test(`conversion rejects a folder without JPEG files (${contents.join(',') || 'empty'})`, async (t) => {
		const folder = directory(t)
		for (const name of contents) {
			if (name.endsWith('.jpg')) await fs.mkdir(path.join(folder, name))
			else await fs.writeFile(path.join(folder, name), 'ignore')
		}
		const execute = converter(t)
		await assert.rejects(convertImagesToPdf(folder), /No JPEG images/)
		assert.equal(execute.mock.callCount(), 0)
	})
}

test('missing image folders reject conversion before launching a process', async (t) => {
	const execute = converter(t)
	await assert.rejects(convertImagesToPdf(path.join(directory(t), 'missing')), { code: 'ENOENT' })
	assert.equal(execute.mock.callCount(), 0)
})

test('directory inspection errors are propagated before launching a process', async (t) => {
	const folder = directory(t)
	const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
	t.mock.method(fs, 'readdir', async () => { throw error })
	const execute = converter(t)
	await assert.rejects(convertImagesToPdf(folder), (failure) => failure === error)
	assert.equal(execute.mock.callCount(), 0)
})

test('binary PDF stdout is returned unchanged, independently of stderr warnings', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'image')
	const bytes = Buffer.from([37, 80, 68, 70, 45, 255, 0, 10])
	converter(t, (_file, _args, _options, callback) => callback(null, bytes, Buffer.from('warning')))
	assert.equal(await convertImagesToPdf(folder), bytes)
})

for (const error of [
	Object.assign(new Error('conversion exited unsuccessfully'), { code: 2 }),
	Object.assign(new Error('executable missing'), { code: 'ENOENT' }),
	Object.assign(new Error('process terminated'), { code: null, signal: 'SIGTERM', killed: true }),
	Object.assign(new Error('stdout too large'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
]) {
	test(`conversion rejects process failure ${error.code ?? error.signal} even with partial stdout`, async (t) => {
		const folder = directory(t)
		await fs.writeFile(path.join(folder, '1.jpg'), 'image')
		converter(t, (_file, _args, _options, callback) => callback(error, Buffer.from('partial PDF'), Buffer.from('diagnostic')))
		await assert.rejects(convertImagesToPdf(folder), (failure) => failure === error)
	})
}

test('synchronous process launch errors reject the conversion promise', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'image')
	converter(t, () => { throw new Error('cannot launch process') })
	await assert.rejects(convertImagesToPdf(folder), /cannot launch process/)
})

// Use a harmless Node executable as a stand-in for img2pdf. These cases cross
// the real OS process boundary while staying portable and requiring no img2pdf.
function realProcess(t, script, overrides = {}) {
	return converter(t, (file, args, options, callback) => {
		assert.equal(file, 'img2pdf')
		assert.equal(options.shell, false)
		return nativeExecFile(process.execPath, ['-e', script, '--', ...args], { ...options, ...overrides }, callback)
	})
}

test('a real child process receives shell metacharacters as literal arguments', async (t) => {
	const folder = path.join(directory(t), "space & $(echo literal) 'quoted'")
	await fs.mkdir(folder)
	const names = ['$(echo filename).jpg', '-option.jpg', 'name;echo literal.jpg']
	for (const name of names) await fs.writeFile(path.join(folder, name), 'image')
	// Synchronous writes make the stand-in independent of async stdio flushing.
	realProcess(t, 'require("node:fs").writeSync(1, JSON.stringify(process.argv.slice(1)))')
	const output = await convertImagesToPdf(folder)
	assert.deepEqual(JSON.parse(output.toString()), ['--', ...names.sort().map((name) => path.join(folder, name))])
})

test('a real nonzero child exit rejects conversion and retains the exit code', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'image')
	realProcess(t, 'const fs = require("node:fs"); fs.writeSync(1, "partial PDF"); fs.writeSync(2, "bad input"); process.exitCode = 7')
	await assert.rejects(convertImagesToPdf(folder), (error) => {
		assert.equal(error.code, 7)
		assert.match(error.message, /bad input/)
		return true
	})
	assert.equal(await fs.readFile(path.join(folder, '1.jpg'), 'utf8'), 'image')
})

test('a missing real executable rejects conversion with ENOENT', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'image')
	converter(t, (_file, args, options, callback) => nativeExecFile(path.join(folder, 'missing-img2pdf'), args, options, callback))
	await assert.rejects(convertImagesToPdf(folder), { code: 'ENOENT' })
})

test('the child process output limit rejects oversized stdout', async (t) => {
	const folder = directory(t)
	await fs.writeFile(path.join(folder, '1.jpg'), 'image')
	realProcess(t, 'require("node:fs").writeSync(1, Buffer.alloc(1024))', { maxBuffer: 64 })
	await assert.rejects(convertImagesToPdf(folder), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
})

test('nonzero conversion exits do not upload partial output and allow a retry', async (t) => {
	let fail = true
	const error = Object.assign(new Error('img2pdf rejected input'), { code: 4 })
	const { root, chats, documents } = fixture(t, {
		beforeConvert: () => { if (fail) throw error },
	})
	t.mock.method(console, 'error', () => {})
	await chats.handle(message(7, '/start'))
	await chats.handle(photo(7, 'image'))
	await chats.handle(message(7, '/done'))
	assert.equal(api.sendDocument.mock.callCount(), 0)
	assert.equal(console.error.mock.calls[0].arguments[1], error)
	assert.equal(await fs.readFile(path.join(root, '7', '1.jpg'), 'utf8'), 'image')
	fail = false
	await chats.handle(message(7, '/done'))
	assert.deepEqual(documents, [{ chatId: 7, content: 'image' }])
	assert.deepEqual(await fs.readdir(root), [])
})

test('/done rejects unrelated files without starting img2pdf or deleting them', async (t) => {
	const { root, chats } = fixture(t)
	t.mock.method(console, 'error', () => {})
	await chats.handle(message(7, '/start'))
	const folder = path.join(root, '7')
	await fs.mkdir(folder)
	await fs.writeFile(path.join(folder, 'notes.txt'), 'keep')
	await chats.handle(message(7, '/done'))
	await flush()
	assert.equal(childProcess.execFile.mock.callCount(), 0)
	assert.equal(api.sendDocument.mock.callCount(), 0)
	assert.match(console.error.mock.calls[0].arguments[1].message, /No JPEG images/)
	assert.equal(await fs.readFile(path.join(folder, 'notes.txt'), 'utf8'), 'keep')
})
