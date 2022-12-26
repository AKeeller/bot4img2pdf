import TelegramBot from "node-telegram-bot-api";

export default interface State {
	next(msg: TelegramBot.Message): State | undefined
}