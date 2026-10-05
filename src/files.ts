import fs from 'fs'
import { promises as fsPromises } from 'fs'
import path from 'path'
import { tmpdir } from 'os'

let tmpDir: string | undefined

export function getTmp(): string {
	if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'bot4img2pdf-'))
	return tmpDir
}

export async function createFolder(folder: string) {
	return fsPromises.mkdir(folder + '/', { recursive: true })
}

export async function deleteFolder(folder: string) {
	return fsPromises.rm(folder, { recursive: true, force: true })
}

export async function isEmpty(folder: string) {
	const folderExists = fs.existsSync(folder)
	return !folderExists || (await fsPromises.readdir(folder)).length === 0
}

export async function downloadFromUrl(url: string, destination: string): Promise<void> {
	try {
		const response = await fetch(url)
		if (!response.ok)
			throw new Error(`HTTP ${response.status}`)

		await fsPromises.writeFile(destination, Buffer.from(await response.arrayBuffer()))
	} catch {
		await fsPromises.rm(destination, { force: true })
		throw new Error("Failed to download the Telegram file.")
	}
}
