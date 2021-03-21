import TelegramBot from "node-telegram-bot-api"
import { State } from "./state"
import { Waiting } from "./state.waiting"

export class StartState implements State {
	bot: TelegramBot

	constructor(bot: TelegramBot) {
		this.bot = bot
	}
	
	next(msg: TelegramBot.Message): State {

		if (msg.text === "/start") {
			this.bot.sendMessage(msg.chat.id, "Welcome!")
			return new Waiting(this.bot)
		}

		this.bot.sendMessage(msg.chat.id, "Use /start to start.")
		return this
	}
	
}