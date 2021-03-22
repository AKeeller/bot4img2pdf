import TelegramBot from "node-telegram-bot-api";
import { Bot } from "../bot";

export abstract class State {
	bot: TelegramBot = Bot.instance.bot
	abstract next(msg: TelegramBot.Message): State | undefined
}