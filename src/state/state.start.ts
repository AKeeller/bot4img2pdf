import TelegramBot from "node-telegram-bot-api"
import { State } from "./state"
import { WaitingPhoto } from "./state.waiting-photo"
import { bot } from '../bot'

export class StartState implements State {

	private readonly welcomeMessage =
		"<b>Welcome! 👋</b>\nSend me as many photos 📷 as you want. When you are ready to generate the .pdf, just use the /done command 👍"

	private done: TelegramBot.KeyboardButton = { text: '/done' }
	private reset: TelegramBot.KeyboardButton = { text: '/reset' }
	private reply_keyboard: TelegramBot.ReplyKeyboardMarkup = { keyboard: [[this.done, this.reset]], one_time_keyboard: false, resize_keyboard: true }

	next(msg: TelegramBot.Message): State {

		if (msg.text === "/start") {
			bot.sendMessage(msg.chat.id, this.welcomeMessage, { parse_mode: 'HTML', reply_markup: this.reply_keyboard })
			return new WaitingPhoto()
		}

		bot.sendMessage(msg.chat.id, "Use /start to start.")
		return this
	}

}