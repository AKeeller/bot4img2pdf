import TelegramBot from "node-telegram-bot-api";

export interface State {
	next(msg: TelegramBot.Message): State | undefined
}