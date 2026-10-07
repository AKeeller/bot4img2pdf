import { InputFile, type KeyboardButton, type Message, type ReplyKeyboardMarkup } from "node-telegram-bot-api";
import bot, { createTelegramFileUrl } from '../bot'
import BOT_CMD from "../bot-cmd";
import State from "./state";
import * as Files from '../files'
import { exec } from 'child_process'

export default class WaitingPhoto implements State {
	private pendingDownloads: Promise<void>[] = []
	private readonly downloadFolder: string

	constructor(private readonly chatId: Message['chat']['id']) {
		this.downloadFolder = Files.getTmp() + '/' + chatId + '/'
	}

	async next(msg: Message) {
		if (msg.chat.id !== this.chatId)
			throw new Error('Photo state belongs to a different chat.')

		if (msg.text === BOT_CMD.DONE)
			return await this.done(msg)

		else if (msg.text === BOT_CMD.RESET)
			return this.reset(msg)

		else if (msg.sticker)
			return this.sticker(msg)

		else if (msg.photo)
			return await this.photo(msg)

		return this.default(msg)
	}

	private async done(msg: Message) {
		await Promise.allSettled(this.pendingDownloads)
		this.pendingDownloads = []

		if (await Files.isEmpty(this.downloadFolder)) {
			void bot.api.sendMessage({ chat_id: msg.chat.id, text: `Send me some photos and then use the ${BOT_CMD.DONE} command 😉` })
			return this
		}

		void bot.api.sendChatAction({ chat_id: msg.chat.id, action: 'upload_document' })

		try {
			const pdf = await new Promise<Buffer>((resolve, reject) => {
				exec('img2pdf ' + this.downloadFolder + '/*.jpg', { encoding: 'buffer', maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
					err ? reject(err) : resolve(stdout)
				})
			})
			await bot.api.sendDocument({
				chat_id: msg.chat.id,
				document: new InputFile(pdf, { filename: 'file.pdf', contentType: 'application/pdf' }),
			})
			await Files.deleteFolder(this.downloadFolder)
		} catch (error: unknown) {
			console.error('Error completing PDF job:', error)
		}

		return this
	}

	private async reset(msg: Message) {
		const start: KeyboardButton = { text: BOT_CMD.START }
		const reply_keyboard: ReplyKeyboardMarkup = { keyboard: [[start]], one_time_keyboard: false, resize_keyboard: true }

		await Promise.allSettled(this.pendingDownloads)
		this.pendingDownloads = []
		await Files.deleteFolder(this.downloadFolder)
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "Bot reset completed.", reply_markup: reply_keyboard })
		return undefined
	}

	private sticker(msg: Message) {
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "Your sticker is very funny, but unfortunately I only accept photos!" })
		return this
	}

	private async photo(msg: Message) {
		await Files.createFolder(this.downloadFolder)

		const photo = msg.photo![msg.photo!.length - 1]
		const destination = `${this.downloadFolder}${msg.message_id}.jpg`
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
		// Downloads may fail before /done or /reset attaches its settlement handler.
		void downloadPromise.catch(() => {})

		return this
	}

	private default(msg: Message) {
		void bot.api.sendMessage({ chat_id: msg.chat.id, text: "<b>Oops!</b> I was expecting a photo, but I received something else. Please, send me some pictures!", parse_mode: 'HTML' })
		return this
	}

}
