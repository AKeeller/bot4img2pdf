import { InputFile, type KeyboardButton, type Message, type ReplyKeyboardMarkup } from "node-telegram-bot-api";
import bot, { createTelegramFileUrl } from '../bot'
import BOT_CMD from "../bot-cmd";
import State from "./state";
import * as Files from '../files'
import { exec } from 'child_process'

export default class WaitingPhoto implements State {
	private pendingDownloads: Promise<void>[] = []

	async next(msg: Message) {
		const downloadFolder = Files.getTmp() + '/' + msg.chat.id + '/'

		if (msg.text === BOT_CMD.DONE)
			return await this.done(downloadFolder, msg)

		else if (msg.text === BOT_CMD.RESET)
			return this.reset(downloadFolder, msg)

		else if (msg.sticker)
			return this.sticker(msg)

		else if (msg.photo)
			return await this.photo(downloadFolder, msg)

		return this.default(msg)
	}

	async done(downloadFolder: string, msg: Message) {
		await Promise.allSettled(this.pendingDownloads)
		this.pendingDownloads = []

		if (await Files.isEmpty(downloadFolder)) {
			void bot.api.sendMessage({ chat_id: msg.chat.id, text: `Send me some photos and then use the ${BOT_CMD.DONE} command 😉` })
			return this
		}

		void bot.api.sendChatAction({ chat_id: msg.chat.id, action: 'upload_document' })

		exec('img2pdf ' + downloadFolder + '/*.jpg', { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
			if (err) {
				console.error(err)
				return
			}
			bot.api.sendDocument({
				chat_id: msg.chat.id,
				document: new InputFile(stdout, { filename: 'file.pdf', contentType: 'application/pdf' }),
			})
				.then(() => Files.deleteFolder(downloadFolder))
				.catch((sendError: unknown) => console.error('Error sending PDF:', sendError))
		})

		return this
	}

	reset(downloadFolder: string, msg: Message) {
		const start: KeyboardButton = { text: BOT_CMD.START }
		const reply_keyboard: ReplyKeyboardMarkup = { keyboard: [[start]], one_time_keyboard: false, resize_keyboard: true }

		this.pendingDownloads = []
		void Files.deleteFolder(downloadFolder)
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "Bot reset completed.", reply_markup: reply_keyboard })
		return undefined
	}

	sticker(msg: Message) {
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "Your sticker is very funny, but unfortunately I only accept photos!" })
		return this
	}

	async photo(downloadFolder: string, msg: Message) {
		await Files.createFolder(downloadFolder)

		const photo = msg.photo![msg.photo!.length - 1]
		const destination = `${downloadFolder}${msg.message_id}.jpg`
		const downloadPromise = (async () => {
			const file = await bot.api.getFile({ file_id: photo.file_id })
			if (!file.file_path)
				throw new Error('Telegram did not return a file path for the photo.')
			await Files.downloadFromUrl(createTelegramFileUrl(file.file_path), destination)
		})().catch((err: unknown) => {
			console.error('Error downloading photo:', err)
			throw err
		})

		this.pendingDownloads.push(downloadPromise)

		return this
	}

	default(msg: Message) {
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "<b>Oops!</b> I was expecting a photo, but I received something else. Please, send me some pictures!", parse_mode: 'HTML' })
		return this
	}

}
