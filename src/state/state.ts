import TelegramBot from "node-telegram-bot-api";
import { bot } from "../bot";

export interface State {
	next(msg: TelegramBot.Message): State | undefined
}