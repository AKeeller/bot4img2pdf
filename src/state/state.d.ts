import TelegramBot from "node-telegram-bot-api";

export interface State {
	bot: TelegramBot
	next(msg: TelegramBot.Message): State | undefined
}