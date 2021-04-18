import fs from 'fs'
import path from 'path'

export module Files {

	export function createFolder(folder: string) {
		fs.mkdir(folder + '/', { recursive: true }, (err) => { if (err) throw err })
	}

	export function deleteFolder(folder: string) {
		fs.rm(folder, { recursive: true, force: true }, (err) => { if (err) console.error(err) })
	}

	export function isEmpty(folder: string) {
		return !fs.existsSync(folder) || (fs.existsSync(folder) && fs.readdirSync(folder).length <= 0)
	}

	export function renameFile(filePath: string, newName: string, keepExtension = false) {
		const dirname = path.dirname(filePath)
		const extension = path.extname(filePath)
		const newFilePath = dirname + '/' + newName + (keepExtension ? extension : '')

		fs.rename(filePath, newFilePath, (err) => { if (err) console.error(err) })
	}

}