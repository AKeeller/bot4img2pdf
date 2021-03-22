import TelegramBot from "node-telegram-bot-api"
import { State } from "./state"
import { WaitingPhoto } from "./state.waiting-photo"

export class StartState extends State {

	private readonly welcomeMessage =
		"<b>Welcome! 👋</b>\nSend me as many photos 📷 as you want. When you are ready to generate the .pdf, just use the /done command 👍"
	
	next(msg: TelegramBot.Message): State {

		if (msg.text === "/start") {
			this.bot.sendMessage(msg.chat.id, this.welcomeMessage, { parse_mode: 'HTML' })
			return new WaitingPhoto()
		}

		this.bot.sendMessage(msg.chat.id, "Use /start to start.")
		return this
	}
	
}