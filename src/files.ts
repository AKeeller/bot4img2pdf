import fs from 'fs'
import path from 'path'
import { tmpdir } from 'os'

export module Files {

	export const tmp = fs.mkdtempSync(path.join(tmpdir(), 'bot4img2pdf-'))

	export function createFolder(folder: string) {
		fs.mkdir(folder + '/', { recursive: true }, (err) => { if (err) throw err })
	}

	export function deleteFolder(folder: string) {
		fs.rm(folder, { recursive: true, force: true }, (err) => { if (err) console.error(err) })
	}

	export function isEmpty(folder: string) {
		const folderExists = fs.existsSync(folder)
		return !folderExists || (folderExists && fs.readdirSync(folder).length <= 0)
	}

	export function renameFile(filePath: string, newName: string, keepExtension = false) {
		const dirname = path.dirname(filePath)
		const extension = path.extname(filePath)
		const newFilePath = dirname + '/' + newName + (keepExtension ? extension : '')

		fs.rename(filePath, newFilePath, (err) => { if (err) console.error(err) })
	}

}