import TelegramBot from "node-telegram-bot-api";
import { State } from "./state";
import fs from 'fs'

export class Waiting implements State {
	bot: TelegramBot
	
	constructor(bot: TelegramBot) {
		this.bot = bot
	}

	next(msg: TelegramBot.Message): State | undefined {
		const downloadFolder = (process.env.DOWNLOAD_FOLDER ?? './') + msg.chat.id + '/'

		if (msg.text === "/done") {
			if (!fs.existsSync(downloadFolder) || (fs.existsSync(downloadFolder) && fs.readdirSync(downloadFolder).length <= 0)) {
				this.bot.sendMessage(msg.chat.id, "Send me some photos and then use the /done command 😉")
				return this
			}

			this.bot.sendMessage(msg.chat.id, "I'm sending the file…")

			const { exec } = require('child_process');
			exec('img2pdf ' + downloadFolder + '/*.jpg', {encoding: 'buffer', maxBuffer: 1024 * 1024 * 50}, (err: any, stdout: any, stderr: any) => {
				if (err) {
					console.error(err)
					return
				}
				this.bot.sendDocument(msg.chat.id, stdout, {}, { filename: 'file.pdf', contentType: 'application/pdf' })
				this.clearFolder(downloadFolder)
			})

			return new Waiting(this.bot)
		}

		else if (msg.text === "/reset") {
			this.clearFolder(downloadFolder)
			this.bot.sendMessage(msg.chat.id, "Bot reset completed.")
			return undefined
		}

		else if (msg.sticker) {
			this.bot.sendMessage(msg.chat.id, "Your sticker is very funny, but unfortunately I only accept photos!")
			return this
		}

		else if (!msg.photo) {
			this.bot.sendMessage(msg.chat.id, "Oops! I was expecting a photo, but I received something else. Please, send me some pictures!")
			return this
		}

		fs.mkdir(downloadFolder, {recursive: true}, (err) => { if (err) throw err })
		this.bot.downloadFile(msg.photo[2].file_id, downloadFolder)
		
		return this
	}

	private clearFolder(folder: string) {
		fs.rmdir(folder, {recursive: true}, (err) => {
			if (err)
				console.error(err)
			else
				console.log("Removed folder " + folder)
		})
	}
}