import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export async function convertImagesToPdf(folder: string): Promise<Buffer> {
	const entries = await readdir(folder, { withFileTypes: true })
	const images = entries
		.filter(entry => entry.isFile() && entry.name.endsWith('.jpg'))
		.map(entry => entry.name)
		.sort()
		.map(name => path.resolve(folder, name))

	if (images.length === 0)
		throw new Error('No JPEG images are available for PDF conversion.')

	return new Promise<Buffer>((resolve, reject) => {
		// End option parsing and pass each path literally, without a shell or glob.
		execFile('img2pdf', ['--', ...images], {
			encoding: 'buffer',
			maxBuffer: 1024 * 1024 * 50,
			shell: false,
		}, (error, stdout) => {
			error ? reject(error) : resolve(stdout)
		})
	})
}
