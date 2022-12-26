import TelegramBot from "node-telegram-bot-api"
import bot from '../bot'
import { State } from "./state"
import { WaitingPhoto } from "./state.waiting-photo"
import { BOT_CMD } from "../bot-cmd"

export class StartState implements State {

	private readonly welcomeMessage =
		`<b>Welcome! 👋</b>\nSend me as many photos 📷 as you want. When you are ready to generate the .pdf, just use the ${BOT_CMD.DONE} command 👍`

	private done: TelegramBot.KeyboardButton = { text: BOT_CMD.DONE }
	private reset: TelegramBot.KeyboardButton = { text: BOT_CMD.RESET }
	private reply_keyboard: TelegramBot.ReplyKeyboardMarkup = { keyboard: [[this.done, this.reset]], one_time_keyboard: false, resize_keyboard: true }

	next(msg: TelegramBot.Message): State {

		if (msg.text === BOT_CMD.START) {
			bot.sendMessage(msg.chat.id, this.welcomeMessage, { parse_mode: 'HTML', reply_markup: this.reply_keyboard })
			return new WaitingPhoto()
		}

		bot.sendMessage(msg.chat.id, `Use ${BOT_CMD.START} to start.`)
		return this
	}

}