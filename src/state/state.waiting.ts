import TelegramBot from "node-telegram-bot-api";
import { State } from "./state";
import fs from 'fs'

export class Waiting implements State {
	bot: TelegramBot
	nop: number = 0

	private readonly downloadFolder = (id: number) => '/Users/Alberto/Downloads/telegram_bot/' + id + '/'
	
	constructor(bot: TelegramBot) {
		this.bot = bot
	}

	next(msg: TelegramBot.Message): State | undefined {

		if (msg.text === "/done") {
			this.bot.sendMessage(msg.chat.id, "I'm sending the file…")

			const { exec } = require('child_process');
			exec('img2pdf ' + this.downloadFolder(msg.chat.id) + '/*.jpg', {encoding: 'buffer'}, (err: any, stdout: any, stderr: any) => {
				if (err) {
					console.error(err)
					return
				}
				this.bot.sendDocument(msg.chat.id, stdout, {}, { filename: 'file.pdf', contentType: 'application/pdf' })
				fs.rmdir(this.downloadFolder(msg.chat.id), {recursive: true}, (err) => {
					if (err)
						console.error(err)
					else
						console.log("Removed folder " + this.downloadFolder(msg.chat.id))
				})
			})

			return new Waiting(this.bot)
		}

		else if (!msg.photo) {
			this.bot.sendMessage(msg.chat.id, "Oops! I was expecting a photo, but I received something else. Please, send me some pictures!")
			return this
		}

		fs.mkdir(this.downloadFolder(msg.chat.id), {recursive: true}, (err) => { if (err) throw err })
		this.bot.downloadFile(msg.photo[2].file_id, this.downloadFolder(msg.chat.id))
		.finally(() => {
			this.nop++
			this.bot.sendMessage(msg.chat.id, "I received " + this.nop + " photos")
		})
		
		return this
	}
}