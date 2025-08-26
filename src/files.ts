import fs from 'fs'
import { promises } from 'fs'
import path from 'path'
import { tmpdir } from 'os'

export module Files {

	export const tmp = fs.mkdtempSync(path.join(tmpdir(), 'bot4img2pdf-'))

	export async function createFolder(folder: string) {
		return promises.mkdir(folder + '/', { recursive: true })
	}

	export async function deleteFolder(folder: string) {
		return promises.rm(folder, { recursive: true, force: true })
	}

	export async function isEmpty(folder: string) {
		const folderExists = fs.existsSync(folder)
		return !folderExists || (folderExists && (await promises.readdir(folder)).length <= 0)
	}

	export async function renameFile(filePath: string, newName: string, keepExtension = false) {
		const dirname = path.dirname(filePath)
		const extension = path.extname(filePath)
		const newFilePath = dirname + '/' + newName + (keepExtension ? extension : '')

		return promises.rename(filePath, newFilePath)
	}

}