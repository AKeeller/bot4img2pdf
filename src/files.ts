import fs from 'fs'

export module Files {

	export function createFolder(folder: string) {
		fs.mkdir(folder + '/', {recursive: true}, (err) => { if (err) throw err })
	}

	export function deleteFolder(folder: string) {
		fs.rmdir(folder, {recursive: true}, (err) => {
			if (err)
				console.error(err)
			else
				console.log("Removed folder " + folder)
		})
	}

	export function isEmpty(folder: string) {
		return !fs.existsSync(folder) || (fs.existsSync(folder) && fs.readdirSync(folder).length <= 0)
	}

}