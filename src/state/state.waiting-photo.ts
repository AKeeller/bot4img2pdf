import TelegramBot from "node-telegram-bot-api";
import { State } from "./state";
import { Files } from '../files'
import { exec } from 'child_process'
import { bot } from '../bot'
import { BOT_CMD } from "../bot-cmd";

export class WaitingPhoto implements State {

	next(msg: TelegramBot.Message) {
		const downloadFolder = (process.env.DOWNLOAD_FOLDER ?? './') + msg.chat.id + '/'

		if (msg.text === BOT_CMD.DONE)
			return this.done(downloadFolder, msg)

		else if (msg.text === BOT_CMD.RESET)
			return this.reset(downloadFolder, msg)

		else if (msg.sticker)
			return this.sticker(msg)

		else if (msg.photo)
			return this.photo(downloadFolder, msg)

		return this.default(msg)
	}

	done(downloadFolder: string, msg: TelegramBot.Message) {
		if (Files.isEmpty(downloadFolder)) {
			bot.sendMessage(msg.chat.id, `Send me some photos and then use the ${BOT_CMD.DONE} command 😉`)
			return this
		}

		bot.sendChatAction(msg.chat.id, 'upload_document')

		exec('img2pdf ' + downloadFolder + '/*.jpg', { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
			if (err) {
				console.error(err)
				return
			}
			bot.sendDocument(msg.chat.id, stdout, {}, { filename: 'file.pdf', contentType: 'application/pdf' })
			Files.deleteFolder(downloadFolder)
		})

		return new WaitingPhoto()
	}

	reset(downloadFolder: string, msg: TelegramBot.Message) {
		const start: TelegramBot.KeyboardButton = { text: BOT_CMD.START }
		const reply_keyboard: TelegramBot.ReplyKeyboardMarkup = { keyboard: [[start]], one_time_keyboard: false, resize_keyboard: true }

		Files.deleteFolder(downloadFolder)
		bot.sendMessage(msg.chat.id, "Bot reset completed.", { reply_markup: reply_keyboard })
		return undefined
	}

	sticker(msg: TelegramBot.Message) {
		bot.sendMessage(msg.chat.id, "Your sticker is very funny, but unfortunately I only accept photos!")
		return this
	}

	photo(downloadFolder: string, msg: TelegramBot.Message) {
		Files.createFolder(downloadFolder)
		bot.downloadFile(msg.photo![2].file_id, downloadFolder)
		.then((filePath) => Files.renameFile(filePath, String(msg.message_id), true))

		return this
	}

	default(msg: TelegramBot.Message) {
		bot.sendMessage(msg.chat.id, "<b>Oops!</b> I was expecting a photo, but I received something else. Please, send me some pictures!", { parse_mode: 'HTML' })
		return this
	}

}