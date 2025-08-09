import TelegramBot from "node-telegram-bot-api";
import bot from '../bot'
import BOT_CMD from "../bot-cmd";
import State from "./state";
import { Files } from '../files'
import { exec } from 'child_process'

export default class WaitingPhoto implements State {
	pendingDownloads = new Map<number, Promise<any>[]>();

	async next(msg: TelegramBot.Message) {
		const downloadFolder = Files.tmp + '/' + msg.chat.id + '/'

		if (msg.text === BOT_CMD.DONE)
			return await this.done(downloadFolder, msg)

		else if (msg.text === BOT_CMD.RESET)
			return this.reset(downloadFolder, msg)

		else if (msg.sticker)
			return this.sticker(msg)

		else if (msg.photo)
			return this.photo(downloadFolder, msg)

		return this.default(msg)
	}

	async done(downloadFolder: string, msg: TelegramBot.Message) {
		if (this.pendingDownloads.has(msg.chat.id)) {
			await Promise.allSettled(this.pendingDownloads.get(msg.chat.id)!)
			this.pendingDownloads.delete(msg.chat.id);
		}

		if (await Files.isEmpty(downloadFolder)) {
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
				.then(() => Files.deleteFolder(downloadFolder))
		})

		return this
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

		const downloadPromise = bot.downloadFile(msg.photo![msg.photo!.length - 1].file_id, downloadFolder)
			.then((filePath) => Files.renameFile(filePath, String(msg.message_id), true))

		if (!this.pendingDownloads.has(msg.chat.id))
			this.pendingDownloads.set(msg.chat.id, [])

		this.pendingDownloads.get(msg.chat.id)!.push(downloadPromise)

		return this
	}

	default(msg: TelegramBot.Message) {
		bot.sendMessage(msg.chat.id, "<b>Oops!</b> I was expecting a photo, but I received something else. Please, send me some pictures!", { parse_mode: 'HTML' })
		return this
	}

}