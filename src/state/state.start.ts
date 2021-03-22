import TelegramBot from "node-telegram-bot-api"
import { State } from "./state"
import { WaitingPhoto } from "./state.waiting-photo"

export class StartState implements State {
	bot: TelegramBot

	private readonly welcomeMessage =
		"Welcome! 👋\nSend me as many photos 📷 as you want. When you are ready to generate the .pdf, just use the /done command 👍"

	constructor(bot: TelegramBot) {
		this.bot = bot
	}
	
	next(msg: TelegramBot.Message): State {

		if (msg.text === "/start") {
			this.bot.sendMessage(msg.chat.id, this.welcomeMessage)
			return new WaitingPhoto(this.bot)
		}

		this.bot.sendMessage(msg.chat.id, "Use /start to start.")
		return this
	}
	
}