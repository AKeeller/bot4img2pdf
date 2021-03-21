import TelegramBot from "node-telegram-bot-api";
import { State } from "./state";
import fs from 'fs'

export class Waiting implements State {
	bot: TelegramBot

	private readonly getDownloadFolder = (id: number) => (process.env.DOWNLOAD_FOLDER ?? './') + id + '/'
	
	constructor(bot: TelegramBot) {
		this.bot = bot
	}

	next(msg: TelegramBot.Message): State | undefined {

		if (msg.text === "/done") {
			this.bot.sendMessage(msg.chat.id, "I'm sending the file…")

			const { exec } = require('child_process');
			exec('img2pdf ' + this.getDownloadFolder(msg.chat.id) + '/*.jpg', {encoding: 'buffer', maxBuffer: 1024 * 1024 * 50}, (err: any, stdout: any, stderr: any) => {
				if (err) {
					console.error(err)
					return
				}
				this.bot.sendDocument(msg.chat.id, stdout, {}, { filename: 'file.pdf', contentType: 'application/pdf' })
				this.clearFolder(this.getDownloadFolder(msg.chat.id))
			})

			return new Waiting(this.bot)
		}

		else if (msg.text === "/reset") {
			this.clearFolder(this.getDownloadFolder(msg.chat.id))
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

		fs.mkdir(this.getDownloadFolder(msg.chat.id), {recursive: true}, (err) => { if (err) throw err })
		this.bot.downloadFile(msg.photo[2].file_id, this.getDownloadFolder(msg.chat.id))
		
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