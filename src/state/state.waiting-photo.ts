import TelegramBot from "node-telegram-bot-api";
import { State } from "./state";
import { Files } from '../files'
import { bot } from '../bot'

export class WaitingPhoto implements State {

	next(msg: TelegramBot.Message): State | undefined {
		const downloadFolder = (process.env.DOWNLOAD_FOLDER ?? './') + msg.chat.id + '/'

		if (msg.text === "/done") {
			if (Files.isEmpty(downloadFolder)) {
				bot.sendMessage(msg.chat.id, "Send me some photos and then use the /done command 😉")
				return this
			}

			bot.sendChatAction(msg.chat.id, 'upload_document')

			const { exec } = require('child_process');
			exec('img2pdf ' + downloadFolder + '/*.jpg', {encoding: 'buffer', maxBuffer: 1024 * 1024 * 50}, (err: any, stdout: any, stderr: any) => {
				if (err) {
					console.error(err)
					return
				}
				bot.sendDocument(msg.chat.id, stdout, {}, { filename: 'file.pdf', contentType: 'application/pdf' })
				Files.deleteFolder(downloadFolder)
			})

			return new WaitingPhoto()
		}

		else if (msg.text === "/reset") {
			Files.deleteFolder(downloadFolder)
			bot.sendMessage(msg.chat.id, "Bot reset completed.", { reply_markup: {remove_keyboard: true} })
			return undefined
		}

		else if (msg.sticker) {
			bot.sendMessage(msg.chat.id, "Your sticker is very funny, but unfortunately I only accept photos!")
			return this
		}

		else if (!msg.photo) {
			bot.sendMessage(msg.chat.id, "<b>Oops!</b> I was expecting a photo, but I received something else. Please, send me some pictures!", { parse_mode: 'HTML' })
			return this
		}

		Files.createFolder(downloadFolder)
		bot.downloadFile(msg.photo[2].file_id, downloadFolder)
		
		return this
	}
	
}